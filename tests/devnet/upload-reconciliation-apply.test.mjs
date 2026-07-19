import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPlanFingerprint } from "../../scripts/devnet/throttled-uploader.mjs";
import {
  acquireUploadLease,
  applyUploadReconciliation,
  leasePaths,
  reconcileUploadLease,
  releaseUploadLease,
} from "../../scripts/devnet/upload-execution-lease.mjs";

const PROGRAM = "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z";
const BUFFER = "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW";
const AUTHORITY = "Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk";
const OWNER = "BPFLoaderUpgradeab1e11111111111111111111111";
const GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const EXECUTION_ID = "execution-apply-test";
const BYTES = Buffer.from([11, 12]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const BINARY_SHA256 = sha256(BYTES);
const FINGERPRINT = createPlanFingerprint({
  program: PROGRAM,
  buffer: BUFFER,
  authority: AUTHORITY,
  allocation: 39,
  binarySha256: BINARY_SHA256,
  maxPayload: 1011,
  chunks: [{ index: 0, offset: 0, length: 2, sha256: BINARY_SHA256 }],
});

function fixture(status = "SENT") {
  const root = mkdtempSync(join(tmpdir(), "upload-reconciliation-apply-"));
  const statePath = join(root, "state.json");
  const state = {
    schemaVersion: 3,
    identities: { program: PROGRAM },
    deployment: {
      buffer: {
        publicKey: BUFFER,
        expectedOwner: OWNER,
        expectedAuthority: AUTHORITY,
        allocatedLength: 39,
        localBinary: { length: 2, sha256: BINARY_SHA256 },
        planFingerprint: FINGERPRINT,
        chunks: [{ index: 0, offset: 0, length: 2, sha256: BINARY_SHA256, status, signature: "public-signature" }],
        uploadWindows: [{ executionId: EXECUTION_ID, status: "RPC_OUTCOME_UNKNOWN", terminal: true }],
      },
    },
  };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const stateSha256 = sha256(readFileSync(statePath));
  acquireUploadLease({
    statePath,
    executionId: EXECUTION_ID,
    pid: 8181,
    hostname: "test-host",
    startedAt: "2026-07-19T00:00:00.000Z",
    program: PROGRAM,
    buffer: BUFFER,
    planFingerprint: FINGERPRINT,
    stateSha256,
  });
  const input = {
    statePath,
    executionId: EXECUTION_ID,
    expected: {
      genesis: GENESIS,
      program: PROGRAM,
      buffer: BUFFER,
      authority: AUTHORITY,
      owner: OWNER,
      allocation: 39,
      binaryLength: 2,
      binarySha256: BINARY_SHA256,
      planFingerprint: FINGERPRINT,
      stateSha256,
    },
    observations: {
      genesisVerified: true,
      verifiedGenesis: GENESIS,
      programAbsent: true,
      programContextSlot: 700,
      confirmedChunksMatch: true,
      bufferDataSha256: sha256(Buffer.concat([Buffer.alloc(37), BYTES])),
      bufferContextSlot: 700,
      buffer: {
        address: BUFFER,
        owner: OWNER,
        authority: AUTHORITY,
        allocation: 39,
        planFingerprint: FINGERPRINT,
      },
      transactions: [{
        chunkIndex: 0,
        recordedStatus: status,
        signature: "public-signature",
        signatureStatusFound: true,
        confirmationStatus: "finalized",
        statusSlot: 699,
        statusErr: false,
        transactionFound: true,
        transactionSignature: "public-signature",
        signatureCount: 1,
        slot: 699,
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
        payloadLength: 2,
        payloadSha256: BINARY_SHA256,
        payloadExactMatch: true,
        onchainLength: 2,
        onchainSha256: BINARY_SHA256,
        onchainExactMatch: true,
        snapshotSlot: 700,
      }],
    },
  };
  return { root, statePath, input };
}

function safeResult(value) {
  return reconcileUploadLease(value.input, { processIsActive: () => false });
}

function applyRequest(value, evidenceHash, overrides = {}) {
  return {
    ...value.input,
    reconciliationHash: evidenceHash,
    acknowledgement: "R4_APPLY_UPLOAD_RECONCILIATION",
    ...overrides,
  };
}

test("apply requires exact acknowledgement and fresh matching reconciliation evidence", () => {
  const value = fixture();
  const safe = safeResult(value);
  const before = readFileSync(value.statePath);
  assert.throws(() => applyUploadReconciliation({ ...value.input, reconciliationHash: safe.evidenceHash }, { processIsActive: () => false }), /acknowledgement/);
  assert.throws(() => applyUploadReconciliation(applyRequest(value, "0".repeat(64)), { processIsActive: () => false }), /STALE|DRIFT|evidence/i);
  assert.deepEqual(readFileSync(value.statePath), before);
});

test("apply atomically persists only proposed transitions and a sanitized proof receipt", () => {
  for (const status of ["SENT", "UNKNOWN"]) {
    const value = fixture(status);
    const stateBefore = JSON.parse(readFileSync(value.statePath, "utf8"));
    const safe = safeResult(value);
    const leasePath = leasePaths(value.statePath).metadataPath;
    const leaseBefore = readFileSync(leasePath);
    const result = applyUploadReconciliation(applyRequest(value, safe.evidenceHash), {
      processIsActive: () => false,
      now: () => "2026-07-19T01:00:00.000Z",
    });
    assert.equal(result.status, "APPLIED");
    assert.equal(result.stateMutation, true);
    assert.equal(result.onchainWrite, false);
    const state = JSON.parse(readFileSync(value.statePath, "utf8"));
    const receipt = state.deployment.buffer.uploadWindows[0].reconciliationOutcomes[0];
    const expectedReceipt = {
      version: "UPLOAD_RECONCILIATION_V1",
      executionId: EXECUTION_ID,
      evidenceHash: safe.evidenceHash,
      appliedAt: "2026-07-19T01:00:00.000Z",
      stateSha256Before: safe.preStateSha256,
      leaseSha256: safe.leaseSha256,
      onchainEvidenceFingerprint: safe.onchainEvidenceFingerprint,
      transitions: safe.proposedTransitions,
    };
    const expectedState = structuredClone(stateBefore);
    expectedState.deployment.buffer.chunks[0].status = "CONFIRMED";
    expectedState.deployment.buffer.uploadWindows[0].reconciliationOutcomes = [expectedReceipt];
    assert.deepEqual(state, expectedState);
    assert.deepEqual(receipt, expectedReceipt);
    assert.doesNotMatch(JSON.stringify(receipt), /mnemonic|secret|private|rawTransaction|keypair/i);
    assert.deepEqual(readFileSync(leasePath), leaseBefore);
    assert.equal(existsSync(`${value.statePath}.upload-lease-operation-lock`), false);
    assert.deepEqual(readdirSync(value.root).sort(), ["state.json", "state.json.upload-lease"]);
  }
});

test("apply and release use the same fail-closed operation lock", () => {
  const value = fixture();
  const safe = safeResult(value);
  const before = readFileSync(value.statePath);
  const lockPath = `${value.statePath}.upload-lease-operation-lock`;
  mkdirSync(lockPath);
  assert.throws(() => applyUploadReconciliation(applyRequest(value, safe.evidenceHash), {
    processIsActive: () => false,
  }), /UPLOAD_LEASE_OPERATION_BUSY/);
  assert.deepEqual(readFileSync(value.statePath), before);
  assert.equal(existsSync(lockPath), true);
});

test("apply rejects state and lease drift without writing", () => {
  for (const target of ["state", "lease"]) {
    const value = fixture();
    const safe = safeResult(value);
    if (target === "state") {
      const state = JSON.parse(readFileSync(value.statePath, "utf8"));
      state.reviewNote = "drift";
      writeFileSync(value.statePath, JSON.stringify(state));
    } else {
      const path = leasePaths(value.statePath).metadataPath;
      const lease = JSON.parse(readFileSync(path, "utf8"));
      lease.startedAt = "2026-07-19T00:00:01.000Z";
      writeFileSync(path, JSON.stringify(lease));
    }
    const before = readFileSync(value.statePath);
    assert.throws(() => applyUploadReconciliation(applyRequest(value, safe.evidenceHash), { processIsActive: () => false }), /STALE|DRIFT|evidence/i, target);
    assert.deepEqual(readFileSync(value.statePath), before, target);
  }
});

test("apply restores exact original state on write and post-validation failure", () => {
  for (const failure of ["write", "post-validation"]) {
    const value = fixture();
    const safe = safeResult(value);
    const before = readFileSync(value.statePath);
    const beforeMtime = statSync(value.statePath).mtimeMs;
    assert.throws(() => applyUploadReconciliation(applyRequest(value, safe.evidenceHash), {
      processIsActive: () => false,
      saveStateAtomic(path, state) {
        writeFileSync(path, failure === "write" ? "partial" : JSON.stringify({ ...state, schemaVersion: 99 }));
        if (failure === "write") throw new Error("injected write failure");
      },
    }), /restored|rollback|validation/i, failure);
    assert.deepEqual(readFileSync(value.statePath), before, failure);
    assert.ok(statSync(value.statePath).mtimeMs >= beforeMtime, failure);
    assert.equal(existsSync(`${value.statePath}.upload-lease-operation-lock`), false, failure);
  }
});

test("matching applied evidence is idempotent while unmatched replay is rejected", () => {
  const value = fixture();
  const safe = safeResult(value);
  applyUploadReconciliation(applyRequest(value, safe.evidenceHash), { processIsActive: () => false, now: () => "2026-07-19T01:00:00.000Z" });
  value.input.expected.stateSha256 = sha256(readFileSync(value.statePath));
  const before = readFileSync(value.statePath);
  const mtime = statSync(value.statePath).mtimeMs;
  const replay = applyUploadReconciliation(applyRequest(value, safe.evidenceHash), { processIsActive: () => false });
  assert.equal(replay.status, "ALREADY_APPLIED");
  assert.equal(replay.stateMutation, false);
  assert.deepEqual(readFileSync(value.statePath), before);
  assert.equal(statSync(value.statePath).mtimeMs, mtime);
  assert.throws(() => applyUploadReconciliation(applyRequest(value, "f".repeat(64)), { processIsActive: () => false }), /STALE|DRIFT|evidence/i);
});

test("release is impossible before apply and requires a fresh zero-transition hash after apply", () => {
  const value = fixture();
  const beforeApply = safeResult(value);
  assert.equal(beforeApply.releaseReady, false);
  assert.throws(() => releaseUploadLease({
    ...value.input,
    reconciliationHash: beforeApply.evidenceHash,
    acknowledgement: "R4_RELEASE_UPLOAD_LEASE",
  }, { processIsActive: () => false }), /transitions.*applied|not release-ready/i);
  assert.equal(existsSync(leasePaths(value.statePath).activeDirectory), true);

  applyUploadReconciliation(applyRequest(value, beforeApply.evidenceHash), { processIsActive: () => false });
  value.input.expected.stateSha256 = sha256(readFileSync(value.statePath));
  const afterApply = safeResult(value);
  assert.equal(afterApply.result, "SAFE_TO_RELEASE");
  assert.equal(afterApply.releaseReady, true);
  assert.deepEqual(afterApply.proposedTransitions, []);
  assert.notEqual(afterApply.evidenceHash, beforeApply.evidenceHash);
  assert.throws(() => releaseUploadLease({
    ...value.input,
    reconciliationHash: beforeApply.evidenceHash,
    acknowledgement: "R4_RELEASE_UPLOAD_LEASE",
  }, { processIsActive: () => false }), /STALE|DRIFT|release-ready/i);
  const released = releaseUploadLease({
    ...value.input,
    reconciliationHash: afterApply.evidenceHash,
    acknowledgement: "R4_RELEASE_UPLOAD_LEASE",
  }, { processIsActive: () => false });
  assert.equal(released.lifecycle, "ARCHIVED/RELEASED");
});
