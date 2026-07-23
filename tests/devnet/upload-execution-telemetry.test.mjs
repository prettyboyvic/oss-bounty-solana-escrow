import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";

import {
  PACKET_DATA_SIZE,
  serializedWriteTransactionSize,
} from "../../scripts/devnet/upload-plan.mjs";
import {
  canonicalTelemetryHash,
  createUploadTelemetryStore,
  evaluateUploadTelemetryPublication,
  readUploadTelemetry,
} from "../../scripts/devnet/upload-execution-telemetry.mjs";

const EXECUTION_ID = "telemetry-execution-1";
const STARTED_AT = "2026-07-23T00:00:00.000Z";
const POLICY = Object.freeze({
  preSignCooldownMs: 3_000,
  globalRequestStartGapMs: 500,
  confirmationPollIntervalMs: 2_000,
  rateLimitRetryScheduleMs: Object.freeze([2_000, 5_000]),
  interChunkDelayMs: 3_000,
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "upload-telemetry-"));
  const directory = join(root, "state.json.upload-lease");
  mkdirSync(directory);
  return { root, directory };
}

function entry(sequence, methodClass, startMonotonicMs, durationMs = 10) {
  return {
    sequence,
    methodClass,
    startMonotonicMs,
    endMonotonicMs: startMonotonicMs + durationMs,
    durationMs,
    outcome: "SUCCESS",
    retryNumber: 0,
    signaturePersisted: methodClass === "SEND_RAW_TRANSACTION",
    mutationCapability: methodClass === "SEND_RAW_TRANSACTION" ? "write" : "read",
  };
}

function storeAt(directory) {
  return createUploadTelemetryStore({
    directory,
    executionId: EXECUTION_ID,
    startedAt: STARTED_AT,
    startMonotonicMs: 1_000,
    policy: POLICY,
  });
}

function terminalOutcome(evidence, confirmedIndexes = [0, 1, 2, 3, 4]) {
  return {
    executionId: EXECUTION_ID,
    startedAt: STARTED_AT,
    finishedAt: evidence.snapshot.finishedAt,
    terminal: true,
    status: "WINDOW_LIMIT",
    processed: confirmedIndexes.length,
    sent: confirmedIndexes.length,
    confirmedIndexes,
    telemetryEvidence: {
      verdict: evidence.verdict,
      sha256: evidence.sha256,
    },
  };
}

function recordSuccessfulChunk(store, chunkIndex, sequenceStart, elapsedStart) {
  const required = chunkIndex === 0;
  store.recordPreSignCooldown({
    chunkIndex,
    required,
    startedMonotonicMs: 1_000 + elapsedStart,
    finishedMonotonicMs: 1_000 + elapsedStart + (required ? 3_000 : 0),
  });
  const sendStart = 1_000 + elapsedStart + (required ? 3_000 : 0);
  store.recordSendStart({ chunkIndex, monotonicMs: sendStart });
  store.recordRpcEntry(entry(sequenceStart, "SEND_RAW_TRANSACTION", sendStart, 20), { confirmationChunkIndex: null });
  store.recordSendFinish({ chunkIndex, monotonicMs: sendStart + 20, outcome: "SUCCESS" });
  store.recordRpcEntry(entry(sequenceStart + 1, "GET_SIGNATURE_STATUSES", sendStart + 500), { confirmationChunkIndex: chunkIndex });
  store.recordRpcEntry(entry(sequenceStart + 2, "GET_SIGNATURE_STATUSES", sendStart + 2_500), { confirmationChunkIndex: chunkIndex });
}

test("complete five-chunk telemetry persists canonical sanitized timing evidence", () => {
  const { directory } = fixture();
  const store = storeAt(directory);
  store.recordRpcEntry(entry(1, "GET_GENESIS_HASH", 1_000));
  store.recordRpcEntry(entry(2, "GET_ACCOUNT_INFO", 1_500));
  for (let index = 0; index < 5; index += 1) {
    recordSuccessfulChunk(store, index, 3 + index * 3, 1_000 + index * 6_000);
  }
  const result = store.finish({
    finishedAt: "2026-07-23T00:00:31.000Z",
    finishedMonotonicMs: 32_000,
    expectedChunkIndexes: [0, 1, 2, 3, 4],
  });

  assert.equal(result.verdict, "COMPLETE");
  assert.equal(result.snapshot.minimumRpcRequestGapMs, 500);
  assert.equal(result.snapshot.minimumConfirmationPollGapMs, 2_000);
  assert.equal(result.snapshot.sends.length, 5);
  assert.ok(result.snapshot.sends[0].preSignCooldownMs >= POLICY.preSignCooldownMs);
  assert.equal(result.snapshot.requests.length, 17);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(canonicalTelemetryHash(result.snapshot), result.sha256);

  const stored = readUploadTelemetry(directory);
  assert.equal(stored.verdict, "COMPLETE");
  assert.equal(stored.publishable, false);
  assert.equal(stored.sha256, result.sha256);
  assert.equal(stored.snapshot.executionId, EXECUTION_ID);
  assert.deepEqual(evaluateUploadTelemetryPublication({
    directory,
    expectedSha256: result.sha256,
    terminalOutcome: terminalOutcome(result),
  }), {
    verdict: "COMPLETE",
    publishable: true,
    sha256: result.sha256,
  });
  assert.equal(evaluateUploadTelemetryPublication({
    directory,
    expectedSha256: result.sha256,
    terminalOutcome: {
      ...terminalOutcome(result),
      executionId: "foreign-execution",
    },
  }).publishable, false);
  assert.deepEqual(evaluateUploadTelemetryPublication({
    directory,
    expectedSha256: "f".repeat(64),
    terminalOutcome: terminalOutcome(result),
  }), {
    verdict: "INCOMPLETE",
    publishable: false,
    sha256: result.sha256,
  });
  assert.doesNotMatch(
    readFileSync(join(directory, "telemetry.json"), "utf8"),
    /private|secret|seed|authorization|https?:\/\/|rawTransaction|signedTransaction/i,
  );
});

