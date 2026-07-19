import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  inspectStateMigration,
  migrateStateV3,
  validateUploadStateV3,
} from "../../scripts/devnet/state-migration-command.mjs";
import { saveStateAtomic } from "../../scripts/devnet/state.mjs";

const PROGRAM = "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z";
const BUFFER = "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW";
const AUTHORITY = "Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk";
const OWNER = "BPFLoaderUpgradeab1e11111111111111111111111";
const BINARY = Buffer.from(Array.from({ length: 2_300 }, (_, index) => index % 251));
const BINARY_HASH = createHash("sha256").update(BINARY).digest("hex");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "state-v3-migration-"));
  const statePath = join(root, "state.json");
  const binaryPath = join(root, "program.so");
  const expected = {
    program: PROGRAM,
    buffer: BUFFER,
    authority: AUTHORITY,
    owner: OWNER,
    allocation: BINARY.length + 37,
    binaryLength: BINARY.length,
    binarySha256: BINARY_HASH,
  };
  const state = {
    schemaVersion: 2,
    identities: { program: PROGRAM, deploymentAuthority: AUTHORITY },
    deployment: {
      buffer: {
        publicKey: BUFFER,
        expectedOwner: OWNER,
        expectedAuthority: AUTHORITY,
        allocatedLength: expected.allocation,
        localBinary: { length: BINARY.length, sha256: BINARY_HASH },
      },
    },
  };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  writeFileSync(binaryPath, BINARY);
  return { root, statePath, binaryPath, expected, state };
}

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("inspect-state-migration is read-only and returns only a sanitized structural summary", () => {
  const input = fixture();
  const before = {
    hash: hash(input.statePath),
    mtimeMs: statSync(input.statePath).mtimeMs,
    files: readdirSync(input.root).sort(),
  };
  const report = inspectStateMigration(input);
  assert.deepEqual(report, {
    command: "inspect-state-migration",
    currentSchemaVersion: 2,
    targetSchemaVersion: 3,
    migrationRequired: true,
    additions: ["deployment.buffer.chunks", "deployment.buffer.planFingerprint", "deployment.buffer.uploadWindows"],
    stateMutation: false,
  });
  assert.deepEqual({ hash: hash(input.statePath), mtimeMs: statSync(input.statePath).mtimeMs, files: readdirSync(input.root).sort() }, before);
  assert.doesNotMatch(JSON.stringify(report), /authority\.json|secret|mnemonic|private/i);
});

test("schema v2 cannot be used directly as an upload checkpoint", () => {
  const input = fixture();
  assert.throws(() => validateUploadStateV3(input.state, input.expected), /schema must be v3/);
});

test("migrate-state-v3 creates a collision-safe backup, derives exact plan evidence and is idempotent", () => {
  const input = fixture();
  let backupPath;
  const first = migrateStateV3({ ...input, acknowledgement: "R4_MIGRATE_STATE_V3" }, {
    isIgnoredPath: () => true,
    timestamp: () => "2026-07-19T00-00-00Z",
    onBackup(path) { backupPath = path; },
  });
  assert.deepEqual(first, { command: "migrate-state-v3", status: "MIGRATED", backupCreated: true, stateMutation: true });
  assert.equal(existsSync(backupPath), true);
  const migrated = JSON.parse(readFileSync(input.statePath, "utf8"));
  assert.equal(validateUploadStateV3(migrated, input.expected), true);
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.deployment.buffer.chunks.length, 3);
  assert.deepEqual(migrated.deployment.buffer.chunks.map(({ status }) => status), ["PLANNED", "PLANNED", "PLANNED"]);
  assert.match(migrated.deployment.buffer.planFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(migrated.deployment.buffer.uploadWindows, []);
  const stateHash = hash(input.statePath);
  const files = readdirSync(dirname(backupPath)).sort();

  const second = migrateStateV3({ ...input, acknowledgement: "R4_MIGRATE_STATE_V3" }, {
    isIgnoredPath: () => true,
    timestamp: () => "2026-07-19T00-00-01Z",
  });
  assert.deepEqual(second, { command: "migrate-state-v3", status: "ALREADY_V3", backupCreated: false, stateMutation: false });
  assert.equal(hash(input.statePath), stateHash);
  assert.deepEqual(readdirSync(dirname(backupPath)).sort(), files);
});

test("migration rejects acknowledgement, ignored-path and every checkpoint mismatch", () => {
  const input = fixture();
  assert.throws(() => migrateStateV3(input, { isIgnoredPath: () => true }), /acknowledgement/);
  assert.throws(() => migrateStateV3({ ...input, acknowledgement: "R4_MIGRATE_STATE_V3" }, { isIgnoredPath: () => false }), /ignored/);
  for (const [field, value, pattern] of [
    ["program", BUFFER, /program/],
    ["buffer", PROGRAM, /buffer address/],
    ["authority", PROGRAM, /authority/],
    ["owner", PROGRAM, /owner/],
    ["allocation", 1, /allocation/],
    ["binaryLength", 1, /binary length/],
    ["binarySha256", "0".repeat(64), /binary hash/],
  ]) {
    assert.throws(
      () => migrateStateV3({ ...input, expected: { ...input.expected, [field]: value }, acknowledgement: "R4_MIGRATE_STATE_V3" }, { isIgnoredPath: () => true }),
      pattern,
    );
  }
});

test("post-write validation failure rolls back atomically and preserves the backup", () => {
  const input = fixture();
  const originalHash = hash(input.statePath);
  let backupPath;
  assert.throws(() => migrateStateV3({ ...input, acknowledgement: "R4_MIGRATE_STATE_V3" }, {
    isIgnoredPath: () => true,
    timestamp: () => "2026-07-19T00-00-00Z",
    saveStateAtomic(path, state) {
      saveStateAtomic(path, state);
      const corrupted = JSON.parse(readFileSync(path, "utf8"));
      corrupted.deployment.buffer.planFingerprint = "corrupted";
      saveStateAtomic(path, corrupted);
    },
    onBackup(path) { backupPath = path; },
  }), /post-write validation failed/);
  assert.equal(hash(input.statePath), originalHash);
  assert.equal(existsSync(backupPath), true);
});
