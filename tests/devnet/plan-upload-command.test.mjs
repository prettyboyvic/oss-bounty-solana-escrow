import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";

import {
  calculateFunding,
  createPlanUploadConnection,
  executePlanUpload,
  runPlanUploadCommand,
} from "../../scripts/devnet/plan-upload-command.mjs";

const RPC = "https://api.devnet.solana.com";
const GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const PROGRAM = "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z";
const BUFFER = "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW";
const AUTHORITY = "Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk";
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const LOCAL = Buffer.from([1, 2, 3, 4, 5, 6]);
const SHA256 = createHash("sha256").update(LOCAL).digest("hex");

function checkpoint(overrides = {}) {
  return {
    rpcUrl: RPC,
    genesisHash: GENESIS,
    programId: PROGRAM,
    bufferAddress: BUFFER,
    bufferOwner: LOADER,
    authority: AUTHORITY,
    bufferAllocation: LOCAL.length + 37,
    binaryLength: LOCAL.length,
    binarySha256: SHA256,
    ...overrides,
  };
}

function bufferAccount(programBytes = Buffer.from(LOCAL), overrides = {}) {
  const { authority = AUTHORITY, owner = LOADER, ...accountOverrides } = overrides;
  const data = Buffer.alloc(37 + programBytes.length);
  data.writeUInt32LE(1, 0);
  data[4] = 1;
  new PublicKey(authority).toBuffer().copy(data, 5);
  programBytes.copy(data, 37);
  return {
    data,
    executable: false,
    lamports: 2_000_000,
    owner: new PublicKey(owner),
    rentEpoch: 0,
    ...accountOverrides,
  };
}

function rpcDouble({ genesisHash = GENESIS, programAccount = null, buffer = bufferAccount() } = {}) {
  const calls = [];
  const read = (name, value) => async (...args) => {
    calls.push({ name, args });
    return typeof value === "function" ? value(...args) : value;
  };
  const forbidden = (name) => async () => {
    calls.push({ name, args: [] });
    throw new Error(`forbidden RPC method ${name}`);
  };
  return {
    rpcEndpoint: RPC,
    calls,
    getGenesisHash: read("getGenesisHash", genesisHash),
    getAccountInfo: read("getAccountInfo", (key) => key.toBase58() === PROGRAM ? programAccount : buffer),
    getBalance: read("getBalance", 100_000_000),
    getMinimumBalanceForRentExemption: read("getMinimumBalanceForRentExemption", (length) => length * 10),
    getSignaturesForAddress: read("getSignaturesForAddress", []),
    getLatestBlockhash: forbidden("getLatestBlockhash"),
    requestAirdrop: forbidden("requestAirdrop"),
    sendRawTransaction: forbidden("sendRawTransaction"),
    sendTransaction: forbidden("sendTransaction"),
    simulateTransaction: forbidden("simulateTransaction"),
  };
}

test("funding accounting preserves the approved 250M reserve and separates every component", () => {
  const funding = calculateFunding({
    balanceLamports: 3_247_383_680,
    programAccountRentLamports: 1_141_440,
    programDataRentLamports: 2_751_406_320,
    remainingChunks: 172,
  });
  assert.deepEqual(funding.networkFeeEstimate, {
    remainingChunkFeesLamports: 1_720_000,
    finalizeDeployFeeLamports: 10_000,
    totalLamports: 1_730_000,
    conservativePerTransactionLamports: 10_000,
    assumptions: [
      "10,000 lamports per one-signature transaction, conservatively above the 5,000-lamport base fee.",
      "One transaction for each proven nonmatching full chunk plus one finalize/deploy transaction.",
      "No live blockhash or fee RPC is required for this deterministic estimate.",
    ],
  });
  assert.equal(funding.existingBufferRentAdditionalLamports, 0);
  assert.equal(funding.programAccountRentLamports, 1_141_440);
  assert.equal(funding.programDataRentLamports, 2_751_406_320);
  assert.equal(funding.operationalReserveLamports, 250_000_000);
  assert.equal(funding.requiredRemainingBalanceLamports, 3_004_277_760);
  assert.equal(funding.headroomAfterReserveLamports, 243_105_920);
  assert.equal(funding.status, "SUFFICIENT");
});

