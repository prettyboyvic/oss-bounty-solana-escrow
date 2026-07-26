import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildUploadTerminalRecord,
  createUploadLifecycleTracker,
  readUploadTerminalEvidence,
  writeUploadTerminalEvidence,
} from "../../scripts/devnet/upload-terminal-evidence.mjs";

const IDENTITY = Object.freeze({
  executionId: "terminal-fixture-1",
  leaseSha256: "1".repeat(64),
  stateSha256Before: "2".repeat(64),
  program: "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z",
  buffer: "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW",
  authority: "Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk",
  startedAt: "2026-07-26T09:20:10.943Z",
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "upload-terminal-"));
  const directory = join(root, "state.json.upload-lease");
  mkdirSync(directory);
  return { root, directory };
}

function failedRecord(tracker, overrides = {}) {
  return buildUploadTerminalRecord({
    ...IDENTITY,
    stateSha256After: IDENTITY.stateSha256Before,
    finishedAt: "2026-07-26T09:20:14.700Z",
    primaryError: new Error("CANARY raw secret message"),
    tracker,
    secondaryErrors: [],
    ...overrides,
  });
}

test("pre-selection lifecycle boundaries produce a proven stale-safe terminal", () => {
  const tracker = createUploadLifecycleTracker();
  tracker.enterPhase("TELEMETRY_REPLAY");
  const record = failedRecord(tracker);
  assert.equal(record.classification, "FAILED_PRE_SELECTION_STALE_SAFE");
  assert.equal(record.primaryError.code, "TELEMETRY_REPLAY_VALIDATION_FAILED");
  assert.equal(record.primaryError.phase, "TELEMETRY_REPLAY");
  assert.deepEqual(record.boundaries, {
    candidateSelectionCount: 0,
    keypairAccessCount: 0,
    blockhashRequestCount: 0,
    signingAttemptCount: 0,
    sendAttemptCount: 0,
    signatureRecordedCount: 0,
  });
  assert.equal(record.zeroSendProven, true);
  assert.equal(record.ambiguousWriteOutcome, false);
  assert.doesNotMatch(
    JSON.stringify(record),
    /CANARY|raw secret message|https?:\/\/|keypair(?:Path|\.json)/i,
  );
});

test("crossing any selection or write boundary prevents stale-safe classification", () => {
  const mutations = [
    [(tracker) => tracker.recordCandidateSelection(), true],
    [(tracker) => tracker.recordKeypairAccess(), true],
    [(tracker) => tracker.recordBlockhashRequest(), true],
    [(tracker) => tracker.recordSigningAttempt(), true],
    [(tracker) => tracker.recordSendAttempt(), false],
    [(tracker) => tracker.recordSignature(), false],
  ];
  for (const [mutate, zeroSendProven] of mutations) {
    const tracker = createUploadLifecycleTracker();
    tracker.enterPhase("UPLOAD_EXECUTION");
    mutate(tracker);
    const record = failedRecord(tracker);
    assert.notEqual(record.classification, "FAILED_PRE_SELECTION_STALE_SAFE");
    assert.equal(record.zeroSendProven, zeroSendProven);
  }
});

test("terminal evidence is canonical, hash-bound and cannot regress", () => {
  const { directory } = fixture();
  const tracker = createUploadLifecycleTracker();
  tracker.enterPhase("TELEMETRY_REPLAY");
  const record = failedRecord(tracker, {
    secondaryErrors: [
      { code: "TELEMETRY_PERSISTENCE_FAILED", phase: "TERMINALIZATION" },
    ],
  });
  const first = writeUploadTerminalEvidence(directory, record);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(readUploadTerminalEvidence(directory), first);
  const bytes = readFileSync(join(directory, "terminal.json"));

  const poorer = failedRecord(tracker);
  assert.throws(
    () => writeUploadTerminalEvidence(directory, poorer),
    /regression|existing terminal evidence/i,
  );
  assert.deepEqual(readFileSync(join(directory, "terminal.json")), bytes);
});

test("terminal whitelist rejects secret-bearing or unknown fields before persistence", () => {
  const { directory } = fixture();
  const tracker = createUploadLifecycleTracker();
  tracker.enterPhase("TELEMETRY_INITIALIZATION");
  const record = failedRecord(tracker);
  for (const unsafe of [
    { ...record, authorization: "Bearer CANARY" },
    { ...record, keypairPath: "C:\\secret\\authority.json" },
    { ...record, rawTransaction: "CANARY" },
  ]) {
    assert.throws(() => writeUploadTerminalEvidence(directory, unsafe), /schema|whitelist|terminal/i);
  }
});

test("malformed stored terminal evidence fails closed", () => {
  const { directory } = fixture();
  writeFileSync(join(directory, "terminal.json"), "{\"terminal\":true}\n");
  assert.throws(() => readUploadTerminalEvidence(directory), /schema|terminal/i);
});
