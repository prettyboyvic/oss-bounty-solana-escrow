import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPlanFingerprint } from "../../scripts/devnet/throttled-uploader.mjs";
import {
  acquireUploadLease,
  leasePaths,
  reconcileUploadLease,
  releaseUploadLease,
} from "../../scripts/devnet/upload-execution-lease.mjs";
import {
  createUploadTelemetryStore,
  readUploadTelemetry,
} from "../../scripts/devnet/upload-execution-telemetry.mjs";

const PROGRAM = "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z";
const BUFFER = "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW";
const AUTHORITY = "Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk";
const OWNER = "BPFLoaderUpgradeab1e11111111111111111111111";
const GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const EXECUTION_ID = "execution-r4a-test";
const BINARY_BYTES = Buffer.from([7, 8]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const BINARY_SHA256 = sha256(BINARY_BYTES);
const FINGERPRINT = createPlanFingerprint({
  program: PROGRAM,
  buffer: BUFFER,
  authority: AUTHORITY,
  allocation: 39,
  binarySha256: BINARY_SHA256,
  maxPayload: 1011,
  chunks: [{ index: 0, offset: 0, length: 2, sha256: BINARY_SHA256 }],
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "upload-lease-"));
  const statePath = join(root, "state.json");
  const expected = {
    program: PROGRAM,
    buffer: BUFFER,
    authority: AUTHORITY,
    owner: OWNER,
    allocation: 39,
    binaryLength: BINARY_BYTES.length,
    binarySha256: BINARY_SHA256,
    planFingerprint: FINGERPRINT,
    genesis: GENESIS,
  };
  const state = {
    schemaVersion: 3,
    identities: { program: PROGRAM },
    deployment: {
      buffer: {
        publicKey: BUFFER,
        expectedOwner: OWNER,
        expectedAuthority: AUTHORITY,
        allocatedLength: 39,
        planFingerprint: FINGERPRINT,
        localBinary: { length: BINARY_BYTES.length, sha256: BINARY_SHA256 },
        chunks: [{ index: 0, offset: 0, length: 2, sha256: BINARY_SHA256, status: "CONFIRMED", signature: "public-signature" }],
        uploadWindows: [{ executionId: EXECUTION_ID, status: "COMPLETE", terminal: true }],
      },
    },
  };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  expected.stateSha256 = sha256(readFileSync(statePath));
  const observations = {
    genesisVerified: true,
    verifiedGenesis: GENESIS,
    programAbsent: true,
    confirmedChunksMatch: true,
    bufferDataSha256: sha256(Buffer.concat([Buffer.alloc(37), BINARY_BYTES])),
    programContextSlot: 100,
    bufferContextSlot: 100,
    buffer: {
      address: BUFFER,
      owner: OWNER,
      authority: AUTHORITY,
      allocation: 39,
      planFingerprint: FINGERPRINT,
    },
    transactions: [],
  };
  const acquireInput = {
    statePath,
    executionId: EXECUTION_ID,
    pid: 4242,
    hostname: "test-host",
    startedAt: "2026-07-01T00:00:00.000Z",
    program: PROGRAM,
    buffer: BUFFER,
    planFingerprint: FINGERPRINT,
    stateSha256: sha256(readFileSync(statePath)),
  };
  return { root, statePath, expected, state, observations, acquireInput };
}

function unresolvedFixture(status, evidenceOverrides = {}) {
  const input = fixture();
  const state = JSON.parse(readFileSync(input.statePath, "utf8"));
  state.deployment.buffer.chunks[0].status = status;
  writeFileSync(input.statePath, `${JSON.stringify(state, null, 2)}\n`);
  input.expected.stateSha256 = sha256(readFileSync(input.statePath));
  input.acquireInput.stateSha256 = input.expected.stateSha256;
  input.observations.transactions = [{
    chunkIndex: 0,
    recordedStatus: status,
    signature: "public-signature",
    signatureStatusFound: true,
    confirmationStatus: "finalized",
    statusSlot: 100,
    statusErr: false,
    transactionFound: true,
    transactionSignature: "public-signature",
    signatureCount: 1,
    slot: 100,
    feeLamports: 5000,
    metaErr: false,
    legacyMessage: true,
    instructionCount: 1,
    innerInstructionCount: 0,
    instructionDecoded: true,
    program: OWNER,
    accountCount: 2,
    buffer: BUFFER,
    authority: AUTHORITY,
    bufferWritable: true,
    authoritySigner: true,
    offset: 0,
    payloadLength: BINARY_BYTES.length,
    payloadSha256: BINARY_SHA256,
    payloadExactMatch: true,
    onchainLength: BINARY_BYTES.length,
    onchainSha256: BINARY_SHA256,
    onchainExactMatch: true,
    snapshotSlot: 100,
    ...evidenceOverrides,
  }];
  return input;
}

