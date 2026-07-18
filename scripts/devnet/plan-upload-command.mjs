import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { Connection, PublicKey } from "@solana/web3.js";

import { inspectUpgradeableBuffer } from "./live-deployment.mjs";
import { PACKET_DATA_SIZE, planBufferUpload } from "./upload-plan.mjs";
import {
  DEVNET_GENESIS_HASH,
  DEVNET_RPC_URL,
  assertAllowedRpcUrl,
  assertDevnetGenesis,
  validatePublicConfig,
} from "./safety.mjs";

const BUFFER_METADATA_LENGTH = 37;
const PROGRAM_ACCOUNT_LENGTH = 36;
const PROGRAMDATA_METADATA_LENGTH = 45;
const CONSERVATIVE_FEE_PER_TRANSACTION_LAMPORTS = 10_000;
const OPERATIONAL_RESERVE_LAMPORTS = 250_000_000;
const READ_METHODS = [
  "getGenesisHash",
  "getAccountInfo",
  "getBalance",
  "getMinimumBalanceForRentExemption",
  "getSignaturesForAddress",
];

export const PLAN_UPLOAD_IDENTITIES = Object.freeze({
  program: "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z",
  buffer: "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW",
  authority: "Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk",
  loader: "BPFLoaderUpgradeab1e11111111111111111111111",
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createReadOnlyRpcAdapter(connection) {
  const audit = [];
  const adapter = { rpcEndpoint: connection.rpcEndpoint, audit };
  for (const method of READ_METHODS) {
    adapter[method] = async (...args) => {
      audit.push(method);
      return connection[method](...args);
    };
  }
  return adapter;
}

export function createPlanUploadConnection(rpcUrl, { fetch } = {}) {
  return new Connection(rpcUrl, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    ...(fetch ? { fetch } : {}),
  });
}

export function calculateFunding({
  balanceLamports,
  programAccountRentLamports,
  programDataRentLamports,
  remainingChunks,
}) {
  for (const [label, value] of Object.entries({
    balanceLamports,
    programAccountRentLamports,
    programDataRentLamports,
    remainingChunks,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a nonnegative safe integer`);
    }
  }
  const remainingChunkFeesLamports =
    remainingChunks * CONSERVATIVE_FEE_PER_TRANSACTION_LAMPORTS;
  const finalizeDeployFeeLamports =
    CONSERVATIVE_FEE_PER_TRANSACTION_LAMPORTS;
  const totalNetworkFeesLamports =
    remainingChunkFeesLamports + finalizeDeployFeeLamports;
  const requiredRemainingBalanceLamports =
    programAccountRentLamports +
    programDataRentLamports +
    totalNetworkFeesLamports +
    OPERATIONAL_RESERVE_LAMPORTS;
  const headroomAfterReserveLamports =
    balanceLamports - requiredRemainingBalanceLamports;
  return {
    networkFeeEstimate: {
      remainingChunkFeesLamports,
      finalizeDeployFeeLamports,
      totalLamports: totalNetworkFeesLamports,
      conservativePerTransactionLamports:
        CONSERVATIVE_FEE_PER_TRANSACTION_LAMPORTS,
      assumptions: [
        "10,000 lamports per one-signature transaction, conservatively above the 5,000-lamport base fee.",
        "One transaction for each proven nonmatching full chunk plus one finalize/deploy transaction.",
        "No live blockhash or fee RPC is required for this deterministic estimate.",
      ],
    },
    existingBufferRentAdditionalLamports: 0,
    balanceLamports,
    programAccountRentLamports,
    programDataRentLamports,
    operationalReserveLamports: OPERATIONAL_RESERVE_LAMPORTS,
    requiredRemainingBalanceLamports,
    headroomAfterReserveLamports,
    status:
      headroomAfterReserveLamports < 0 ? "BLOCKED_FUNDING" : "SUFFICIENT",
  };
}

function assertCheckpoint(checkpoint, localBytes) {
  if (checkpoint?.rpcUrl !== DEVNET_RPC_URL) {
    throw new Error("RPC checkpoint mismatch");
  }
  if (checkpoint?.genesisHash !== DEVNET_GENESIS_HASH) {
    throw new Error("devnet genesis hash mismatch in checkpoint");
  }
  if (checkpoint?.programId !== PLAN_UPLOAD_IDENTITIES.program) {
    throw new Error("program ID mismatch");
  }
  if (checkpoint?.bufferAddress !== PLAN_UPLOAD_IDENTITIES.buffer) {
    throw new Error("buffer address mismatch");
  }
  if (checkpoint?.bufferOwner !== PLAN_UPLOAD_IDENTITIES.loader) {
    throw new Error("buffer owner mismatch");
  }
  if (checkpoint?.authority !== PLAN_UPLOAD_IDENTITIES.authority) {
    throw new Error("buffer authority mismatch");
  }
  if (checkpoint?.binaryLength !== localBytes.length) {
    throw new Error("binary length mismatch");
  }
  if (checkpoint?.binarySha256 !== sha256(localBytes)) {
    throw new Error("binary SHA-256 mismatch");
  }
  if (checkpoint?.bufferAllocation !== localBytes.length + BUFFER_METADATA_LENGTH) {
    throw new Error("buffer allocation mismatch");
  }
}

function equalPositionRanges(expected, actual) {
  const ranges = [];
  let start = null;
  let count = 0;
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] === actual[index]) {
      count += 1;
      if (start === null) start = index;
    } else if (start !== null) {
      ranges.push([start, index - 1]);
      start = null;
    }
  }
  if (start !== null) ranges.push([start, expected.length - 1]);
  return { count, ranges, classification: "NOT_AN_UPLOAD_OFFSET" };
}

export async function executePlanUpload({
  rpcUrl,
  checkpoint,
  localBytes,
  rpc,
  maxPayload,
}) {
  const explicitRpc = assertAllowedRpcUrl(rpcUrl, "devnet").origin;
  if (explicitRpc !== DEVNET_RPC_URL || rpc?.rpcEndpoint !== DEVNET_RPC_URL) {
    throw new Error("an explicit Solana devnet RPC URL is required");
  }
  const local = Buffer.from(localBytes);
  assertCheckpoint(checkpoint, local);

  const genesisHash = await rpc.getGenesisHash();
  assertDevnetGenesis(genesisHash, checkpoint.genesisHash);

  const programKey = new PublicKey(checkpoint.programId);
  const bufferKey = new PublicKey(checkpoint.bufferAddress);
  const authorityKey = new PublicKey(checkpoint.authority);
  const programAccount = await rpc.getAccountInfo(programKey, "confirmed");
  if (programAccount !== null) {
    throw new Error("UNEXPECTED_EXISTING_PROGRAM: canonical program must be absent at the plan-upload checkpoint");
  }
  const bufferAccount = await rpc.getAccountInfo(bufferKey, "confirmed");
  if (!bufferAccount) throw new Error("buffer account is absent");
  const observed = inspectUpgradeableBuffer(bufferAccount, {
    publicKey: checkpoint.bufferAddress,
    expectedOwner: checkpoint.bufferOwner,
    expectedAuthority: checkpoint.authority,
    allocatedLength: checkpoint.bufferAllocation,
    localBytes: local,
  });
  const bufferBytes = Buffer.from(bufferAccount.data).subarray(BUFFER_METADATA_LENGTH);
  const plan = planBufferUpload({
    localBytes: local,
    bufferBytes,
    buffer: bufferKey,
    authority: authorityKey,
    ...(maxPayload === undefined ? {} : { maxPayload }),
  });
  const maximumSerializedTransactionSize = Math.max(
    0,
    ...plan.chunks.map(({ transactionBytes }) => transactionBytes),
  );

  const [balanceLamports, programRentLamports, programDataRentLamports, history] = await Promise.all([
    rpc.getBalance(authorityKey, "confirmed"),
    rpc.getMinimumBalanceForRentExemption(PROGRAM_ACCOUNT_LENGTH, "confirmed"),
    rpc.getMinimumBalanceForRentExemption(PROGRAMDATA_METADATA_LENGTH + local.length, "confirmed"),
    rpc.getSignaturesForAddress(bufferKey, { limit: 1_000 }, "confirmed"),
  ]);
  const funding = calculateFunding({
    balanceLamports,
    programAccountRentLamports: programRentLamports,
    programDataRentLamports,
    remainingChunks: plan.remainingChunks,
  });

  return {
    rpc: DEVNET_RPC_URL,
    verifiedGenesis: genesisHash,
    identities: {
      program: checkpoint.programId,
      buffer: checkpoint.bufferAddress,
      authority: checkpoint.authority,
    },
    programAccount: { disposition: "ABSENT_REQUIRED_FOR_INITIAL_DEPLOY" },
    binary: { length: local.length, sha256: sha256(local) },
    bufferAllocation: checkpoint.bufferAllocation,
    bufferDataSha256: sha256(bufferAccount.data),
    bufferHistoryCount: history.length,
    bufferStatus: observed.status,
    packetCeiling: PACKET_DATA_SIZE,
    derivedPayloadSize: plan.maxPayload,
    maximumSerializedTransactionSize,
    totalPlannedChunks: plan.totalChunks,
    exactMatchingChunks: plan.exactChunks,
    remainingChunks: plan.remainingChunks,
    remainingTransactions: {
      value: plan.remainingChunks,
      basis: "PROVEN_ONE_TRANSACTION_PER_NONMATCHING_FULL_CHUNK",
    },
    equalBytePositions: equalPositionRanges(local, bufferBytes),
    networkFeeEstimate: funding.networkFeeEstimate,
    funding: {
      existingBufferRentAdditionalLamports:
        funding.existingBufferRentAdditionalLamports,
      balanceLamports: funding.balanceLamports,
      programAccountRentLamports: funding.programAccountRentLamports,
      programDataRentLamports: funding.programDataRentLamports,
      operationalReserveLamports: funding.operationalReserveLamports,
      requiredRemainingBalanceLamports:
        funding.requiredRemainingBalanceLamports,
      headroomAfterReserveLamports: funding.headroomAfterReserveLamports,
      status: funding.status,
    },
    stateMutation: false,
    liveUploadEnabled: false,
    rpcCallAudit: (rpc.audit ?? rpc.calls ?? []).map((entry) =>
      typeof entry === "string" ? entry : entry.name,
    ),
  };
}

function parseArgs(argv) {
  const command = argv[0];
  if (command !== "plan-upload") {
    throw new Error("LIVE_UPLOAD_HARD_DISABLED: only the read-only plan-upload command is enabled");
  }
  if (argv.length !== 3 || argv[1] !== "--rpc") {
    throw new Error("an explicit Solana devnet RPC URL is required");
  }
  assertAllowedRpcUrl(argv[2], "devnet");
  return { command, rpcUrl: argv[2] };
}

function checkpointFromFiles(configValue, stateValue) {
  const config = validatePublicConfig(configValue);
  const buffer = stateValue?.deployment?.buffer;
  if (!buffer || stateValue?.identities?.program !== config.programId) {
    throw new Error("public deployment checkpoint is incomplete");
  }
  return {
    rpcUrl: config.cluster.rpcUrl,
    genesisHash: config.cluster.genesisHash,
    programId: config.programId,
    bufferAddress: buffer.publicKey,
    bufferOwner: buffer.expectedOwner,
    authority: buffer.expectedAuthority,
    bufferAllocation: buffer.allocatedLength,
    binaryLength: buffer.localBinary?.length,
    binarySha256: buffer.localBinary?.sha256,
  };
}

export async function runPlanUploadCommand({ argv, paths, createRpc = (url) => createReadOnlyRpcAdapter(createPlanUploadConnection(url)) }) {
  const { rpcUrl } = parseArgs(argv);
  const config = JSON.parse(readFileSync(paths.configPath, "utf8"));
  const state = JSON.parse(readFileSync(paths.statePath, "utf8"));
  const localBytes = readFileSync(paths.binaryPath);
  return executePlanUpload({
    rpcUrl,
    checkpoint: checkpointFromFiles(config, state),
    localBytes,
    rpc: createRpc(rpcUrl),
  });
}
