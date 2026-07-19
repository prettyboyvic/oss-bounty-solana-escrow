import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";

import { inspectUpgradeableBuffer } from "./live-deployment.mjs";
import { makeLoaderV3WriteInstruction } from "./loader-v3-codec.mjs";
import {
  calculateFunding,
  PLAN_UPLOAD_IDENTITIES,
} from "./plan-upload-command.mjs";
import { assertDevnetGenesis, DEVNET_GENESIS_HASH } from "./safety.mjs";
import { saveStateAtomic } from "./state.mjs";
import { validateUploadStateV3 } from "./state-migration-command.mjs";
import {
  createPlanFingerprint,
  normalizeRatePolicy,
  runPersistedSequentialUpload,
} from "./throttled-uploader.mjs";
import { acquireUploadLease } from "./upload-execution-lease.mjs";
import { LIVE_UPLOAD_ACKNOWLEDGEMENT } from "./upload-execution-contract.mjs";
import { planBufferUpload } from "./upload-plan.mjs";

const BUFFER_METADATA_LENGTH = 37;
const PROGRAM_ACCOUNT_LENGTH = 36;
const PROGRAMDATA_METADATA_LENGTH = 45;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function confirmedChunksMatch(state, accountData) {
  const payload = Buffer.from(accountData).subarray(BUFFER_METADATA_LENGTH);
  const chunks = state?.deployment?.buffer?.chunks;
  if (!Array.isArray(chunks)) return false;
  return chunks
    .filter(({ status }) => status === "CONFIRMED")
    .every(({ offset, length, sha256: expectedSha256 }) =>
      Number.isSafeInteger(offset) && offset >= 0 &&
      Number.isSafeInteger(length) && length > 0 &&
      offset + length <= payload.length &&
      sha256(payload.subarray(offset, offset + length)) === expectedSha256,
    );
}

function defaultContract() {
  return {
    url: "https://api.devnet.solana.com",
    genesis: DEVNET_GENESIS_HASH,
    program: PLAN_UPLOAD_IDENTITIES.program,
    buffer: PLAN_UPLOAD_IDENTITIES.buffer,
    authority: PLAN_UPLOAD_IDENTITIES.authority,
    owner: PLAN_UPLOAD_IDENTITIES.loader,
  };
}

function expectedCheckpoint(localBytes, state, contract) {
  const buffer = state.deployment?.buffer;
  return {
    program: contract.program,
    buffer: contract.buffer,
    authority: contract.authority,
    owner: contract.owner,
    allocation: localBytes.length + BUFFER_METADATA_LENGTH,
    binaryLength: localBytes.length,
    binarySha256: sha256(localBytes),
    planFingerprint: buffer?.planFingerprint,
  };
}

function assertRequest(request, contract) {
  if (request.acknowledgement !== LIVE_UPLOAD_ACKNOWLEDGEMENT) throw new Error("explicit devnet-write acknowledgement is required");
  if (request.url !== contract.url) throw new Error("exact devnet RPC mismatch");
  if (request.program !== contract.program) throw new Error("program ID mismatch");
  if (request.buffer !== contract.buffer) throw new Error("buffer address mismatch");
  normalizeRatePolicy({ maxChunksPerWindow: request.maxChunks, minimumDelayMs: request.delayMs });
}