function acquire(input) {
  return acquireUploadLease(input.acquireInput);
}

function reconcileInput(input) {
  return {
    statePath: input.statePath,
    executionId: EXECUTION_ID,
    expected: input.expected,
    observations: input.observations,
  };
}

function telemetryStore(directory) {
  return createUploadTelemetryStore({
    directory,
    executionId: EXECUTION_ID,
    startedAt: "2026-07-01T00:00:00.000Z",
    startMonotonicMs: 0,
    policy: {
      preSignCooldownMs: 3_000,
      globalRequestStartGapMs: 500,
      confirmationPollIntervalMs: 2_000,
      rateLimitRetryScheduleMs: [2_000, 5_000],
      interChunkDelayMs: 3_000,
    },
  });
}

function bindTelemetryToTerminalState(input, store) {
  const state = JSON.parse(readFileSync(input.statePath, "utf8"));
  const evidence = store.evidence();
  state.deployment.buffer.uploadWindows[0].startedAt = evidence.snapshot.startedAt;
  state.deployment.buffer.uploadWindows[0].finishedAt = evidence.snapshot.finishedAt;
  state.deployment.buffer.uploadWindows[0].telemetryEvidence = {
    verdict: evidence.verdict,
    sha256: evidence.sha256,
  };
  writeFileSync(input.statePath, `${JSON.stringify(state, null, 2)}\n`);
  input.expected.stateSha256 = sha256(readFileSync(input.statePath));
  return evidence;
}

test("atomic acquisition rejects contention and stores public metadata only", () => {
  const input = fixture();
  const first = acquire(input);
  assert.equal(first.status, "ACTIVE");
  assert.throws(() => acquire(input), /ACTIVE_UPLOAD_LEASE/);
  const stored = JSON.parse(readFileSync(leasePaths(input.statePath).metadataPath, "utf8"));
  assert.deepEqual(stored, {
    lifecycle: "ACTIVE",
    executionId: EXECUTION_ID,
    pid: 4242,
    hostname: "test-host",
    startedAt: "2026-07-01T00:00:00.000Z",
    program: PROGRAM,
    buffer: BUFFER,
    planFingerprint: FINGERPRINT,
    stateSha256AtAcquire: input.acquireInput.stateSha256,
  });
  assert.doesNotMatch(JSON.stringify(stored), /secret|mnemonic|keypair|signedTransaction/i);
});

test("reconciliation is read-only and active process always fails closed", () => {
  const input = fixture();
  acquire(input);
  const paths = leasePaths(input.statePath);
  const before = {
    stateHash: sha256(readFileSync(input.statePath)),
    stateMtime: statSync(input.statePath).mtimeMs,
    leaseHash: sha256(readFileSync(paths.metadataPath)),
    files: readdirSync(input.root).sort(),
  };
  const result = reconcileUploadLease(reconcileInput(input), { processIsActive: () => true });
  assert.deepEqual(result, { command: "reconcile-upload-lease", result: "ACTIVE_PROCESS", lifecycle: "ACTIVE", stateMutation: false, onchainWrite: false });
  assert.deepEqual({
    stateHash: sha256(readFileSync(input.statePath)),
    stateMtime: statSync(input.statePath).mtimeMs,
    leaseHash: sha256(readFileSync(paths.metadataPath)),
    files: readdirSync(input.root).sort(),
  }, before);
});

