import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PublicKey, Transaction } from "@solana/web3.js";

import { makeLoaderV3WriteInstruction } from "../../scripts/devnet/loader-v3-codec.mjs";
import { PLAN_UPLOAD_IDENTITIES } from "../../scripts/devnet/plan-upload-command.mjs";
import { createRpcRequestLedger } from "../../scripts/devnet/rpc-request-ledger.mjs";
import { createRpcRequestScheduler } from "../../scripts/devnet/rpc-request-scheduler.mjs";
import { createPlanFingerprint } from "../../scripts/devnet/throttled-uploader.mjs";
import { planBufferUpload } from "../../scripts/devnet/upload-plan.mjs";
import {
  encodeBase58,
  collectLeaseReconciliationInput,
  createProductionUploadDependencies,
  executeUploadWindow,
  preflightUploadExecution,
} from "../../scripts/devnet/upload-execution-command.mjs";
import {
  acquireUploadLease,
  leasePaths,
  reconcileUploadLease,
} from "../../scripts/devnet/upload-execution-lease.mjs";

const RPC = "https://api.devnet.solana.com";
const GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const OWNER = "BPFLoaderUpgradeab1e11111111111111111111111";
const METADATA_LENGTH = 37;
const PUBLIC_SIGNATURE = "1".repeat(64);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function publicTestSignature(index) {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32LE(index + 1);
  return encodeBase58(bytes);
}

function bufferAccount(programBytes, overrides = {}) {
  const data = Buffer.alloc(METADATA_LENGTH + programBytes.length);
  data.writeUInt32LE(1, 0);
  data[4] = 1;
  new PublicKey(overrides.authority ?? PLAN_UPLOAD_IDENTITIES.authority).toBuffer().copy(data, 5);
  Buffer.from(programBytes).copy(data, METADATA_LENGTH);
  return {
    data,
    owner: new PublicKey(overrides.owner ?? OWNER),
    executable: false,
    lamports: 1,
    rentEpoch: 0,
  };
}

function fixture({ chunks = 2, status = "PLANNED", confirmedChunks = null, balance } = {}) {
  const root = mkdtempSync(join(tmpdir(), "upload-execution-"));
  const statePath = join(root, "state.json");
  const binaryPath = join(root, "program.so");
  const authorityPath = join(root, "authority.json");
  const localBytes = Buffer.from(Array.from({ length: chunks * 1011 }, (_, index) => (index % 250) + 1));
  const currentBytes = Buffer.alloc(localBytes.length);
  const plan = planBufferUpload({
    localBytes,
    bufferBytes: currentBytes,
    buffer: new PublicKey(PLAN_UPLOAD_IDENTITIES.buffer),
    authority: new PublicKey(PLAN_UPLOAD_IDENTITIES.authority),
  });
  assert.equal(plan.totalChunks, chunks);
  const allocation = localBytes.length + METADATA_LENGTH;
  const fingerprint = createPlanFingerprint({
    program: PLAN_UPLOAD_IDENTITIES.program,
    buffer: PLAN_UPLOAD_IDENTITIES.buffer,
    authority: PLAN_UPLOAD_IDENTITIES.authority,
    allocation,
    binarySha256: sha256(localBytes),
    maxPayload: plan.maxPayload,
    chunks: plan.chunks,
  });
  const records = plan.chunks.map(({ index, offset, length, sha256: chunkSha256 }) => {
    const recordStatus = confirmedChunks === null ? status : index < confirmedChunks ? "CONFIRMED" : "PLANNED";
    return {
      index,
      offset,
      length,
      sha256: chunkSha256,
      status: recordStatus,
      signature: recordStatus === "PLANNED" ? null : confirmedChunks === null ? PUBLIC_SIGNATURE : publicTestSignature(index),
    };
  });
  const state = {
    schemaVersion: 3,
    identities: { program: PLAN_UPLOAD_IDENTITIES.program },
    deployment: {
      buffer: {
        publicKey: PLAN_UPLOAD_IDENTITIES.buffer,
        expectedOwner: OWNER,
        expectedAuthority: PLAN_UPLOAD_IDENTITIES.authority,
        allocatedLength: allocation,
        localBinary: { length: localBytes.length, sha256: sha256(localBytes) },
        planFingerprint: fingerprint,
        chunks: records,
        uploadWindows: [],
      },
    },
  };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  writeFileSync(binaryPath, localBytes);
  writeFileSync(authorityPath, "test-only-placeholder");
  const account = bufferAccount(currentBytes);
  if (confirmedChunks !== null) {
    for (const chunk of plan.chunks.slice(0, confirmedChunks)) {
      localBytes.copy(account.data, METADATA_LENGTH + chunk.offset, chunk.offset, chunk.offset + chunk.length);
    }
  }
  const calls = [];
  const rpc = {
    rpcEndpoint: RPC,
    getGenesisHash: async () => { calls.push("genesis"); return GENESIS; },
    getAccountInfo: async (key) => {
      const address = key.toBase58();
      calls.push(address === PLAN_UPLOAD_IDENTITIES.program ? "program" : "buffer");
      return address === PLAN_UPLOAD_IDENTITIES.program ? null : account;
    },
    getAccountInfoAndContext: async (key, options) => {
      assert.equal(key.toBase58(), PLAN_UPLOAD_IDENTITIES.buffer);
      assert.deepEqual(options, { commitment: "finalized" });
      calls.push("buffer");
      return { context: { slot: 55 }, value: account };
    },
    getBalance: async () => { calls.push("balance"); return balance ?? 10_000_000_000; },
    getMinimumBalanceForRentExemption: async (length) => { calls.push(`rent:${length}`); return length === 36 ? 100 : 200; },
  };
  const request = {
    command: "upload-buffer-throttled",
    url: RPC,
    program: PLAN_UPLOAD_IDENTITIES.program,
    buffer: PLAN_UPLOAD_IDENTITIES.buffer,
    statePath,
    authorityPath,
    binaryPath,
    maxChunks: 5,
    delayMs: 1000,
    acknowledgement: "R4_BUFFER_UPLOAD",
  };
  return { root, statePath, binaryPath, authorityPath, localBytes, currentBytes, account, rpc, calls, request, state, plan, fingerprint, allocation };
}