export async function preflightUploadExecution(request, adapters) {
  const contract = adapters.contract ?? defaultContract();
  assertRequest(request, contract);
  const rpc = adapters.rpc;
  if (!rpc || rpc.rpcEndpoint !== request.url) throw new Error("explicit live RPC adapter mismatch");
  const genesis = await rpc.getGenesisHash();
  assertDevnetGenesis(genesis, contract.genesis);

  const programKey = new PublicKey(request.program);
  const bufferKey = new PublicKey(request.buffer);
  const programAccount = await rpc.getAccountInfo(programKey, "confirmed");
  if (programAccount !== null) throw new Error("UNEXPECTED_EXISTING_PROGRAM");
  const bufferAccount = await rpc.getAccountInfo(bufferKey, "confirmed");
  if (!bufferAccount) throw new Error("buffer account is absent");

  const localBytes = readFileSync(request.binaryPath);
  const state = JSON.parse(readFileSync(request.statePath, "utf8"));
  const expected = expectedCheckpoint(localBytes, state, contract);
  validateUploadStateV3(state, expected);
  const observedBuffer = inspectUpgradeableBuffer(bufferAccount, {
    publicKey: request.buffer,
    expectedOwner: expected.owner,
    expectedAuthority: expected.authority,
    allocatedLength: expected.allocation,
    localBytes,
  });
  const bufferBytes = Buffer.from(bufferAccount.data).subarray(BUFFER_METADATA_LENGTH);
  const plan = planBufferUpload({
    localBytes,
    bufferBytes,
    buffer: bufferKey,
    authority: new PublicKey(expected.authority),
  });
  const fingerprint = createPlanFingerprint({
    program: expected.program,
    buffer: expected.buffer,
    authority: expected.authority,
    allocation: expected.allocation,
    binarySha256: expected.binarySha256,
    maxPayload: plan.maxPayload,
    chunks: plan.chunks,
  });
  if (fingerprint !== expected.planFingerprint) throw new Error("plan fingerprint mismatch");
  for (const [record, chunk] of state.deployment.buffer.chunks.map((record, index) => [record, plan.chunks[index]])) {
    if (!chunk || record.index !== chunk.index || record.offset !== chunk.offset || record.length !== chunk.length || record.sha256 !== chunk.sha256) {
      throw new Error("plan chunk evidence mismatch");
    }
  }

  const balanceLamports = await rpc.getBalance(new PublicKey(expected.authority), "confirmed");
  const programAccountRentLamports = await rpc.getMinimumBalanceForRentExemption(PROGRAM_ACCOUNT_LENGTH, "confirmed");
  const programDataRentLamports = await rpc.getMinimumBalanceForRentExemption(PROGRAMDATA_METADATA_LENGTH + localBytes.length, "confirmed");
  const funding = calculateFunding({
    balanceLamports,
    programAccountRentLamports,
    programDataRentLamports,
    remainingChunks: plan.remainingChunks,
  });
  if (funding.status !== "SUFFICIENT") throw new Error("BLOCKED_FUNDING");
  return {
    verifiedGenesis: genesis,
    state,
    stateSha256: sha256(readFileSync(request.statePath)),
    localBytes,
    expected,
    observedBuffer,
    bufferDataSha256: sha256(bufferAccount.data),
    plan,
    funding,
    observations: {
      genesisVerified: true,
      programAbsent: true,
      confirmedChunksMatch: confirmedChunksMatch(state, bufferAccount.data),
      buffer: {
        address: expected.buffer,
        owner: observedBuffer.owner,
        authority: observedBuffer.authority,
        allocation: observedBuffer.dataLength,
        planFingerprint: expected.planFingerprint,
      },
    },
    liveWriteExecuted: false,
  };
}

export async function collectLeaseReconciliationInput(request, adapters) {
  const contract = adapters.contract ?? defaultContract();
  if (request.url !== contract.url || request.program !== contract.program || request.buffer !== contract.buffer) {
    throw new Error("lease reconciliation identity mismatch");
  }
  const rpc = adapters.rpc;
  if (!rpc || rpc.rpcEndpoint !== request.url) throw new Error("explicit live RPC adapter mismatch");
  const genesis = await rpc.getGenesisHash();
  assertDevnetGenesis(genesis, contract.genesis);
  const state = JSON.parse(readFileSync(request.statePath, "utf8"));
  if (state.schemaVersion !== 3) throw new Error("uploader state schema must be v3");
  const buffer = state.deployment?.buffer;
  const expected = {
    program: contract.program,
    buffer: contract.buffer,
    authority: contract.authority,
    owner: contract.owner,
    allocation: buffer?.allocatedLength,
    planFingerprint: buffer?.planFingerprint,
  };
  const programAccount = await rpc.getAccountInfo(new PublicKey(expected.program), "confirmed");
  if (programAccount !== null) throw new Error("UNEXPECTED_EXISTING_PROGRAM");
  const account = await rpc.getAccountInfo(new PublicKey(expected.buffer), "confirmed");
  if (!account || account.executable || account.owner.toBase58() !== expected.owner || account.data.length !== expected.allocation || Buffer.from(account.data).readUInt32LE(0) !== 1 || account.data[4] !== 1) {
    throw new Error("buffer on-chain invariant mismatch");
  }
  const authority = new PublicKey(Buffer.from(account.data).subarray(5, 37)).toBase58();
  if (authority !== expected.authority) throw new Error("buffer authority mismatch");
  return {
    statePath: request.statePath,
    executionId: request.executionId,
    expected,
    observations: {
      genesisVerified: true,
      programAbsent: true,
      confirmedChunksMatch: confirmedChunksMatch(state, account.data),
      buffer: {
        address: expected.buffer,
        owner: expected.owner,
        authority,
        allocation: account.data.length,
        planFingerprint: expected.planFingerprint,
      },
    },
  };
}

function appendWindowOutcome(statePath, outcome) {
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const windows = state.deployment?.buffer?.uploadWindows;
  if (!Array.isArray(windows)) throw new Error("upload windows are required");
  if (windows.some(({ executionId }) => executionId === outcome.executionId)) {
    throw new Error("duplicate upload execution ID");
  }
  windows.push(outcome);
  saveStateAtomic(statePath, state);
}

function classifyTerminalError(statePath, error) {
  if (/signer mismatch/i.test(String(error?.message))) return "SIGNER_MISMATCH";
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    if (state.deployment?.buffer?.chunks?.some((chunk) => chunk.status === "SENT" || chunk.status === "UNKNOWN")) {
      return "RPC_OUTCOME_UNKNOWN";
    }
  } catch {
    return "STATE_PERSISTENCE_ERROR";
  }
  return "EXECUTION_ERROR";
}