test("SENT and UNKNOWN records with finalized exact canonical Write proof are conclusively resolved read-only", () => {
  for (const status of ["SENT", "UNKNOWN"]) {
    const input = unresolvedFixture(status);
    acquire(input);
    const leasePath = leasePaths(input.statePath).metadataPath;
    const before = {
      state: readFileSync(input.statePath),
      stateMtime: statSync(input.statePath).mtimeMs,
      lease: readFileSync(leasePath),
      leaseMtime: statSync(leasePath).mtimeMs,
      files: readdirSync(input.root).sort(),
    };
    const result = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
    assert.equal(result.result, "SAFE_TO_RELEASE");
    assert.equal(result.lifecycle, "SAFE_TO_RELEASE");
    assert.equal(result.releaseReady, false);
    assert.deepEqual(result.proposedTransitions, [{
      chunkIndex: 0,
      from: status,
      to: "CONFIRMED",
      signature: "public-signature",
      slot: 100,
      feeLamports: 5000,
      chunkSha256: BINARY_SHA256,
    }]);
    assert.deepEqual(result.verifiedTransactions, [{
      chunkIndex: 0,
      signature: "public-signature",
      slot: 100,
      feeLamports: 5000,
    }]);
    assert.match(result.preStateSha256, /^[a-f0-9]{64}$/);
    assert.match(result.leaseSha256, /^[a-f0-9]{64}$/);
    assert.match(result.onchainEvidenceFingerprint, /^[a-f0-9]{64}$/);
    assert.match(result.evidenceHash, /^[a-f0-9]{64}$/);
    assert.deepEqual({
      state: readFileSync(input.statePath),
      stateMtime: statSync(input.statePath).mtimeMs,
      lease: readFileSync(leasePath),
      leaseMtime: statSync(leasePath).mtimeMs,
      files: readdirSync(input.root).sort(),
    }, before);
  }
});

test("ambiguous, failed, mismatched transaction and on-chain evidence fail closed", () => {
  const cases = [
    ["wrong loader", { program: PROGRAM }, "TRANSACTION_EVIDENCE_MISMATCH"],
    ["wrong buffer", { buffer: PROGRAM }, "TRANSACTION_EVIDENCE_MISMATCH"],
    ["wrong authority", { authority: PROGRAM }, "TRANSACTION_EVIDENCE_MISMATCH"],
    ["wrong offset", { offset: 1 }, "TRANSACTION_EVIDENCE_MISMATCH"],
    ["wrong payload", { payloadSha256: "0".repeat(64), payloadExactMatch: false }, "TRANSACTION_EVIDENCE_MISMATCH"],
    ["failed transaction", { metaErr: true }, "CONFIRMED_TRANSACTION_FAILURE"],
    ["status failure", { statusErr: true }, "CONFIRMED_TRANSACTION_FAILURE"],
    ["missing signature status", { signatureStatusFound: false }, "UNRESOLVED_SENT_OR_UNKNOWN"],
    ["missing transaction", { transactionFound: false }, "UNRESOLVED_SENT_OR_UNKNOWN"],
    ["not finalized", { confirmationStatus: "confirmed" }, "UNRESOLVED_SENT_OR_UNKNOWN"],
    ["bytes mismatch", { onchainSha256: "0".repeat(64), onchainExactMatch: false }, "IDENTITY_OR_ONCHAIN_MISMATCH"],
  ];
  for (const [name, overrides, expectedResult] of cases) {
    const input = unresolvedFixture("SENT", overrides);
    acquire(input);
    const result = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
    assert.equal(result.result, expectedResult, name);
    assert.equal(result.stateMutation, false, name);
    assert.equal(result.onchainWrite, false, name);
  }

  const incomplete = unresolvedFixture("SENT");
  delete incomplete.observations.transactions[0].authoritySigner;
  acquire(incomplete);
  assert.equal(reconcileUploadLease(reconcileInput(incomplete), { processIsActive: () => false }).result, "INSUFFICIENT_EVIDENCE");
});

test("identity or on-chain mismatch and insufficient stale evidence fail closed", () => {
  const mismatch = fixture();
  acquire(mismatch);
  assert.equal(reconcileUploadLease({ ...reconcileInput(mismatch), expected: { ...mismatch.expected, authority: PROGRAM } }, { processIsActive: () => false }).result, "IDENTITY_OR_ONCHAIN_MISMATCH");
  assert.equal(reconcileUploadLease({ ...reconcileInput(mismatch), observations: { ...mismatch.observations, programAbsent: false } }, { processIsActive: () => false }).result, "IDENTITY_OR_ONCHAIN_MISMATCH");
  assert.equal(reconcileUploadLease({ ...reconcileInput(mismatch), observations: { ...mismatch.observations, confirmedChunksMatch: false } }, { processIsActive: () => false }).result, "IDENTITY_OR_ONCHAIN_MISMATCH");

  const partial = fixture();
  const paths = leasePaths(partial.statePath);
  mkdirSync(paths.activeDirectory);
  assert.equal(reconcileUploadLease(reconcileInput(partial), { processIsActive: () => false }).result, "INSUFFICIENT_EVIDENCE");
  assert.equal(existsSync(paths.activeDirectory), true);
});