function productionRuntime(input, connectionOverrides = {}) {
  let monotonicMs = 0;
  const schedulerSleeps = [];
  const connection = Object.assign(input.rpc, {
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
    sendRawTransaction: async () => "test-signature",
    getSignatureStatuses: async () => ({ value: [{ err: null, confirmationStatus: "finalized" }] }),
  }, connectionOverrides);
  const dependencies = createProductionUploadDependencies(RPC, {
    connection,
    bufferAddress: PLAN_UPLOAD_IDENTITIES.buffer,
    monotonicNow: () => monotonicMs,
    schedulerSleep: async (ms) => { schedulerSleeps.push(ms); monotonicMs += ms; },
    transactionSleep: async () => {},
  });
  dependencies.loadAuthorityKeypair = async () => ({ publicKey: new PublicKey(PLAN_UPLOAD_IDENTITIES.authority) });
  dependencies.buildAndSign = async ({ chunk }) => ({
    signature: `signature-${chunk.index}`,
    rawTransaction: Buffer.from([chunk.index]),
  });
  return { dependencies, schedulerSleeps, monotonicNow: () => monotonicMs };
}

test("preflight validates ordered read-only invariants without signer, blockhash or send", async () => {
  const input = fixture();
  const forbidden = [];
  const result = await preflightUploadExecution(input.request, {
    rpc: input.rpc,
    loadAuthorityKeypair: () => forbidden.push("signer"),
    getLatestBlockhash: () => forbidden.push("blockhash"),
    sendRawTransaction: () => forbidden.push("send"),
  });
  assert.deepEqual(input.calls, ["genesis", "program", "buffer", "balance", "rent:36", `rent:${45 + input.localBytes.length}`]);
  assert.deepEqual(forbidden, []);
  assert.equal(result.plan.remainingChunks, 2);
  assert.equal(result.funding.operationalReserveLamports, 250_000_000);
  assert.equal(result.liveWriteExecuted, false);
  assert.equal(existsSync(leasePaths(input.statePath).activeDirectory), false);
});

test("preflight records all read calls in one sanitized invocation ledger", async () => {
  const input = fixture();
  let tick = 0;
  const ledger = createRpcRequestLedger({ monotonicNow: () => tick++ });
  await preflightUploadExecution(input.request, {
    rpc: input.rpc,
    rpcRequestLedger: ledger,
  });

  const summary = ledger.summary();
  assert.equal(summary.totalRecorded, 6);
  assert.equal(summary.countsByMethod.GET_GENESIS_HASH, 1);
  assert.equal(summary.countsByMethod.GET_ACCOUNT_INFO, 2);
  assert.equal(summary.countsByMethod.GET_BALANCE, 1);
  assert.equal(summary.countsByMethod.GET_RENT_EXEMPTION, 2);
  assert.equal(summary.countsByMethod.GET_LATEST_BLOCKHASH, 0);
  assert.equal(summary.countsByMethod.SEND_RAW_TRANSACTION, 0);
});

test("production dependency set owns one shared scheduler and empty bounded ledger without making RPC calls", () => {
  const dependencies = createProductionUploadDependencies("http://127.0.0.1:8899");
  assert.deepEqual(dependencies.rpcRequestScheduler.policy(), {
    concurrency: 1,
    queueCapacity: 256,
    ledgerCapacity: 256,
    minimumRequestStartGapMs: 500,
    retryBackoffMs: [2000, 5000],
  });
  assert.equal(dependencies.rpcRequestScheduler.ledger, dependencies.rpcRequestLedger);
  assert.deepEqual(dependencies.rpcRequestPolicy, {
    globalRequestStartGapMs: 500,
    confirmationPollIntervalMs: 2000,
    rateLimitRetryScheduleMs: [2000, 5000],
  });
  assert.deepEqual(dependencies.rpcRequestLedger.summary(), {
    capacity: 256,
    totalRecorded: 0,
    retained: 0,
    dropped: 0,
    countsByOutcome: { SUCCESS: 0, RPC_RATE_LIMITED: 0, RPC_ERROR: 0 },
    countsByMethod: {
      GET_GENESIS_HASH: 0,
      GET_ACCOUNT_INFO: 0,
      GET_BALANCE: 0,
      GET_RENT_EXEMPTION: 0,
      GET_SIGNATURE_HISTORY: 0,
      GET_LATEST_BLOCKHASH: 0,
      GET_FEE_FOR_MESSAGE: 0,
      GET_SIGNATURE_STATUSES: 0,
      GET_TRANSACTION: 0,
      SEND_RAW_TRANSACTION: 0,
    },
  });
});