export async function executeUploadWindow(request, adapters) {
  const preflight = await preflightUploadExecution(request, adapters);
  const executionId = (adapters.executionId ?? randomUUID)();
  const startedAt = (adapters.now ?? (() => new Date().toISOString()))();
  acquireUploadLease({
    statePath: request.statePath,
    executionId,
    pid: adapters.pid ?? process.pid,
    hostname: adapters.hostname ?? hostname(),
    startedAt,
    program: preflight.expected.program,
    buffer: preflight.expected.buffer,
    planFingerprint: preflight.expected.planFingerprint,
    stateSha256: preflight.stateSha256,
  });

  const chunks = preflight.plan.chunks.map((chunk) => ({
    ...chunk,
    bytes: preflight.localBytes.subarray(chunk.offset, chunk.offset + chunk.length),
  }));
  let authority;
  const sign = async (chunk) => {
    authority ??= await adapters.loadAuthorityKeypair(request.authorityPath);
    if (authority?.publicKey?.toBase58() !== preflight.expected.authority) {
      throw new Error("buffer authority signer mismatch");
    }
    const latestBlockhash = await adapters.getLatestBlockhash();
    return adapters.buildAndSign({
      chunk,
      latestBlockhash,
      authority,
      buffer: new PublicKey(preflight.expected.buffer),
    });
  };

  let result;
  let liveWriteAttempted = false;
  try {
    result = await runPersistedSequentialUpload({
      statePath: request.statePath,
      checkpoint: preflight.expected,
      chunks,
      policy: { maxChunksPerWindow: request.maxChunks, minimumDelayMs: request.delayMs },
      sign,
      send: async (signed, chunk) => {
        liveWriteAttempted = true;
        return adapters.sendRawTransaction(signed.rawTransaction, chunk);
      },
      confirm: adapters.confirmSignature,
      readChunkMatches: adapters.readChunkMatches,
      sleep: adapters.sleep,
    });
  } catch (error) {
    appendWindowOutcome(request.statePath, {
      executionId,
      status: classifyTerminalError(request.statePath, error),
      terminal: true,
      startedAt,
      finishedAt: (adapters.now ?? (() => new Date().toISOString()))(),
      maxChunks: request.maxChunks,
      delayMs: request.delayMs,
    });
    throw error;
  }
  appendWindowOutcome(request.statePath, {
    executionId,
    status: result.status,
    terminal: true,
    startedAt,
    finishedAt: (adapters.now ?? (() => new Date().toISOString()))(),
    maxChunks: request.maxChunks,
    delayMs: request.delayMs,
    processed: result.processed,
    sent: result.sent,
    confirmedIndexes: result.confirmedIndexes,
    skippedIndexes: result.skippedIndexes,
  });
  return {
    command: "upload-buffer-throttled",
    executionId,
    status: result.status,
    processed: result.processed,
    sent: result.sent,
    confirmedIndexes: result.confirmedIndexes,
    skippedIndexes: result.skippedIndexes,
    leaseLifecycle: "RECONCILIATION_REQUIRED",
    liveWriteAttempted,
    liveWriteExecuted: result.confirmedIndexes.length > 0 ? true : liveWriteAttempted ? null : false,
    stateMutation: true,
  };
}

export function encodeBase58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      const value = digits[index] * 256 + carry;
      digits[index] = value % 58;
      carry = Math.floor(value / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  for (let index = 0; index < bytes.length - 1 && bytes[index] === 0; index += 1) digits.push(0);
  return digits.reverse().map((digit) => alphabet[digit]).join("");
}

export function createProductionUploadDependencies(url, { bufferAddress = PLAN_UPLOAD_IDENTITIES.buffer } = {}) {
  const connection = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    rpc: connection,
    loadAuthorityKeypair(path) {
      const bytes = JSON.parse(readFileSync(path, "utf8"));
      return Keypair.fromSecretKey(Uint8Array.from(bytes));
    },
    getLatestBlockhash: () => connection.getLatestBlockhash("confirmed"),
    buildAndSign({ chunk, latestBlockhash, authority, buffer }) {
      const transaction = new Transaction({
        feePayer: authority.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
      }).add(makeLoaderV3WriteInstruction({
        buffer,
        authority: authority.publicKey,
        offset: chunk.offset,
        bytes: chunk.bytes,
      }));
      transaction.sign(authority);
      return {
        signature: encodeBase58(transaction.signature),
        rawTransaction: transaction.serialize(),
      };
    },
    sendRawTransaction: (rawTransaction) => connection.sendRawTransaction(rawTransaction, { maxRetries: 0, skipPreflight: true }),
    async confirmSignature(signature, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const response = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
        const status = response.value[0];
        if (status?.err || status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return status;
        await sleep(250);
      }
      return null;
    },
    async readChunkMatches(chunk) {
      const account = await connection.getAccountInfo(new PublicKey(bufferAddress), "confirmed");
      if (!account) return false;
      return Buffer.from(account.data)
        .subarray(BUFFER_METADATA_LENGTH + chunk.offset, BUFFER_METADATA_LENGTH + chunk.offset + chunk.length)
        .equals(chunk.bytes);
    },
    sleep,
  };
}
