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

import {
  acquireUploadLease,
  leasePaths,
  reconcileUploadLease,
  releaseUploadLease,
} from "../../scripts/devnet/upload-execution-lease.mjs";

const PROGRAM = "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z";
const BUFFER = "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW";
const AUTHORITY = "Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk";
const OWNER = "BPFLoaderUpgradeab1e11111111111111111111111";
const FINGERPRINT = "f".repeat(64);
const EXECUTION_ID = "execution-r4a-test";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "upload-lease-"));
  const statePath = join(root, "state.json");
  const expected = {
    program: PROGRAM,
    buffer: BUFFER,
    authority: AUTHORITY,
    owner: OWNER,
    allocation: 39,
    planFingerprint: FINGERPRINT,
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
        localBinary: { length: 2, sha256: "b".repeat(64) },
        chunks: [{ index: 0, offset: 0, length: 2, sha256: "a".repeat(64), status: "CONFIRMED", signature: "public-signature" }],
        uploadWindows: [{ executionId: EXECUTION_ID, status: "COMPLETE", terminal: true }],
      },
    },
  };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const observations = {
    genesisVerified: true,
    programAbsent: true,
    confirmedChunksMatch: true,
    buffer: {
      address: BUFFER,
      owner: OWNER,
      authority: AUTHORITY,
      allocation: 39,
      planFingerprint: FINGERPRINT,
    },
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

test("unresolved SENT or UNKNOWN records prevent safe release", () => {
  for (const status of ["SENT", "UNKNOWN"]) {
    const input = fixture();
    const state = JSON.parse(readFileSync(input.statePath, "utf8"));
    state.deployment.buffer.chunks[0].status = status;
    writeFileSync(input.statePath, JSON.stringify(state));
    input.acquireInput.stateSha256 = sha256(readFileSync(input.statePath));
    acquire(input);
    const result = reconcileUploadLease(reconcileInput(input), { processIsActive: () => false });
    assert.equal(result.result, "UNRESOLVED_SENT_OR_UNKNOWN");
    assert.equal(result.lifecycle, "RECONCILIATION_REQUIRED");
  }
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
  const second = releaseUploadLease(request, { processIsActive: () => false });
  assert.deepEqual(second, { command: "release-upload-lease", lifecycle: "ARCHIVED/RELEASED", executionId: EXECUTION_ID, evidenceHash: safe.evidenceHash, idempotent: true, stateMutation: false, onchainWrite: false });
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
});