test("three roughly 13-second finalized confirmations use bounded 2000ms normal polls", async (t) => {
  let now = 0;
  const startsBySignature = new Map();
  const connection = {
    rpcEndpoint: RPC,
    async getSignatureStatuses([signature]) {
      const starts = startsBySignature.get(signature) ?? [];
      starts.push(now);
      startsBySignature.set(signature, starts);
      return { value: [{ err: null, confirmationStatus: starts[0] + 12_000 <= now ? "finalized" : "processed" }] };
    },
  };
  const dependencies = createProductionUploadDependencies(RPC, {
    connection,
    monotonicNow: () => now,
    schedulerSleep: async (ms) => { now += ms; },
    transactionSleep: async (ms) => { now += ms; },
  });

  for (const signature of ["signature-a", "signature-b", "signature-c"]) {
    const status = await dependencies.confirmSignature(signature, 30_000);
    assert.equal(status.confirmationStatus, "finalized");
  }
  const starts = [...startsBySignature.values()];
  for (const signatureStarts of starts) {
    assert.ok(signatureStarts.slice(1).every((value, index) => value - signatureStarts[index] >= 2000));
  }
  assert.ok(starts.flat().length < 46);
  t.diagnostic(`three-confirmation status request count: ${starts.flat().length}`);
  assert.deepEqual([...startsBySignature.keys()], ["signature-a", "signature-b", "signature-c"]);
  await dependencies.rpcRequestScheduler.close();
});

test("status retry backoff and normal polling floor cannot overlap or burst", async () => {
  let now = 0;
  const starts = [];
  const signatures = [];
  let calls = 0;
  const connection = {
    rpcEndpoint: RPC,
    async getSignatureStatuses([signature]) {
      starts.push(now);
      signatures.push(signature);
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("rate limited"), { status: 429 });
      return { value: [{ err: null, confirmationStatus: calls === 2 ? "processed" : "finalized" }] };
    },
  };
  const dependencies = createProductionUploadDependencies(RPC, {
    connection,
    monotonicNow: () => now,
    schedulerSleep: async (ms) => { now += ms; },
    transactionSleep: async (ms) => { now += ms; },
  });

  const status = await dependencies.confirmSignature("same-signature", 30_000);
  assert.equal(status.confirmationStatus, "finalized");
  assert.deepEqual(signatures, ["same-signature", "same-signature", "same-signature"]);
  assert.ok(starts[1] - starts[0] >= 2000);
  assert.ok(starts[2] - starts[1] >= 2000);
  assert.equal(dependencies.rpcRequestLedger.summary().countsByMethod.GET_SIGNATURE_STATUSES, 3);
  await dependencies.rpcRequestScheduler.close();
});

test("confirmed is nonterminal until the same signature reaches finalized", async () => {
  let now = 0;
  const signatures = [];
  const statuses = ["confirmed", "finalized"];
  const dependencies = createProductionUploadDependencies(RPC, {
    connection: {
      rpcEndpoint: RPC,
      async getSignatureStatuses([signature]) {
        signatures.push(signature);
        return { value: [{ err: null, confirmationStatus: statuses.shift() }] };
      },
    },
    monotonicNow: () => now,
    schedulerSleep: async (ms) => { now += ms; },
    transactionSleep: async (ms) => { now += ms; },
  });

  const status = await dependencies.confirmSignature("one-signature", 30_000);
  assert.equal(status.confirmationStatus, "finalized");
  assert.deepEqual(signatures, ["one-signature", "one-signature"]);
  await dependencies.rpcRequestScheduler.close();
});

test("production preflight routes a rate-limited read through initial plus two bounded scheduler attempts", async () => {
  const input = fixture();
  let now = 0;
  const sleeps = [];
  const scheduler = createRpcRequestScheduler({
    monotonicNow: () => now,
    sleep: async (ms) => { sleeps.push(ms); now += ms; },
  });
  let genesisAttempts = 0;
  input.rpc.getGenesisHash = async () => {
    genesisAttempts += 1;
    if (genesisAttempts < 3) throw Object.assign(new Error("rate limited"), { status: 429 });
    return GENESIS;
  };

  await preflightUploadExecution(input.request, { rpc: input.rpc, rpcRequestScheduler: scheduler });
  assert.equal(genesisAttempts, 3);
  assert.deepEqual(sleeps.slice(0, 2), [2000, 5000]);
  assert.deepEqual(scheduler.ledger.debugSafeEntries().slice(0, 3).map(({ methodClass, retryNumber }) => ({ methodClass, retryNumber })), [
    { methodClass: "GET_GENESIS_HASH", retryNumber: 0 },
    { methodClass: "GET_GENESIS_HASH", retryNumber: 1 },
    { methodClass: "GET_GENESIS_HASH", retryNumber: 2 },
  ]);
  await scheduler.close();
});

test("production execution enforces the 3000ms pre-sign cool-off before blockhash", async () => {
  const input = fixture({ chunks: 1 });
  let blockhashStartedAt = null;
  const runtime = productionRuntime(input, {
    getLatestBlockhash: async () => {
      blockhashStartedAt = runtime.monotonicNow();
      return { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 };
    },
  });
  runtime.dependencies.readChunkMatches = async () => true;
  const result = await executeUploadWindow(input.request, {
    ...runtime.dependencies,
    executionId: () => "cool-off-window",
    pid: 8001,
    hostname: "test-host",
    now: () => "2026-07-20T00:00:00.000Z",
  });
  assert.equal(result.status, "COMPLETE");
  const entries = runtime.dependencies.rpcRequestLedger.debugSafeEntries();
  const finalPreflight = entries.filter(({ methodClass }) => methodClass === "GET_RENT_EXEMPTION").at(-1);
  assert.ok(blockhashStartedAt - finalPreflight.endMonotonicMs >= 3000);
  assert.ok(runtime.schedulerSleeps.includes(3000));
  await runtime.dependencies.rpcRequestScheduler.close();
});