test("partial evidence survives process failure and cannot be overwritten by a shorter snapshot", () => {
  const { directory } = fixture();
  const first = storeAt(directory);
  first.recordRpcEntry(entry(1, "GET_GENESIS_HASH", 1_000));
  first.recordPreSignCooldown({
    chunkIndex: 0,
    required: true,
    startedMonotonicMs: 1_500,
    finishedMonotonicMs: 4_500,
  });
  first.recordSendStart({ chunkIndex: 0, monotonicMs: 4_500 });
  const bytesBefore = readFileSync(join(directory, "telemetry.json"));

  const resumed = storeAt(directory);
  assert.deepEqual(readFileSync(join(directory, "telemetry.json")), bytesBefore);
  assert.equal(resumed.evidence().snapshot.requests.length, 1);
  assert.equal(resumed.evidence().snapshot.sends[0].sendFinishedElapsedMs, null);
  assert.equal(resumed.evidence().verdict, "INCOMPLETE");

  assert.throws(
    () => resumed.recordRpcEntry(entry(1, "GET_ACCOUNT_INFO", 1_000)),
    /sequence|existing|regression/i,
  );
  assert.deepEqual(readFileSync(join(directory, "telemetry.json")), bytesBefore);
});

test("failed or omitted started sends can never produce complete publishable evidence", () => {
  const { directory } = fixture();
  const store = storeAt(directory);
  store.recordRpcEntry(entry(1, "GET_GENESIS_HASH", 1_000));
  store.recordRpcEntry(entry(2, "GET_ACCOUNT_INFO", 1_500));
  recordSuccessfulChunk(store, 0, 3, 1_000);
  store.recordPreSignCooldown({
    chunkIndex: 1,
    required: false,
    startedMonotonicMs: 9_000,
    finishedMonotonicMs: 9_000,
  });
  store.recordSendStart({ chunkIndex: 1, monotonicMs: 9_000 });
  store.recordRpcEntry(entry(6, "SEND_RAW_TRANSACTION", 9_000, 20));
  store.recordSendFinish({ chunkIndex: 1, monotonicMs: 9_020, outcome: "ERROR" });
  const result = store.finish({
    finishedAt: "2026-07-23T00:00:09.020Z",
    finishedMonotonicMs: 10_020,
    expectedChunkIndexes: [0],
  });

  assert.equal(result.verdict, "INCOMPLETE");
  assert.ok(result.snapshot.missing.some((item) => item.includes("1")));
  assert.equal(evaluateUploadTelemetryPublication({
    directory,
    expectedSha256: result.sha256,
    terminalOutcome: terminalOutcome(result, [0]),
  }).publishable, false);
});

test("an existing telemetry store rejects a different monotonic origin", () => {
  const { directory } = fixture();
  storeAt(directory).recordRpcEntry(entry(1, "GET_GENESIS_HASH", 1_000));
  assert.throws(() => createUploadTelemetryStore({
    directory,
    executionId: EXECUTION_ID,
    startedAt: STARTED_AT,
    startMonotonicMs: 0,
    policy: POLICY,
  }), /monotonic origin|identity mismatch/i);
});

test("request and confirmation-poll starts persist before completion", () => {
  const { directory } = fixture();
  const store = storeAt(directory);
  store.recordRpcStart({
    sequence: 1,
    methodClass: "GET_SIGNATURE_STATUSES",
    startMonotonicMs: 1_500,
    retryNumber: 0,
    signaturePersisted: true,
    mutationCapability: "read",
  }, { confirmationChunkIndex: 0 });

  const persisted = readUploadTelemetry(directory);
  assert.equal(persisted.snapshot.requests[0].endElapsedMs, null);
  assert.equal(persisted.snapshot.requests[0].outcome, null);
  assert.deepEqual(persisted.snapshot.confirmationPolls.map(({ chunkIndex, requestSequence }) => ({
    chunkIndex,
    requestSequence,
  })), [{ chunkIndex: 0, requestSequence: 1 }]);
  assert.equal(persisted.verdict, "INCOMPLETE");
});