test("SAFE_TO_RELEASE evidence is deterministic and lease age alone is irrelevant", () => {
  const input = fixture();
  acquire(input);
  const first = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  const second = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  assert.equal(first.result, "SAFE_TO_RELEASE");
  assert.equal(first.lifecycle, "SAFE_TO_RELEASE");
  assert.match(first.evidenceHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(second, first);
});

test("evidence hashing is canonical and binds state, lease and transaction facts", () => {
  const input = unresolvedFixture("SENT");
  acquire(input);
  const first = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  const entries = Object.entries(input.observations.transactions[0]).reverse();
  input.observations.transactions[0] = Object.fromEntries(entries);
  const reordered = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  assert.equal(reordered.evidenceHash, first.evidenceHash);

  input.observations.transactions[0].snapshotSlot = 101;
  input.observations.programContextSlot = 101;
  input.observations.bufferContextSlot = 101;
  const laterEquivalentSnapshot = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  assert.equal(laterEquivalentSnapshot.evidenceHash, first.evidenceHash);

  input.observations.transactions[0].feeLamports = 5001;
  const transactionChanged = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  assert.notEqual(transactionChanged.evidenceHash, first.evidenceHash);

  const state = JSON.parse(readFileSync(input.statePath, "utf8"));
  state.auditNote = "state hash binding";
  writeFileSync(input.statePath, `${JSON.stringify(state, null, 2)}\n`);
  input.expected.stateSha256 = sha256(readFileSync(input.statePath));
  const stateChanged = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  assert.notEqual(stateChanged.evidenceHash, transactionChanged.evidenceHash);

  const leasePath = leasePaths(input.statePath).metadataPath;
  const lease = JSON.parse(readFileSync(leasePath, "utf8"));
  lease.startedAt = "2026-07-01T00:00:01.000Z";
  writeFileSync(leasePath, `${JSON.stringify(lease, null, 2)}\n`);
  const leaseChanged = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  assert.notEqual(leaseChanged.evidenceHash, stateChanged.evidenceHash);
  assert.notEqual(leaseChanged.leaseSha256, stateChanged.leaseSha256);
});

test("ambiguous terminal outcomes and manually confirmed unknown outcomes lack sufficient provenance", () => {
  const duplicate = fixture();
  const duplicateState = JSON.parse(readFileSync(duplicate.statePath, "utf8"));
  duplicateState.deployment.buffer.uploadWindows.push({ executionId: EXECUTION_ID, status: "COMPLETE", terminal: true });
  writeFileSync(duplicate.statePath, `${JSON.stringify(duplicateState, null, 2)}\n`);
  duplicate.expected.stateSha256 = sha256(readFileSync(duplicate.statePath));
  duplicate.acquireInput.stateSha256 = duplicate.expected.stateSha256;
  acquire(duplicate);
  assert.equal(reconcileUploadLease(reconcileInput(duplicate), { processIsActive: () => false }).result, "INSUFFICIENT_EVIDENCE");

  const manual = fixture();
  const manualState = JSON.parse(readFileSync(manual.statePath, "utf8"));
  manualState.deployment.buffer.uploadWindows[0].status = "RPC_OUTCOME_UNKNOWN";
  writeFileSync(manual.statePath, `${JSON.stringify(manualState, null, 2)}\n`);
  manual.expected.stateSha256 = sha256(readFileSync(manual.statePath));
  manual.acquireInput.stateSha256 = manual.expected.stateSha256;
  acquire(manual);
  assert.equal(reconcileUploadLease(reconcileInput(manual), { processIsActive: () => false }).result, "INSUFFICIENT_EVIDENCE");

  const forged = unresolvedFixture("SENT");
  const forgedState = JSON.parse(readFileSync(forged.statePath, "utf8"));
  forgedState.deployment.buffer.uploadWindows[0].status = "RPC_OUTCOME_UNKNOWN";
  writeFileSync(forged.statePath, `${JSON.stringify(forgedState, null, 2)}\n`);
  forged.expected.stateSha256 = sha256(readFileSync(forged.statePath));
  forged.acquireInput.stateSha256 = sha256(readFileSync(forged.statePath));
  acquire(forged);
  const leaseSha256 = sha256(readFileSync(leasePaths(forged.statePath).metadataPath));
  forgedState.deployment.buffer.chunks[0].status = "CONFIRMED";
  forgedState.deployment.buffer.uploadWindows[0].reconciliationOutcomes = [{
    version: "UPLOAD_RECONCILIATION_V1",
    executionId: EXECUTION_ID,
    evidenceHash: "d".repeat(64),
    appliedAt: "2026-07-19T00:00:00.000Z",
    stateSha256Before: "c".repeat(64),
    leaseSha256,
    onchainEvidenceFingerprint: "e".repeat(64),
    transitions: [{
      chunkIndex: 0,
      from: "SENT",
      to: "CONFIRMED",
      signature: "public-signature",
      slot: 100,
      feeLamports: 5000,
      chunkSha256: BINARY_SHA256,
    }],
  }];
  writeFileSync(forged.statePath, `${JSON.stringify(forgedState, null, 2)}\n`);
  forged.expected.stateSha256 = sha256(readFileSync(forged.statePath));
  assert.equal(reconcileUploadLease(reconcileInput(forged), { processIsActive: () => false }).result, "INSUFFICIENT_EVIDENCE");
});

test("a valid decoy receipt cannot hide a different chunk from the complete pre-apply unresolved set", () => {
  const input = fixture();
  const firstSha256 = sha256(BINARY_BYTES.subarray(0, 1));
  const secondSha256 = sha256(BINARY_BYTES.subarray(1, 2));
  const chunks = [
    { index: 0, offset: 0, length: 1, sha256: firstSha256, status: "SENT", signature: "public-signature" },
    { index: 1, offset: 1, length: 1, sha256: secondSha256, status: "CONFIRMED", signature: "unproved-signature" },
  ];
  const fingerprint = createPlanFingerprint({
    program: PROGRAM,
    buffer: BUFFER,
    authority: AUTHORITY,
    allocation: 39,
    binarySha256: BINARY_SHA256,
    maxPayload: 1011,
    chunks,
  });
  const decoyPreState = JSON.parse(readFileSync(input.statePath, "utf8"));
  decoyPreState.deployment.buffer.chunks = chunks;
  decoyPreState.deployment.buffer.planFingerprint = fingerprint;
  decoyPreState.deployment.buffer.uploadWindows[0].status = "RPC_OUTCOME_UNKNOWN";
  writeFileSync(input.statePath, `${JSON.stringify(decoyPreState, null, 2)}\n`);
  input.expected.planFingerprint = fingerprint;
  input.expected.stateSha256 = sha256(readFileSync(input.statePath));
  input.acquireInput.planFingerprint = fingerprint;
  input.acquireInput.stateSha256 = input.expected.stateSha256;
  input.observations.buffer.planFingerprint = fingerprint;
  input.observations.transactions = [{
    ...unresolvedFixture("SENT").observations.transactions[0],
    chunkIndex: 0,
    payloadLength: 1,
    payloadSha256: firstSha256,
    onchainLength: 1,
    onchainSha256: firstSha256,
  }];
  acquire(input);
  const decoySafe = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  assert.equal(decoySafe.result, "SAFE_TO_RELEASE");
  assert.deepEqual(decoySafe.proposedTransitions.map(({ chunkIndex }) => chunkIndex), [0]);

  const realPreState = structuredClone(decoyPreState);
  realPreState.deployment.buffer.chunks[0].status = "CONFIRMED";
  realPreState.deployment.buffer.chunks[1].status = "SENT";
  const postState = structuredClone(realPreState);
  postState.deployment.buffer.chunks[1].status = "CONFIRMED";
  postState.deployment.buffer.uploadWindows[0].reconciliationOutcomes = [{
    version: "UPLOAD_RECONCILIATION_V1",
    executionId: EXECUTION_ID,
    evidenceHash: decoySafe.evidenceHash,
    appliedAt: "2026-07-19T00:00:00.000Z",
    stateSha256Before: sha256(Buffer.from(`${JSON.stringify(realPreState, null, 2)}\n`)),
    leaseSha256: decoySafe.leaseSha256,
    onchainEvidenceFingerprint: decoySafe.onchainEvidenceFingerprint,
    transitions: decoySafe.proposedTransitions,
  }];
  writeFileSync(input.statePath, `${JSON.stringify(postState, null, 2)}\n`);
  input.expected.stateSha256 = sha256(readFileSync(input.statePath));

  assert.equal(reconcileUploadLease(reconcileInput(input), { processIsActive: () => false }).result, "INSUFFICIENT_EVIDENCE");
});

test("release rejects missing acknowledgement, stale hash and state-hash drift", () => {
  const input = fixture();
  acquire(input);
  const safe = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  assert.throws(() => releaseUploadLease({ ...reconcileInput(input), reconciliationHash: safe.evidenceHash }, { processIsActive: () => false }), /acknowledgement/);
  assert.throws(() => releaseUploadLease({ ...reconcileInput(input), reconciliationHash: "0".repeat(64), acknowledgement: "R4_RELEASE_UPLOAD_LEASE" }, { processIsActive: () => false }), /STATE_HASH_DRIFT_OR_STALE_EVIDENCE/);

  const state = JSON.parse(readFileSync(input.statePath, "utf8"));
  state.deployment.buffer.uploadWindows[0].reviewNote = "public drift";
  writeFileSync(input.statePath, JSON.stringify(state));
  assert.throws(() => releaseUploadLease({ ...reconcileInput(input), reconciliationHash: safe.evidenceHash, acknowledgement: "R4_RELEASE_UPLOAD_LEASE" }, { processIsActive: () => false }), /STATE_HASH_DRIFT_OR_STALE_EVIDENCE/);
  assert.equal(existsSync(leasePaths(input.statePath).activeDirectory), true);
});

test("release archives atomically, preserves audit evidence and replays idempotently", () => {
  const input = fixture();
  acquire(input);
  const safe = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  const request = { ...reconcileInput(input), reconciliationHash: safe.evidenceHash, acknowledgement: "R4_RELEASE_UPLOAD_LEASE" };
  const first = releaseUploadLease(request, { processIsActive: () => false });
  assert.equal(first.lifecycle, "ARCHIVED/RELEASED");
  assert.equal(first.idempotent, false);
  const paths = leasePaths(input.statePath, EXECUTION_ID, safe.evidenceHash);
  assert.equal(existsSync(paths.activeDirectory), false);
  assert.equal(existsSync(paths.archiveDirectory), true);
  assert.equal(existsSync(join(paths.archiveDirectory, "lease.json")), true);
  assert.deepEqual(JSON.parse(readFileSync(join(paths.archiveDirectory, "release.json"), "utf8")), {
    version: "UPLOAD_LEASE_RELEASE_V1",
    authorization: "SAFE_TO_ARCHIVE",
    executionId: EXECUTION_ID,
    evidenceHash: safe.evidenceHash,
    stateSha256: safe.preStateSha256,
    leaseSha256: safe.leaseSha256,
  });
  assert.equal(existsSync(`${input.statePath}.upload-lease-operation-lock`), false);
  const second = releaseUploadLease(request, { processIsActive: () => false });
  assert.deepEqual(second, { command: "release-upload-lease", lifecycle: "ARCHIVED/RELEASED", executionId: EXECUTION_ID, evidenceHash: safe.evidenceHash, idempotent: true, stateMutation: false, onchainWrite: false });
});

test("release verifies existing telemetry bytes and canonical hash survive the archive rename", () => {
  const input = fixture();
  acquire(input);
  const activeDirectory = leasePaths(input.statePath).activeDirectory;
  const store = telemetryStore(activeDirectory);
  const before = bindTelemetryToTerminalState(input, store);
  const beforeBytes = readFileSync(join(activeDirectory, "telemetry.json"));
  const safe = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  const request = { ...reconcileInput(input), reconciliationHash: safe.evidenceHash, acknowledgement: "R4_RELEASE_UPLOAD_LEASE" };
  releaseUploadLease(request, { processIsActive: () => false });

  const archiveDirectory = leasePaths(input.statePath, EXECUTION_ID, safe.evidenceHash).archiveDirectory;
  const after = readUploadTelemetry(archiveDirectory);
  assert.equal(after.sha256, before.sha256);
  assert.deepEqual(readFileSync(join(archiveDirectory, "telemetry.json")), beforeBytes);
  assert.equal(store.evidence().verdict, "INCOMPLETE");
});

test("release fails closed if telemetry changes during the archive boundary", () => {
  const input = fixture();
  acquire(input);
  const store = telemetryStore(leasePaths(input.statePath).activeDirectory);
  bindTelemetryToTerminalState(input, store);
  const safe = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  const request = { ...reconcileInput(input), reconciliationHash: safe.evidenceHash, acknowledgement: "R4_RELEASE_UPLOAD_LEASE" };

  assert.throws(() => releaseUploadLease(request, {
    processIsActive: () => false,
    renameSync(source, destination) {
      renameSync(source, destination);
      telemetryStore(destination).recordRpcEntry({
        sequence: 1,
        methodClass: "GET_ACCOUNT_INFO",
        startMonotonicMs: 0,
        endMonotonicMs: 10,
        durationMs: 10,
        outcome: "SUCCESS",
        retryNumber: 0,
        signaturePersisted: false,
        mutationCapability: "read",
      });
    },
  }), /telemetry.*archive|archive.*telemetry/i);
});

test("idempotent release fails closed when archived telemetry no longer matches terminal state", () => {
  const input = fixture();
  acquire(input);
  const activeDirectory = leasePaths(input.statePath).activeDirectory;
  const store = telemetryStore(activeDirectory);
  bindTelemetryToTerminalState(input, store);
  const safe = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  const request = { ...reconcileInput(input), reconciliationHash: safe.evidenceHash, acknowledgement: "R4_RELEASE_UPLOAD_LEASE" };
  releaseUploadLease(request, { processIsActive: () => false });

  const archiveDirectory = leasePaths(input.statePath, EXECUTION_ID, safe.evidenceHash).archiveDirectory;
  telemetryStore(archiveDirectory).recordRpcEntry({
    sequence: 1,
    methodClass: "GET_ACCOUNT_INFO",
    startMonotonicMs: 0,
    endMonotonicMs: 10,
    durationMs: 10,
    outcome: "SUCCESS",
    retryNumber: 0,
    signaturePersisted: false,
    mutationCapability: "read",
  });
  assert.throws(
    () => releaseUploadLease(request, { processIsActive: () => false }),
    /telemetry.*state|state.*telemetry/i,
  );
});

test("release rejects telemetry from a different execution or lease start", () => {
  for (const scenario of [
    { executionId: "foreign-execution", startedAt: "2026-07-01T00:00:00.000Z" },
    { executionId: EXECUTION_ID, startedAt: "2026-07-02T00:00:00.000Z" },
  ]) {
    const input = fixture();
    acquire(input);
    const store = createUploadTelemetryStore({
      directory: leasePaths(input.statePath).activeDirectory,
      executionId: scenario.executionId,
      startedAt: scenario.startedAt,
      startMonotonicMs: 0,
      policy: {
        preSignCooldownMs: 3_000,
        globalRequestStartGapMs: 500,
        confirmationPollIntervalMs: 2_000,
        rateLimitRetryScheduleMs: [2_000, 5_000],
        interChunkDelayMs: 3_000,
      },
    });
    bindTelemetryToTerminalState(input, store);
    const safe = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
    assert.throws(() => releaseUploadLease({
      ...reconcileInput(input),
      reconciliationHash: safe.evidenceHash,
      acknowledgement: "R4_RELEASE_UPLOAD_LEASE",
    }, { processIsActive: () => false }), /telemetry.*execution|telemetry.*start|state binding/i);
  }
});

test("release rejects telemetry with a terminal finish timestamp different from state", () => {
  const input = fixture();
  acquire(input);
  const store = telemetryStore(leasePaths(input.statePath).activeDirectory);
  store.finish({
    finishedAt: "2026-07-01T00:00:01.000Z",
    finishedMonotonicMs: 1_000,
    expectedChunkIndexes: [],
  });
  bindTelemetryToTerminalState(input, store);
  const state = JSON.parse(readFileSync(input.statePath, "utf8"));
  state.deployment.buffer.uploadWindows[0].finishedAt = "2026-07-01T00:00:02.000Z";
  writeFileSync(input.statePath, `${JSON.stringify(state, null, 2)}\n`);
  input.expected.stateSha256 = sha256(readFileSync(input.statePath));

  const safe = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  assert.throws(() => releaseUploadLease({
    ...reconcileInput(input),
    reconciliationHash: safe.evidenceHash,
    acknowledgement: "R4_RELEASE_UPLOAD_LEASE",
  }, { processIsActive: () => false }), /telemetry.*finish|terminal.*timestamp/i);
});

test("release writes a matching audit receipt before the single atomic directory move", () => {
  const input = fixture();
  acquire(input);
  const safe = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  const request = { ...reconcileInput(input), reconciliationHash: safe.evidenceHash, acknowledgement: "R4_RELEASE_UPLOAD_LEASE" };
  const renames = [];
  const result = releaseUploadLease(request, {
    processIsActive: () => false,
    renameSync(source, destination) {
      assert.equal(existsSync(join(source, "release.json")), true);
      assert.equal(existsSync(join(source, "release.json.tmp")), false);
      renames.push([source, destination]);
      renameSync(source, destination);
    },
  });
  assert.equal(result.lifecycle, "ARCHIVED/RELEASED");
  const paths = leasePaths(input.statePath, EXECUTION_ID, safe.evidenceHash);
  assert.deepEqual(renames, [[paths.activeDirectory, paths.archiveDirectory]]);
});

test("apply and release share a fail-closed local operation lock", () => {
  const input = fixture();
  acquire(input);
  const safe = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  const operationLock = `${input.statePath}.upload-lease-operation-lock`;
  mkdirSync(operationLock);
  assert.throws(() => releaseUploadLease({
    ...reconcileInput(input),
    reconciliationHash: safe.evidenceHash,
    acknowledgement: "R4_RELEASE_UPLOAD_LEASE",
  }, { processIsActive: () => false }), /BUSY/);
  assert.equal(existsSync(leasePaths(input.statePath).activeDirectory), true);
});

test("atomic archive failure leaves the active lease and no false release claim", () => {
  const input = fixture();
  acquire(input);
  const safe = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  const paths = leasePaths(input.statePath, EXECUTION_ID, safe.evidenceHash);
  assert.throws(() => releaseUploadLease({ ...reconcileInput(input), reconciliationHash: safe.evidenceHash, acknowledgement: "R4_RELEASE_UPLOAD_LEASE" }, {
    processIsActive: () => false,
    renameSync() { throw new Error("injected archive failure"); },
  }), /archive failed/);
  assert.equal(existsSync(paths.activeDirectory), true);
  assert.equal(existsSync(paths.archiveDirectory), false);
  const receipt = JSON.parse(readFileSync(join(paths.activeDirectory, "release.json"), "utf8"));
  assert.equal(receipt.authorization, "SAFE_TO_ARCHIVE");
  assert.equal(Object.hasOwn(receipt, "lifecycle"), false);
  assert.equal(existsSync(`${input.statePath}.upload-lease-operation-lock`), false);
  const retried = releaseUploadLease({ ...reconcileInput(input), reconciliationHash: safe.evidenceHash, acknowledgement: "R4_RELEASE_UPLOAD_LEASE" }, {
    processIsActive: () => false,
  });
  assert.equal(retried.lifecycle, "ARCHIVED/RELEASED");
  assert.equal(existsSync(paths.activeDirectory), false);
  assert.equal(existsSync(join(paths.archiveDirectory, "release.json")), true);
});

test("a forged archive without a matching release receipt cannot replay as released", () => {
  const input = fixture();
  acquire(input);
  const safe = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
  const paths = leasePaths(input.statePath, EXECUTION_ID, safe.evidenceHash);
  mkdirSync(paths.archiveRoot, { recursive: true });
  renameSync(paths.activeDirectory, paths.archiveDirectory);
  assert.throws(() => releaseUploadLease({
    ...reconcileInput(input),
    reconciliationHash: safe.evidenceHash,
    acknowledgement: "R4_RELEASE_UPLOAD_LEASE",
  }, { processIsActive: () => false }), /release receipt is invalid/);
  assert.equal(existsSync(paths.archiveDirectory), true);
});