test("blockhash 429 exhaustion remains pre-sign with zero signature, SENT, and send", async () => {
  const input = fixture({ chunks: 1 });
  let blockhashCalls = 0;
  let sendCalls = 0;
  let signCalls = 0;
  const runtime = productionRuntime(input, {
    getLatestBlockhash: async () => {
      blockhashCalls += 1;
      throw Object.assign(new Error("rate limited"), { status: 429 });
    },
    sendRawTransaction: async () => { sendCalls += 1; },
  });
  runtime.dependencies.buildAndSign = async () => { signCalls += 1; throw new Error("must not sign"); };
  await assert.rejects(executeUploadWindow(input.request, {
    ...runtime.dependencies,
    executionId: () => "blockhash-exhaustion",
    pid: 8002,
    hostname: "test-host",
    now: () => "2026-07-20T00:00:00.000Z",
  }), (error) => error.classification === "RPC_RATE_LIMITED" && error.methodClass === "GET_LATEST_BLOCKHASH");
  assert.equal(blockhashCalls, 3);
  assert.equal(signCalls, 0);
  assert.equal(sendCalls, 0);
  assert.deepEqual(JSON.parse(readFileSync(input.statePath)).deployment.buffer.chunks.map(({ status, signature }) => ({ status, signature })), [
    { status: "PLANNED", signature: null },
  ]);
  assert.ok(runtime.schedulerSleeps.includes(2000));
  assert.ok(runtime.schedulerSleeps.includes(5000));
  await runtime.dependencies.rpcRequestScheduler.close();
});

test("blockhash retry fails closed if the chunk stops being PLANNED between attempts", async () => {
  const input = fixture({ chunks: 1 });
  let blockhashCalls = 0;
  let sendCalls = 0;
  const runtime = productionRuntime(input, {
    getLatestBlockhash: async () => {
      blockhashCalls += 1;
      if (blockhashCalls === 1) {
        const state = JSON.parse(readFileSync(input.statePath));
        state.deployment.buffer.chunks[0].status = "SENT";
        state.deployment.buffer.chunks[0].signature = PUBLIC_SIGNATURE;
        writeFileSync(input.statePath, `${JSON.stringify(state, null, 2)}\n`);
      }
      throw Object.assign(new Error("rate limited"), { status: 429 });
    },
    sendRawTransaction: async () => { sendCalls += 1; },
  });
  await assert.rejects(executeUploadWindow(input.request, {
    ...runtime.dependencies,
    executionId: () => "blockhash-state-drift",
    pid: 8005,
    hostname: "test-host",
    now: () => "2026-07-20T00:00:00.000Z",
  }), /blockhash checkpoint drift/);
  assert.equal(blockhashCalls, 1);
  assert.equal(sendCalls, 0);
  await runtime.dependencies.rpcRequestScheduler.close();
});

test("send 429 is attempted once and leaves the same persisted signature for reconciliation", async () => {
  const input = fixture({ chunks: 2 });
  let sendCalls = 0;
  const runtime = productionRuntime(input, {
    sendRawTransaction: async () => {
      sendCalls += 1;
      throw Object.assign(new Error("rate limited"), { status: 429 });
    },
  });
  const result = await executeUploadWindow(input.request, {
    ...runtime.dependencies,
    executionId: () => "send-rate-limit",
    pid: 8003,
    hostname: "test-host",
    now: () => "2026-07-20T00:00:00.000Z",
  });
  assert.equal(result.status, "RATE_LIMITED");
  assert.equal(sendCalls, 1);
  assert.deepEqual(JSON.parse(readFileSync(input.statePath)).deployment.buffer.chunks.map(({ status, signature }) => ({ status, signature })), [
    { status: "SENT", signature: "signature-0" },
    { status: "PLANNED", signature: null },
  ]);
  assert.equal(runtime.dependencies.rpcRequestLedger.summary().countsByMethod.SEND_RAW_TRANSACTION, 1);
  await runtime.dependencies.rpcRequestScheduler.close();
});

test("confirmation 429 exhaustion polls only the same signature and never advances the next chunk", async () => {
  const input = fixture({ chunks: 2 });
  const polled = [];
  let sendCalls = 0;
  const runtime = productionRuntime(input, {
    sendRawTransaction: async () => { sendCalls += 1; return "signature-0"; },
    getSignatureStatuses: async (signatures) => {
      polled.push([...signatures]);
      throw Object.assign(new Error("rate limited"), { status: 429 });
    },
  });
  await assert.rejects(executeUploadWindow(input.request, {
    ...runtime.dependencies,
    executionId: () => "confirmation-rate-limit",
    pid: 8004,
    hostname: "test-host",
    now: () => "2026-07-20T00:00:00.000Z",
  }), (error) => error.classification === "RPC_RATE_LIMITED" && error.methodClass === "GET_SIGNATURE_STATUSES");
  assert.equal(sendCalls, 1);
  assert.deepEqual(polled, [["signature-0"], ["signature-0"], ["signature-0"]]);
  assert.deepEqual(JSON.parse(readFileSync(input.statePath)).deployment.buffer.chunks.map(({ status, signature }) => ({ status, signature })), [
    { status: "SENT", signature: "signature-0" },
    { status: "PLANNED", signature: null },
  ]);
  await runtime.dependencies.rpcRequestScheduler.close();
});