test("funding boundary reports BLOCKED_FUNDING one lamport below the full requirement", () => {
  const input = {
    programAccountRentLamports: 1_141_440,
    programDataRentLamports: 2_751_406_320,
    remainingChunks: 172,
  };
  assert.equal(calculateFunding({ ...input, balanceLamports: 3_004_277_760 }).status, "SUFFICIENT");
  const blocked = calculateFunding({ ...input, balanceLamports: 3_004_277_759 });
  assert.equal(blocked.status, "BLOCKED_FUNDING");
  assert.equal(blocked.headroomAfterReserveLamports, -1);
});

test("live RPC transport does not retry a read when the endpoint returns 429", async () => {
  let requests = 0;
  const connection = createPlanUploadConnection(RPC, {
    fetch: async () => {
      requests += 1;
      return new Response("rate limited", { status: 429, statusText: "Too Many Requests" });
    },
  });
  await assert.rejects(connection.getGenesisHash(), /429|Too Many Requests|rate limited/i);
  assert.equal(requests, 1);
});

test("rejects missing or implicit RPC and every non-exact devnet endpoint", async () => {
  for (const rpcUrl of [undefined, "", "https://api.mainnet-beta.solana.com", "https://api.testnet.solana.com", "http://localhost:8899", "https://example.com"]) {
    await assert.rejects(executePlanUpload({ rpcUrl, checkpoint: checkpoint(), localBytes: LOCAL, rpc: rpcDouble() }), /explicit Solana devnet RPC URL/);
  }
});

test("rejects unknown, wrong-devnet and other-cluster genesis hashes", async () => {
  for (const genesisHash of ["unknown", "wrong-devnet", "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z"]) {
    await assert.rejects(executePlanUpload({ rpcUrl: RPC, checkpoint: checkpoint(), localBytes: LOCAL, rpc: rpcDouble({ genesisHash }) }), /genesis hash mismatch/);
  }
});

test("fails closed on wrong checkpoint identities, allocation or binary evidence", async () => {
  const cases = [
    ["programId", BUFFER, /program ID mismatch/],
    ["bufferAddress", PROGRAM, /buffer address mismatch/],
    ["bufferOwner", PROGRAM, /buffer owner mismatch/],
    ["authority", PROGRAM, /buffer authority mismatch/],
    ["bufferAllocation", 99, /buffer allocation mismatch/],
    ["binaryLength", 99, /binary length mismatch/],
    ["binarySha256", "0".repeat(64), /binary SHA-256 mismatch/],
  ];
  for (const [field, value, pattern] of cases) {
    await assert.rejects(executePlanUpload({ rpcUrl: RPC, checkpoint: checkpoint({ [field]: value }), localBytes: LOCAL, rpc: rpcDouble() }), pattern);
  }
  await assert.rejects(executePlanUpload({ rpcUrl: RPC, checkpoint: checkpoint(), localBytes: LOCAL, rpc: rpcDouble({ buffer: bufferAccount(LOCAL, { owner: PROGRAM }) }) }), /buffer owner mismatch/);
  await assert.rejects(executePlanUpload({ rpcUrl: RPC, checkpoint: checkpoint(), localBytes: LOCAL, rpc: rpcDouble({ buffer: bufferAccount(LOCAL, { authority: PROGRAM }) }) }), /buffer authority mismatch/);
});

test("requires the canonical program account to be absent at this checkpoint", async () => {
  const existing = { data: Buffer.alloc(36), executable: true, lamports: 1, owner: new PublicKey(LOADER), rentEpoch: 0 };
  await assert.rejects(executePlanUpload({ rpcUrl: RPC, checkpoint: checkpoint(), localBytes: LOCAL, rpc: rpcDouble({ programAccount: existing }) }), /UNEXPECTED_EXISTING_PROGRAM/);
});