test("legacy archive without telemetry is explicitly unavailable and publication fails closed", () => {
  const { directory } = fixture();
  assert.deepEqual(readUploadTelemetry(directory), {
    availability: "UNAVAILABLE",
    verdict: "UNAVAILABLE",
    publishable: false,
    sha256: null,
    snapshot: null,
  });
  assert.deepEqual(evaluateUploadTelemetryPublication({
    directory,
    expectedSha256: "0".repeat(64),
    terminalOutcome: null,
  }), {
    verdict: "UNAVAILABLE",
    publishable: false,
    sha256: null,
  });
});

test("publication requires complete telemetry and the exact canonical hash", () => {
  const { directory } = fixture();
  const store = storeAt(directory);
  store.recordRpcEntry(entry(1, "GET_GENESIS_HASH", 1_000));
  assert.deepEqual(evaluateUploadTelemetryPublication({
    directory,
    expectedSha256: store.evidence().sha256,
    terminalOutcome: null,
  }), {
    verdict: "INCOMPLETE",
    publishable: false,
    sha256: store.evidence().sha256,
  });

  assert.deepEqual(evaluateUploadTelemetryPublication({
    directory,
    expectedSha256: "f".repeat(64),
    terminalOutcome: null,
  }), {
    verdict: "INCOMPLETE",
    publishable: false,
    sha256: store.evidence().sha256,
  });
});

test("complete telemetry rejects polls and sends that are not linked to their RPC records", () => {
  for (const mutation of [
    (snapshot) => {
      snapshot.confirmationPolls[0].requestSequence = 1;
    },
    (snapshot) => {
      snapshot.requests = snapshot.requests.filter(({ requestType }) =>
        requestType !== "SEND_RAW_TRANSACTION"
      );
    },
  ]) {
    const { directory } = fixture();
    const store = storeAt(directory);
    store.recordRpcEntry(entry(1, "GET_GENESIS_HASH", 1_000));
    store.recordRpcEntry(entry(2, "GET_ACCOUNT_INFO", 1_500));
    recordSuccessfulChunk(store, 0, 3, 1_000);
    const result = store.finish({
      finishedAt: "2026-07-23T00:00:07.000Z",
      finishedMonotonicMs: 8_000,
      expectedChunkIndexes: [0],
    });
    assert.equal(result.verdict, "COMPLETE");

    const malformed = structuredClone(result.snapshot);
    mutation(malformed);
    writeFileSync(join(directory, "telemetry.json"), `${JSON.stringify(malformed, null, 2)}\n`);
    assert.throws(() => readUploadTelemetry(directory), /telemetry.*link|linked.*RPC|completeness verdict/i);
  }
});

test("canonical hash ignores object insertion order but not evidence order", () => {
  const { directory } = fixture();
  const store = storeAt(directory);
  store.recordRpcEntry(entry(1, "GET_GENESIS_HASH", 1_000));
  store.recordRpcEntry(entry(2, "GET_ACCOUNT_INFO", 1_500));
  const snapshot = store.evidence().snapshot;
  const reordered = Object.fromEntries(Object.entries(snapshot).reverse());
  assert.equal(canonicalTelemetryHash(reordered), canonicalTelemetryHash(snapshot));
  assert.throws(
    () => canonicalTelemetryHash({ ...snapshot, requests: [...snapshot.requests].reverse() }),
    /request schema/,
  );
});

test("whitelist rejects secret-bearing or malformed request records before persistence", () => {
  const { directory } = fixture();
  const store = storeAt(directory);
  const before = readFileSync(join(directory, "telemetry.json"));
  for (const unsafe of [
    { ...entry(1, "GET_ACCOUNT_INFO", 1_000), authorization: "Bearer CANARY" },
    { ...entry(1, "GET_ACCOUNT_INFO", 1_000), rpcUrl: "https://user:password@example.invalid" },
    { ...entry(1, "GET_ACCOUNT_INFO", 1_000), signedTransaction: "CANARY" },
  ]) {
    assert.throws(() => store.recordRpcEntry(unsafe), /schema|whitelist|telemetry/i);
    assert.deepEqual(readFileSync(join(directory, "telemetry.json")), before);
  }
});

test("telemetry instrumentation leaves the canonical transaction at 1231 bytes under the 1232-byte ceiling", () => {
  const transactionBytes = serializedWriteTransactionSize({
    buffer: new PublicKey("CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW"),
    authority: new PublicKey("Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk"),
    offset: 0,
    bytes: Buffer.alloc(1_011),
  });
  assert.equal(transactionBytes, 1_231);
  assert.equal(PACKET_DATA_SIZE, 1_232);
  assert.ok(transactionBytes <= PACKET_DATA_SIZE);
});