test("R4C-shaped validation uses one finalized buffer snapshot for 223 confirmed chunks", async () => {
  const input = fixture({ chunks: 391, confirmedChunks: 223 });
  const forbidden = [];
  await assert.rejects(executeUploadWindow(input.request, {
    rpc: input.rpc,
    executionId: () => "r4c-shaped-read-count",
    pid: 8999,
    hostname: "test-host",
    now: () => "2026-07-20T00:00:00.000Z",
    loadAuthorityKeypair: async () => { throw new Error("TEST_SIGNER_BOUNDARY"); },
    getLatestBlockhash: async () => { forbidden.push("blockhash"); },
    sendRawTransaction: async () => { forbidden.push("send"); },
    confirmSignature: async () => { forbidden.push("confirm"); },
    readChunkMatches: async (chunk) => {
      const account = await input.rpc.getAccountInfo(new PublicKey(PLAN_UPLOAD_IDENTITIES.buffer), "confirmed");
      return Buffer.from(account.data)
        .subarray(METADATA_LENGTH + chunk.offset, METADATA_LENGTH + chunk.offset + chunk.length)
        .equals(chunk.bytes);
    },
    sleep: async () => {},
  }), /TEST_SIGNER_BOUNDARY/);

  assert.equal(input.calls.filter((call) => call === "buffer").length, 1);
  assert.deepEqual(forbidden, []);
});

test("binary drift during preflight invalidates the snapshot before lease or signer", async () => {
  const input = fixture({ chunks: 1 });
  const calls = [];
  const rpc = {
    ...input.rpc,
    getBalance: async () => {
      calls.push("balance");
      writeFileSync(input.binaryPath, Buffer.alloc(input.localBytes.length, 0xff));
      return 10_000_000_000;
    },
  };

  await assert.rejects(executeUploadWindow(input.request, {
    rpc,
    executionId: () => "binary-drift-before-lease",
    loadAuthorityKeypair: async () => { calls.push("signer"); },
    getLatestBlockhash: async () => { calls.push("blockhash"); },
    sendRawTransaction: async () => { calls.push("send"); },
    confirmSignature: async () => null,
    readChunkMatches: async () => false,
    sleep: async () => {},
  }), /snapshot binary hash mismatch/);

  assert.deepEqual(calls, ["balance"]);
  assert.equal(existsSync(leasePaths(input.statePath).activeDirectory), false);
});

test("reconciliation collector proves finalized canonical Write and exact bytes using read methods only", async () => {
  const input = fixture({ chunks: 1, status: "SENT" });
  const executionId = "execution-reconciliation-proof";
  const state = JSON.parse(readFileSync(input.statePath, "utf8"));
  state.deployment.buffer.uploadWindows.push({ executionId, status: "RPC_OUTCOME_UNKNOWN", terminal: true });
  writeFileSync(input.statePath, `${JSON.stringify(state, null, 2)}\n`);
  input.localBytes.copy(input.account.data, METADATA_LENGTH);

  const message = new Transaction({
    feePayer: new PublicKey(PLAN_UPLOAD_IDENTITIES.authority),
    recentBlockhash: "11111111111111111111111111111111",
  }).add(makeLoaderV3WriteInstruction({
    buffer: new PublicKey(PLAN_UPLOAD_IDENTITIES.buffer),
    authority: new PublicKey(PLAN_UPLOAD_IDENTITIES.authority),
    offset: 0,
    bytes: input.localBytes,
  })).compileMessage();
  const readCalls = [];
  const rpc = {
    rpcEndpoint: RPC,
    getGenesisHash: async () => { readCalls.push("genesis"); return GENESIS; },
    getSignatureStatuses: async (signatures, options) => {
      readCalls.push(["signature-status", signatures, options]);
      return { context: { slot: 55 }, value: [{ slot: 55, confirmations: null, err: null, confirmationStatus: "finalized" }] };
    },
    getTransaction: async (signature, options) => {
      readCalls.push(["transaction", signature, options]);
      return {
        slot: 55,
        meta: { err: null, fee: 5000, innerInstructions: [] },
        transaction: { signatures: [PUBLIC_SIGNATURE], message },
      };
    },
    getMultipleAccountsInfoAndContext: async (keys, options) => {
      readCalls.push(["program-buffer-snapshot", options]);
      assert.deepEqual(keys.map((key) => key.toBase58()), [PLAN_UPLOAD_IDENTITIES.program, PLAN_UPLOAD_IDENTITIES.buffer]);
      return { context: { slot: 56 }, value: [null, input.account] };
    },
  };
  const forbidden = [];
  const before = { state: readFileSync(input.statePath), mtime: statSync(input.statePath).mtimeMs };
  const result = await collectLeaseReconciliationInput({
    ...input.request,
    executionId,
  }, {
    rpc,
    loadAuthorityKeypair: () => forbidden.push("signer"),
    getLatestBlockhash: () => forbidden.push("blockhash"),
    sendRawTransaction: () => forbidden.push("send"),
    simulateTransaction: () => forbidden.push("simulate"),
  });

  assert.deepEqual(forbidden, []);
  assert.deepEqual(readCalls.map((call) => Array.isArray(call) ? call[0] : call), [
    "genesis", "signature-status", "transaction", "program-buffer-snapshot",
  ]);
  assert.equal(result.expected.binaryLength, input.localBytes.length);
  assert.equal(result.expected.binarySha256, sha256(input.localBytes));
  assert.equal(result.expected.genesis, GENESIS);
  assert.equal(result.observations.verifiedGenesis, GENESIS);
  assert.equal(result.observations.bufferContextSlot, 56);
  assert.deepEqual(result.observations.transactions, [{
    chunkIndex: 0,
    recordedStatus: "SENT",
    signature: PUBLIC_SIGNATURE,
    signatureStatusFound: true,
    confirmationStatus: "finalized",
    statusSlot: 55,
    statusErr: false,
    transactionFound: true,
    transactionSignature: PUBLIC_SIGNATURE,
    signatureCount: 1,
    slot: 55,
    feeLamports: 5000,
    metaErr: false,
    legacyMessage: true,
    instructionCount: 1,
    innerInstructionCount: 0,
    instructionDecoded: true,
    program: OWNER,
    accountCount: 2,
    buffer: PLAN_UPLOAD_IDENTITIES.buffer,
    authority: PLAN_UPLOAD_IDENTITIES.authority,
    bufferWritable: true,
    authoritySigner: true,
    offset: 0,
    payloadLength: input.localBytes.length,
    payloadSha256: sha256(input.localBytes),
    payloadExactMatch: true,
    onchainLength: input.localBytes.length,
    onchainSha256: sha256(input.localBytes),
    onchainExactMatch: true,
    snapshotSlot: 56,
  }]);
  acquireUploadLease({
    statePath: input.statePath,
    executionId,
    pid: 5151,
    hostname: "test-host",
    startedAt: "2026-07-19T00:00:00.000Z",
    program: PLAN_UPLOAD_IDENTITIES.program,
    buffer: PLAN_UPLOAD_IDENTITIES.buffer,
    planFingerprint: input.fingerprint,
    stateSha256: result.expected.stateSha256,
  });
  const reconciled = reconcileUploadLease(result, { processIsActive: () => false });
  assert.equal(reconciled.result, "SAFE_TO_RELEASE");
  assert.equal(reconciled.releaseReady, false);
  assert.deepEqual(reconciled.proposedTransitions.map(({ chunkIndex, from, to }) => ({ chunkIndex, from, to })), [
    { chunkIndex: 0, from: "SENT", to: "CONFIRMED" },
  ]);
  assert.deepEqual({ state: readFileSync(input.statePath), mtime: statSync(input.statePath).mtimeMs }, before);
});