test("returns a sanitized read-only plan and calls only allowlisted read methods", async () => {
  const partial = Buffer.from([1, 2, 9, 4, 0, 6]);
  const rpc = rpcDouble({ buffer: bufferAccount(partial) });
  const report = await executePlanUpload({ rpcUrl: RPC, checkpoint: checkpoint(), localBytes: LOCAL, rpc, maxPayload: 2 });

  assert.equal(report.rpc, RPC);
  assert.equal(report.verifiedGenesis, GENESIS);
  assert.deepEqual(report.identities, { program: PROGRAM, buffer: BUFFER, authority: AUTHORITY });
  assert.deepEqual(report.binary, { length: LOCAL.length, sha256: SHA256 });
  assert.equal(report.bufferAllocation, LOCAL.length + 37);
  assert.equal(report.packetCeiling, 1232);
  assert.equal(report.derivedPayloadSize, 2);
  assert.equal(report.totalPlannedChunks, 3);
  assert.equal(report.exactMatchingChunks, 1);
  assert.equal(report.remainingChunks, 2);
  assert.equal(report.remainingTransactions.basis, "PROVEN_ONE_TRANSACTION_PER_NONMATCHING_FULL_CHUNK");
  assert.equal(report.equalBytePositions.classification, "NOT_AN_UPLOAD_OFFSET");
  assert.deepEqual(report.equalBytePositions.ranges, [[0, 1], [3, 3], [5, 5]]);
  assert.ok(report.maximumSerializedTransactionSize <= report.packetCeiling - 1);
  assert.match(report.networkFeeEstimate.assumptions.join(" "), /conservative/i);
  assert.equal(report.funding.balanceLamports, 100_000_000);
  assert.equal(report.funding.operationalReserveLamports, 250_000_000);
  assert.equal(report.funding.status, "BLOCKED_FUNDING");
  assert.equal(report.funding.requiredRemainingBalanceLamports, report.funding.programAccountRentLamports + report.funding.programDataRentLamports + report.networkFeeEstimate.totalLamports + report.funding.operationalReserveLamports);
  assert.equal(report.funding.headroomAfterReserveLamports, report.funding.balanceLamports - report.funding.requiredRemainingBalanceLamports);
  assert.equal(report.stateMutation, false);
  assert.equal(report.liveUploadEnabled, false);
  assert.deepEqual(report.rpcCallAudit, ["getGenesisHash", "getAccountInfo", "getAccountInfo", "getBalance", "getMinimumBalanceForRentExemption", "getMinimumBalanceForRentExemption", "getSignaturesForAddress"]);

  const output = JSON.stringify(report);
  assert.doesNotMatch(output, /mnemonic|privateKey|secretKey|[A-Z]:\\|[/\\]\.devnet[/\\]|keypair\.json/i);
  assert.deepEqual(new Set(rpc.calls.map(({ name }) => name)), new Set(["getGenesisHash", "getAccountInfo", "getBalance", "getMinimumBalanceForRentExemption", "getSignaturesForAddress"]));
});

test("command harness leaves supplied state and all surrounding files untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "plan-upload-no-mutation-"));
  const configPath = join(dir, "config.json");
  const statePath = join(dir, "state.json");
  const binaryPath = join(dir, "program.so");
  writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, cluster: { name: "devnet", rpcUrl: RPC, genesisHash: GENESIS }, programId: PROGRAM, token: { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", displayLabel: "DEVTEST", decimals: 6 } }));
  writeFileSync(statePath, JSON.stringify({ schemaVersion: 2, identities: { program: PROGRAM, deploymentAuthority: AUTHORITY }, deployment: { buffer: { publicKey: BUFFER, expectedOwner: LOADER, expectedAuthority: AUTHORITY, allocatedLength: LOCAL.length + 37, localBinary: { length: LOCAL.length, sha256: SHA256 } } } }));
  writeFileSync(binaryPath, LOCAL);
  const snapshot = () => ({
    files: readdirSync(dir).sort(),
    stateHash: createHash("sha256").update(readFileSync(statePath)).digest("hex"),
    stateMtimeMs: statSync(statePath).mtimeMs,
  });
  const rpc = rpcDouble();
  const before = snapshot();
  const balanceBefore = 100_000_000;
  const historyBefore = 0;
  const accountBefore = createHash("sha256").update(bufferAccount().data).digest("hex");

  const report = await runPlanUploadCommand({ argv: ["plan-upload", "--rpc", RPC], paths: { configPath, statePath, binaryPath }, createRpc: () => rpc });

  assert.equal(report.stateMutation, false);
  assert.deepEqual(snapshot(), before);
  assert.equal(report.funding.balanceLamports, balanceBefore);
  assert.equal(report.bufferHistoryCount, historyBefore);
  assert.equal(report.bufferDataSha256, accountBefore);
  assert.ok(rpc.calls.every(({ name }) => ["getGenesisHash", "getAccountInfo", "getBalance", "getMinimumBalanceForRentExemption", "getSignaturesForAddress"].includes(name)));
});
