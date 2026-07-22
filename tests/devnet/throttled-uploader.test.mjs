import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRpcRequestLedger } from "../../scripts/devnet/rpc-request-ledger.mjs";
import {
  assertChunkTransition,
  createPlanFingerprint,
  loadUploaderCheckpoint,
  normalizeRatePolicy,
  reconcileChunk,
  runPersistedSequentialUpload,
  runSequentialUpload,
} from "../../scripts/devnet/throttled-uploader.mjs";

const OWNED_TEMP_DIRS = [];
test.afterEach(() => {
  for (const dir of OWNED_TEMP_DIRS.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function checkpointFixture(status = "PLANNED") {
  const dir = mkdtempSync(join(tmpdir(), "uploader-checkpoint-"));
  OWNED_TEMP_DIRS.push(dir);
  const statePath = join(dir, "state.json");
  const chunk = { index: 0, offset: 0, length: 2, sha256: "a".repeat(64) };
  const checkpoint = {
    program: "program",
    buffer: "buffer",
    authority: "authority",
    owner: "owner",
    allocation: 39,
    binaryLength: 2,
    binarySha256: "b".repeat(64),
    planFingerprint: createPlanFingerprint({
      program: "program",
      buffer: "buffer",
      allocation: 39,
      authority: "authority",
      binarySha256: "b".repeat(64),
      maxPayload: 2,
      chunks: [chunk],
    }),
  };
  writeFileSync(statePath, JSON.stringify({
    schemaVersion: 3,
    identities: { program: checkpoint.program },
    deployment: {
      buffer: {
        publicKey: checkpoint.buffer,
        expectedAuthority: checkpoint.authority,
        expectedOwner: checkpoint.owner,
        allocatedLength: checkpoint.allocation,
        localBinary: { length: checkpoint.binaryLength, sha256: checkpoint.binarySha256 },
        planFingerprint: checkpoint.planFingerprint,
        chunks: [{ ...chunk, status, signature: status === "PLANNED" ? null : "signature" }],
      },
    },
  }));
  return { statePath, checkpoint, chunk: { ...chunk, bytes: Buffer.from([1, 2]), exactMatch: false } };
}

test("rejects unsafe rate-policy values", () => {
  assert.deepEqual(normalizeRatePolicy({}), { concurrency: 1, minimumDelayMs: 1000, maxChunksPerWindow: 5, maxRateLimitEvents: 1, confirmationTimeoutMs: 30000, readRetries: 3, readRetryDelayMs: 500 });
  for (const policy of [{ concurrency: 2 }, { minimumDelayMs: 0 }, { maxChunksPerWindow: Infinity }, { readRetries: Infinity }, { maxRateLimitEvents: 2 }]) assert.throws(() => normalizeRatePolicy(policy), /policy/);
});

test("allows only explicit schema-v3 chunk state transitions", () => {
  assert.equal(assertChunkTransition("PLANNED", "SENT"), true);
  assert.equal(assertChunkTransition("SENT", "CONFIRMED"), true);
  assert.equal(assertChunkTransition("UNKNOWN", "FAILED"), true);
  assert.throws(() => assertChunkTransition("CONFIRMED", "SENT"), /invalid chunk transition/);
  assert.throws(() => assertChunkTransition("FAILED", "CONFIRMED"), /invalid chunk transition/);
});

test("reconciliation does not blind-replace an uncertain transaction", () => {
  assert.equal(reconcileChunk({ signatureStatus: null, chunkMatches: true, expired: true }), "CONFIRMED");
  assert.equal(reconcileChunk({ signatureStatus: null, chunkMatches: true, expired: false }), "UNKNOWN");
  assert.equal(reconcileChunk({ signatureStatus: { err: null, confirmationStatus: "confirmed" }, chunkMatches: true, expired: false }), "UNKNOWN");
  assert.equal(reconcileChunk({ signatureStatus: { err: null, confirmationStatus: "finalized" }, chunkMatches: true, expired: false }), "CONFIRMED");
  assert.equal(reconcileChunk({ signatureStatus: { err: { Custom: 1 } }, chunkMatches: false, expired: false }), "CONFIRMED_FAILURE");
  assert.equal(reconcileChunk({ signatureStatus: null, chunkMatches: false, expired: true }), "UNKNOWN");
});

test("finalized confirmation duration uses the injected monotonic boundary", async () => {
  let now = 100;
  const result = await runSequentialUpload({
    chunks: [{ index: 0, exactMatch: false }],
    policy: {},
    persist: async () => {},
    sign: async () => ({ signature: "public-signature" }),
    send: async () => {},
    confirm: async () => {
      now = 12_101;
      return { err: null, confirmationStatus: "finalized" };
    },
    readChunkMatches: async () => true,
    sleep: async () => {},
    monotonicNow: () => now,
  });

  assert.deepEqual(result.confirmations, [{ chunkIndex: 0, confirmationDurationMs: 12_001 }]);
});

test("immediate finalized confirmation records zero without claiming failed or ambiguous durations", async () => {
  const finalized = await runSequentialUpload({
    chunks: [{ index: 0, exactMatch: false }],
    policy: {},
    persist: async () => {},
    sign: async () => ({ signature: "finalized-signature" }),
    send: async () => {},
    confirm: async () => ({ err: null, confirmationStatus: "finalized" }),
    readChunkMatches: async () => true,
    sleep: async () => {},
    monotonicNow: () => 500,
  });
  assert.deepEqual(finalized.confirmations, [{ chunkIndex: 0, confirmationDurationMs: 0 }]);

  for (const scenario of [
    { status: null, matches: false, expected: "UNKNOWN" },
    { status: { err: { InstructionError: [0, "InvalidAccountData"] } }, matches: false, expected: "CONFIRMED_FAILURE" },
    { status: { err: null, confirmationStatus: "finalized" }, matches: false, expected: "UNKNOWN" },
  ]) {
    let now = 0;
    const result = await runSequentialUpload({
      chunks: [{ index: 0, exactMatch: false }],
      policy: {},
      persist: async () => {},
      sign: async () => ({ signature: "nonfinal-signature" }),
      send: async () => {},
      confirm: async () => { now = 10; return scenario.status; },
      readChunkMatches: async () => scenario.matches,
      sleep: async () => {},
      monotonicNow: () => now,
    });
    assert.equal(result.status, scenario.expected);
    assert.deepEqual(result.confirmations, []);
  }
});

test("confirmation duration fails closed on non-finite or regressing monotonic clocks", async () => {
  for (const readings of [[10, 9], [10, Number.NaN]]) {
    const clock = [...readings];
    await assert.rejects(runSequentialUpload({
      chunks: [{ index: 0, exactMatch: false }],
      policy: {},
      persist: async () => {},
      sign: async () => ({ signature: "public-signature" }),
      send: async () => {},
      confirm: async () => ({ err: null, confirmationStatus: "finalized" }),
      readChunkMatches: async () => true,
      sleep: async () => {},
      monotonicNow: () => clock.shift(),
    }), /monotonic clock regression/);
  }
});

test("persists a public signature before send and stops on first 429", async () => {
  const events = [];
  const result = await runSequentialUpload({
    chunks: [{ index: 0, exactMatch: false }, { index: 1, exactMatch: false }],
    policy: {},
    persist: async (event) => events.push(event),
    sign: async (chunk) => ({ signature: `sig-${chunk.index}` }),
    send: async () => { throw new Error("429 Too Many Requests"); },
    confirm: async () => null,
    readChunkMatches: async () => false,
    sleep: async () => {},
  });
  assert.deepEqual(events[0], { status: "SENT", index: 0, signature: "sig-0" });
  assert.equal(result.status, "RATE_LIMITED");
  assert.equal(result.sent, 0);
});

test("ledger-wrapped send 429 preserves the RATE_LIMITED result contract without retry", async () => {
  let sends = 0;
  const ledger = createRpcRequestLedger();
  const result = await runSequentialUpload({
    chunks: [{ index: 0, exactMatch: false }],
    policy: {},
    persist: async () => {},
    sign: async () => ({ signature: "persisted-signature" }),
    send: async () => ledger.record({
      methodClass: "SEND_RAW_TRANSACTION",
      retryNumber: 0,
      signaturePersisted: true,
      mutationCapability: "write",
    }, async () => {
      sends += 1;
      throw { status: 429, body: "CANARY-RAW-BODY" };
    }),
    confirm: async () => { throw new Error("must not confirm"); },
    readChunkMatches: async () => { throw new Error("must not read"); },
    sleep: async () => {},
  });

  assert.equal(result.status, "RATE_LIMITED");
  assert.equal(sends, 1);
  assert.deepEqual(result.confirmations, []);
});

test("exact skipped chunks do not consume the bounded send window", async () => {
  const sent = [];
  const result = await runSequentialUpload({
    chunks: [
      { index: 0, exactMatch: true },
      { index: 1, exactMatch: true },
      { index: 2, exactMatch: false },
    ],
    policy: { maxChunksPerWindow: 1, minimumDelayMs: 1 },
    persist: async () => {},
    sign: async (chunk) => ({ signature: `sig-${chunk.index}` }),
    send: async (_signed, chunk) => sent.push(chunk.index),
    confirm: async () => ({ err: null, confirmationStatus: "finalized" }),
    readChunkMatches: async () => true,
    sleep: async () => {},
  });
  assert.equal(result.status, "COMPLETE");
  assert.deepEqual(result.skippedIndexes, [0, 1]);
  assert.deepEqual(sent, [2]);
  assert.equal(result.processed, 1);
});

test("resume checkpoint fails closed on program, identity, allocation, binary, fingerprint and corruption", () => {
  const { statePath, checkpoint } = checkpointFixture();
  for (const [field, value, pattern] of [
    ["program", "wrong", /program ID mismatch/],
    ["authority", "wrong", /authority mismatch/],
    ["allocation", 40, /allocation mismatch/],
    ["binarySha256", "c".repeat(64), /binary hash mismatch/],
    ["planFingerprint", "d".repeat(64), /plan fingerprint mismatch/],
  ]) {
    assert.throws(() => loadUploaderCheckpoint(statePath, { ...checkpoint, [field]: value }), pattern);
  }
  writeFileSync(statePath, "{corrupted");
  assert.throws(() => loadUploaderCheckpoint(statePath, checkpoint), /corrupted uploader state/);
});

test("plan fingerprint is bound to program and allocation", () => {
  const { checkpoint, chunk } = checkpointFixture();
  const input = {
    program: checkpoint.program,
    buffer: checkpoint.buffer,
    authority: checkpoint.authority,
    allocation: checkpoint.allocation,
    binarySha256: checkpoint.binarySha256,
    maxPayload: 2,
    chunks: [chunk],
  };
  assert.notEqual(createPlanFingerprint({ ...input, program: "other-program" }), checkpoint.planFingerprint);
  assert.notEqual(createPlanFingerprint({ ...input, allocation: 40 }), checkpoint.planFingerprint);
  assert.throws(() => createPlanFingerprint({ ...input, program: undefined }), /fingerprint binding/);
  assert.throws(() => createPlanFingerprint({ ...input, allocation: undefined }), /fingerprint binding/);
});

test("resume checkpoint rejects schema v2 instead of migrating persisted state", () => {
  const { statePath, checkpoint } = checkpointFixture();
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.schemaVersion = 2;
  writeFileSync(statePath, JSON.stringify(state));
  assert.throws(() => loadUploaderCheckpoint(statePath, checkpoint), /schema must be v3/);
});

test("UNKNOWN signature is reconciled before any signer or retry", async () => {
  const { statePath, checkpoint, chunk } = checkpointFixture("UNKNOWN");
  const calls = [];
  const result = await runPersistedSequentialUpload({
    statePath,
    checkpoint,
    chunks: [chunk],
    policy: {},
    confirm: async () => { calls.push("confirm"); return null; },
    readChunkMatches: async () => { calls.push("match"); return false; },
    sign: async () => { calls.push("sign"); throw new Error("must not sign"); },
    send: async () => { calls.push("send"); },
    sleep: async () => {},
  });
  assert.equal(result.status, "UNKNOWN");
  assert.deepEqual(calls, ["confirm", "match"]);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).deployment.buffer.chunks[0].status, "UNKNOWN");
});

test("prevalidated confirmed indexes skip per-record buffer reads", async () => {
  const { statePath, checkpoint, chunk } = checkpointFixture("CONFIRMED");
  const calls = [];
  const result = await runPersistedSequentialUpload({
    statePath,
    checkpoint,
    chunks: [chunk],
    confirmedChunkIndexes: [0],
    policy: {},
    confirm: async () => { calls.push("confirm"); },
    readChunkMatches: async () => { calls.push("match"); throw new Error("redundant confirmed read"); },
    sign: async () => { calls.push("sign"); },
    send: async () => { calls.push("send"); },
    sleep: async () => {},
  });

  assert.equal(result.status, "COMPLETE");
  assert.deepEqual(result.skippedIndexes, [0]);
  assert.deepEqual(calls, []);
});

test("confirmed snapshot evidence rejects indexes outside the plan", async () => {
  const { statePath, checkpoint, chunk } = checkpointFixture("CONFIRMED");
  await assert.rejects(runPersistedSequentialUpload({
    statePath,
    checkpoint,
    chunks: [chunk],
    confirmedChunkIndexes: [1],
    policy: {},
    confirm: async () => null,
    readChunkMatches: async () => true,
    sign: async () => null,
    send: async () => null,
    sleep: async () => {},
  }), /confirmed snapshot index out of range/);
});

test("confirmed failed transaction persists FAILED and is never success or resent", async () => {
  const { statePath, checkpoint, chunk } = checkpointFixture("SENT");
  let sends = 0;
  const result = await runPersistedSequentialUpload({
    statePath,
    checkpoint,
    chunks: [chunk],
    policy: {},
    confirm: async () => ({ err: { InstructionError: [0, "InvalidAccountData"] } }),
    readChunkMatches: async () => false,
    sign: async () => { throw new Error("must not sign"); },
    send: async () => { sends += 1; },
    sleep: async () => {},
  });
  assert.equal(result.status, "CONFIRMED_FAILURE");
  assert.equal(sends, 0);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).deployment.buffer.chunks[0].status, "FAILED");
});