test("reconciliation collector normalizes missing transaction proof instead of throwing", async () => {
  const input = fixture({ chunks: 1, status: "UNKNOWN" });
  const rpc = {
    rpcEndpoint: RPC,
    getGenesisHash: async () => GENESIS,
    getSignatureStatuses: async () => ({ context: { slot: 1 }, value: [null] }),
    getTransaction: async () => null,
    getMultipleAccountsInfoAndContext: async () => ({
      context: { slot: 1 },
      value: [null, input.account],
    }),
  };

  const result = await collectLeaseReconciliationInput({
    ...input.request,
    executionId: "execution-missing-proof",
  }, { rpc });
  const [evidence] = result.observations.transactions;
  assert.equal(evidence.signatureStatusFound, false);
  assert.equal(evidence.confirmationStatus, null);
  assert.equal(evidence.transactionFound, false);
  assert.equal(evidence.transactionSignature, null);
  assert.equal(evidence.signatureCount, 0);
  assert.equal(evidence.legacyMessage, false);
  assert.equal(evidence.instructionDecoded, false);
  assert.equal(evidence.payloadExactMatch, false);
  assert.equal(evidence.onchainExactMatch, false);
});

test("reconciliation collector normalizes malformed transaction response fields", async () => {
  const input = fixture({ chunks: 1, status: "SENT" });
  const rpc = {
    rpcEndpoint: RPC,
    getGenesisHash: async () => GENESIS,
    getSignatureStatuses: async () => ({ value: [{ slot: "not-a-slot" }] }),
    getTransaction: async () => ({
      slot: 1,
      meta: "not-transaction-meta",
      transaction: { signatures: "not-signatures", message: "not-a-message" },
      version: "legacy",
    }),
    getMultipleAccountsInfoAndContext: async () => ({
      context: { slot: 1 },
      value: [null, input.account],
    }),
  };

  const result = await collectLeaseReconciliationInput({
    ...input.request,
    executionId: "execution-malformed-proof",
  }, { rpc });
  const [evidence] = result.observations.transactions;
  assert.equal(evidence.signatureStatusFound, true);
  assert.equal(evidence.statusSlot, null);
  assert.equal(evidence.transactionFound, true);
  assert.equal(evidence.signatureCount, 0);
  assert.equal(evidence.metaErr, null);
  assert.equal(evidence.legacyMessage, false);
  assert.equal(evidence.instructionDecoded, false);
});

test("reconciliation collector rejects binary checkpoint drift before RPC access", async () => {
  const input = fixture({ chunks: 1, status: "SENT" });
  writeFileSync(input.binaryPath, Buffer.concat([input.localBytes, Buffer.from([1])]));
  const calls = [];
  await assert.rejects(collectLeaseReconciliationInput({
    ...input.request,
    executionId: "execution-binary-drift",
  }, {
    rpc: new Proxy({ rpcEndpoint: RPC }, {
      get(target, property) {
        if (property in target) return target[property];
        return () => { calls.push(property); };
      },
    }),
  }), /allocation|binary length|binary hash/);
  assert.deepEqual(calls, []);
});

test("funding exact boundary passes, one lamport short blocks, and malformed rent fails closed", async () => {
  const required = 100 + 200 + (2 * 10_000) + 10_000 + 250_000_000;
  const exact = fixture({ balance: required });
  assert.equal((await preflightUploadExecution(exact.request, { rpc: exact.rpc })).funding.status, "SUFFICIENT");
  const short = fixture({ balance: required - 1 });
  await assert.rejects(preflightUploadExecution(short.request, { rpc: short.rpc }), /BLOCKED_FUNDING/);
  const malformed = fixture();
  malformed.rpc.getMinimumBalanceForRentExemption = async () => -1;
  await assert.rejects(preflightUploadExecution(malformed.request, { rpc: malformed.rpc }), /nonnegative safe integer/);
});

test("preflight rejects wrong genesis, existing program, buffer metadata, state identity and fingerprint", async () => {
  const cases = [
    (input) => { input.rpc.getGenesisHash = async () => "wrong"; },
    (input) => { input.rpc.getAccountInfo = async (key) => key.toBase58() === PLAN_UPLOAD_IDENTITIES.program ? { data: Buffer.alloc(36) } : input.account; },
    (input) => { input.account.owner = new PublicKey(PLAN_UPLOAD_IDENTITIES.program); },
    (input) => { const state = JSON.parse(readFileSync(input.statePath)); state.deployment.buffer.expectedAuthority = PLAN_UPLOAD_IDENTITIES.program; writeFileSync(input.statePath, JSON.stringify(state)); },
    (input) => { const state = JSON.parse(readFileSync(input.statePath)); state.deployment.buffer.planFingerprint = "0".repeat(64); writeFileSync(input.statePath, JSON.stringify(state)); },
  ];
  for (const mutate of cases) {
    const input = fixture();
    mutate(input);
    await assert.rejects(preflightUploadExecution(input.request, { rpc: input.rpc }), /mismatch|UNEXPECTED_EXISTING_PROGRAM|fingerprint/);
    assert.equal(existsSync(leasePaths(input.statePath).activeDirectory), false);
  }
});

test("execution persists SENT and locally derived signature before sending each transaction", async () => {
  const input = fixture({ chunks: 2 });
  const lifecycle = [];
  let monotonicTick = 0;
  const rpcRequestLedger = createRpcRequestLedger({ monotonicNow: () => monotonicTick++ });
  let inFlight = 0;
  let maximumInFlight = 0;
  const result = await executeUploadWindow(input.request, {
    rpc: input.rpc,
    rpcRequestLedger,
    executionId: () => "window-persist-before-send",
    pid: 9001,
    hostname: "test-host",
    now: () => "2026-07-19T00:00:00.000Z",
    loadAuthorityKeypair: async () => { lifecycle.push("load-signer"); return { publicKey: new PublicKey(PLAN_UPLOAD_IDENTITIES.authority) }; },
    getLatestBlockhash: async () => { lifecycle.push("blockhash"); return { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }; },
    buildAndSign: async ({ chunk }) => { lifecycle.push(`sign:${chunk.index}`); return { signature: `signature-${chunk.index}`, rawTransaction: Buffer.from([chunk.index]) }; },
    sendRawTransaction: async (_raw, chunk) => {
      lifecycle.push(`send:${chunk.index}`);
      const record = JSON.parse(readFileSync(input.statePath)).deployment.buffer.chunks[chunk.index];
      assert.equal(record.status, "SENT");
      assert.equal(record.signature, `signature-${chunk.index}`);
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
    },
    confirmSignature: async (_signature, _timeout, _signed, chunk) => { lifecycle.push(`confirm:${chunk.index}`); inFlight -= 1; return { err: null, confirmationStatus: "finalized" }; },
    readChunkMatches: async (chunk) => { lifecycle.push(`match:${chunk.index}`); return true; },
    sleep: async (ms) => { lifecycle.push(`sleep:${ms}`); },
  });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.liveWriteExecuted, true);
  assert.equal(result.liveWriteAttempted, true);
  assert.equal(result.leaseLifecycle, "RECONCILIATION_REQUIRED");
  assert.equal(result.rpcRequestSummary.totalRecorded, 6);
  assert.equal(result.rpcRequestSummary.countsByMethod.GET_ACCOUNT_INFO, 2);
  assert.doesNotMatch(JSON.stringify(result.rpcRequestSummary), /duration|sequence|startMonotonic|accountData/i);
  assert.equal(maximumInFlight, 1);
  assert.equal(lifecycle.filter((item) => item === "blockhash").length, 2);
  for (const index of [0, 1]) {
    assert.ok(lifecycle.indexOf(`sign:${index}`) < lifecycle.indexOf(`send:${index}`));
    assert.ok(lifecycle.indexOf(`send:${index}`) < lifecycle.indexOf(`confirm:${index}`));
    assert.ok(lifecycle.indexOf(`confirm:${index}`) < lifecycle.indexOf(`match:${index}`));
  }
  const state = JSON.parse(readFileSync(input.statePath));
  assert.deepEqual(state.deployment.buffer.chunks.map(({ status }) => status), ["CONFIRMED", "CONFIRMED"]);
  assert.equal(state.deployment.buffer.uploadWindows[0].terminal, true);
  assert.equal(existsSync(leasePaths(input.statePath).activeDirectory), true);
});

test("five-chunk ceiling is absolute and exact skipped chunks do not consume it", async () => {
  const input = fixture({ chunks: 6 });
  const sent = [];
  const result = await executeUploadWindow(input.request, {
    rpc: input.rpc,
    executionId: () => "window-five",
    pid: 9002,
    hostname: "test-host",
    now: () => "2026-07-19T00:00:00.000Z",
    loadAuthorityKeypair: async () => ({ publicKey: new PublicKey(PLAN_UPLOAD_IDENTITIES.authority) }),
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
    buildAndSign: async ({ chunk }) => ({ signature: `signature-${chunk.index}`, rawTransaction: Buffer.from([chunk.index]) }),
    sendRawTransaction: async (_raw, chunk) => { sent.push(chunk.index); },
    confirmSignature: async () => ({ err: null, confirmationStatus: "finalized" }),
    readChunkMatches: async () => true,
    sleep: async () => {},
  });
  assert.equal(result.status, "WINDOW_LIMIT");
  assert.deepEqual(sent, [0, 1, 2, 3, 4]);
  assert.equal(JSON.parse(readFileSync(input.statePath)).deployment.buffer.chunks[5].status, "PLANNED");
});

test("existing SENT or UNKNOWN is reconciled before signer and unresolved evidence stops", async () => {
  for (const status of ["SENT", "UNKNOWN"]) {
    const input = fixture({ chunks: 1, status });
    const calls = [];
    const result = await executeUploadWindow(input.request, {
      rpc: input.rpc,
      executionId: () => `window-${status}`,
      pid: status === "SENT" ? 9003 : 9004,
      hostname: "test-host",
      now: () => "2026-07-19T00:00:00.000Z",
      confirmSignature: async () => { calls.push("reconcile-signature"); return null; },
      readChunkMatches: async () => { calls.push("reconcile-bytes"); return false; },
      loadAuthorityKeypair: async () => { calls.push("signer"); throw new Error("must not load signer"); },
      getLatestBlockhash: async () => { calls.push("blockhash"); throw new Error("must not fetch blockhash"); },
      sendRawTransaction: async () => { calls.push("send"); },
      sleep: async () => {},
    });
    assert.equal(result.status, "UNKNOWN");
    assert.deepEqual(calls, ["reconcile-signature", "reconcile-bytes"]);
  }
});

test("first 429, confirmed failure and exact chunk mismatch stop without lifecycle calls", async () => {
  const scenarios = [
    { name: "429", send: async () => { throw new Error("429 Too Many Requests"); }, confirm: async () => ({ err: null, confirmationStatus: "finalized" }), match: async () => true, expected: "RATE_LIMITED" },
    { name: "failure", send: async () => {}, confirm: async () => ({ err: { InstructionError: [0, "InvalidAccountData"] } }), match: async () => false, expected: "CONFIRMED_FAILURE" },
    { name: "mismatch", send: async () => {}, confirm: async () => ({ err: null, confirmationStatus: "finalized" }), match: async () => false, expected: "UNKNOWN" },
  ];
  for (const scenario of scenarios) {
    const input = fixture({ chunks: 2 });
    let sends = 0;
    const result = await executeUploadWindow(input.request, {
      rpc: input.rpc,
      executionId: () => `window-${scenario.name}`,
      pid: 9100 + sends,
      hostname: "test-host",
      now: () => "2026-07-19T00:00:00.000Z",
      loadAuthorityKeypair: async () => ({ publicKey: new PublicKey(PLAN_UPLOAD_IDENTITIES.authority) }),
      getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
      buildAndSign: async ({ chunk }) => ({ signature: `signature-${chunk.index}`, rawTransaction: Buffer.from([chunk.index]) }),
      sendRawTransaction: async (...args) => { sends += 1; return scenario.send(...args); },
      confirmSignature: scenario.confirm,
      readChunkMatches: scenario.match,
      sleep: async () => {},
      finalize: () => { throw new Error("forbidden finalize"); },
      closeBuffer: () => { throw new Error("forbidden close"); },
      regenerateBuffer: () => { throw new Error("forbidden regenerate"); },
    });
    assert.equal(result.status, scenario.expected);
    assert.equal(sends, 1);
    assert.equal(result.liveWriteAttempted, true);
    assert.equal(result.liveWriteExecuted, null);
  }
});

test("transaction signatures use canonical base58 encoding", async () => {
  const { default: bs58 } = await import("bs58");
  for (const bytes of [Buffer.alloc(64), Buffer.from(Array.from({ length: 64 }, (_, index) => index))]) {
    assert.equal(encodeBase58(bytes), bs58.encode(bytes));
  }
});

test("wrong signer stops before blockhash/send and persists a sanitized terminal outcome", async () => {
  const input = fixture({ chunks: 1 });
  const calls = [];
  await assert.rejects(executeUploadWindow(input.request, {
    rpc: input.rpc,
    executionId: () => "window-wrong-signer",
    pid: 9201,
    hostname: "test-host",
    now: () => "2026-07-19T00:00:00.000Z",
    loadAuthorityKeypair: async () => ({ publicKey: new PublicKey(PLAN_UPLOAD_IDENTITIES.program) }),
    getLatestBlockhash: async () => { calls.push("blockhash"); },
    sendRawTransaction: async () => { calls.push("send"); },
    confirmSignature: async () => null,
    readChunkMatches: async () => false,
    sleep: async () => {},
  }), /signer mismatch/);
  assert.deepEqual(calls, []);
  assert.equal(JSON.parse(readFileSync(input.statePath)).deployment.buffer.uploadWindows[0].status, "SIGNER_MISMATCH");
});

test("ambiguous non-429 send error remains SENT and persists RPC_OUTCOME_UNKNOWN", async () => {
  const input = fixture({ chunks: 2 });
  let sends = 0;
  await assert.rejects(executeUploadWindow(input.request, {
    rpc: input.rpc,
    executionId: () => "window-rpc-unknown",
    pid: 9202,
    hostname: "test-host",
    now: () => "2026-07-19T00:00:00.000Z",
    loadAuthorityKeypair: async () => ({ publicKey: new PublicKey(PLAN_UPLOAD_IDENTITIES.authority) }),
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
    buildAndSign: async ({ chunk }) => ({ signature: `signature-${chunk.index}`, rawTransaction: Buffer.from([chunk.index]) }),
    sendRawTransaction: async () => { sends += 1; throw new Error("transport disconnected with raw details"); },
    confirmSignature: async () => null,
    readChunkMatches: async () => false,
    sleep: async () => {},
  }), /transport disconnected/);
  const state = JSON.parse(readFileSync(input.statePath));
  assert.equal(sends, 1);
  assert.equal(state.deployment.buffer.chunks[0].status, "SENT");
  assert.equal(state.deployment.buffer.chunks[1].status, "PLANNED");
  assert.equal(state.deployment.buffer.uploadWindows[0].status, "RPC_OUTCOME_UNKNOWN");
  assert.doesNotMatch(JSON.stringify(state.deployment.buffer.uploadWindows[0]), /raw details|transport disconnected/);
});
