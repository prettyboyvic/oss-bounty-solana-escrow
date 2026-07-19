import { createHash } from "node:crypto";
import {
  copyFileSync,
  readFileSync,
  renameSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { PublicKey } from "@solana/web3.js";

import { MIGRATE_STATE_ACKNOWLEDGEMENT } from "./upload-execution-contract.mjs";
import {
  backupState,
  migrateState,
  saveStateAtomic,
  validateChunkRecords,
} from "./state.mjs";
import { createPlanFingerprint } from "./throttled-uploader.mjs";
import { planBufferUpload } from "./upload-plan.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readInputs({ statePath, binaryPath }) {
  let state;
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    throw new Error("state file is invalid");
  }
  const binary = readFileSync(binaryPath);
  return { state, binary };
}

function assertCheckpoint(state, binary, expected) {
  const buffer = state?.deployment?.buffer;
  const checks = [
    [state?.identities?.program, expected.program, "program ID"],
    [buffer?.publicKey, expected.buffer, "buffer address"],
    [buffer?.expectedAuthority, expected.authority, "buffer authority"],
    [buffer?.expectedOwner, expected.owner, "buffer owner"],
    [buffer?.allocatedLength, expected.allocation, "buffer allocation"],
    [buffer?.localBinary?.length, expected.binaryLength, "binary length"],
    [buffer?.localBinary?.sha256, expected.binarySha256, "binary hash"],
    [binary.length, expected.binaryLength, "binary length"],
    [sha256(binary), expected.binarySha256, "binary hash"],
  ];
  for (const [actual, wanted, label] of checks) {
    if (actual !== wanted) throw new Error(`${label} mismatch`);
  }
  if (expected.allocation !== expected.binaryLength + 37) {
    throw new Error("buffer allocation mismatch");
  }
}

export function validateUploadStateV3(state, expected) {
  return validateStoredCheckpoint(state, expected);
}

function validateStoredCheckpoint(state, expected) {
  if (state?.schemaVersion !== 3) throw new Error("uploader state schema must be v3");
  const buffer = state?.deployment?.buffer;
  const checks = [
    [state?.identities?.program, expected.program, "program ID"],
    [buffer?.publicKey, expected.buffer, "buffer address"],
    [buffer?.expectedAuthority, expected.authority, "buffer authority"],
    [buffer?.expectedOwner, expected.owner, "buffer owner"],
    [buffer?.allocatedLength, expected.allocation, "buffer allocation"],
    [buffer?.localBinary?.length, expected.binaryLength, "binary length"],
    [buffer?.localBinary?.sha256, expected.binarySha256, "binary hash"],
  ];
  for (const [actual, wanted, label] of checks) {
    if (actual !== wanted) throw new Error(`${label} mismatch`);
  }
  if (!Array.isArray(buffer.uploadWindows)) throw new Error("upload windows are required");
  validateChunkRecords(buffer.chunks);
  if (buffer.chunks.reduce((total, chunk) => total + chunk.length, 0) !== expected.binaryLength) {
    throw new Error("chunk coverage mismatch");
  }
  if (!/^[a-f0-9]{64}$/i.test(buffer.planFingerprint ?? "")) throw new Error("plan fingerprint is invalid");
  return true;
}

export function inspectStateMigration(input) {
  const { state, binary } = readInputs(input);
  assertCheckpoint(state, binary, input.expected);
  if (![2, 3].includes(state.schemaVersion)) throw new Error("state schema must be v2 or v3");
  return {
    command: "inspect-state-migration",
    currentSchemaVersion: state.schemaVersion,
    targetSchemaVersion: 3,
    migrationRequired: state.schemaVersion === 2,
    additions: state.schemaVersion === 2
      ? ["deployment.buffer.chunks", "deployment.buffer.planFingerprint", "deployment.buffer.uploadWindows"]
      : [],
    stateMutation: false,
  };
}

function migratedUploadState(state, binary, expected) {
  const migrated = migrateState(state);
  const plan = planBufferUpload({
    localBytes: binary,
    bufferBytes: Buffer.alloc(binary.length),
    buffer: new PublicKey(expected.buffer),
    authority: new PublicKey(expected.authority),
  });
  const records = plan.chunks.map(({ index, offset, length, sha256: chunkSha256 }) => ({
    index,
    offset,
    length,
    sha256: chunkSha256,
    status: "PLANNED",
    signature: null,
  }));
  migrated.deployment.buffer.chunks = records;
  migrated.deployment.buffer.uploadWindows = [];
  migrated.deployment.buffer.planFingerprint = createPlanFingerprint({
    program: expected.program,
    buffer: expected.buffer,
    authority: expected.authority,
    allocation: expected.allocation,
    binarySha256: expected.binarySha256,
    maxPayload: plan.maxPayload,
    chunks: records,
  });
  return migrated;
}

function restoreBackup(backupPath, statePath) {
  const temporary = `${statePath}.rollback.tmp`;
  copyFileSync(backupPath, temporary);
  renameSync(temporary, statePath);
}

export function migrateStateV3(input, adapters = {}) {
  if (input.acknowledgement !== MIGRATE_STATE_ACKNOWLEDGEMENT) {
    throw new Error("explicit state-migration acknowledgement is required");
  }
  if (typeof adapters.isIgnoredPath !== "function" || !adapters.isIgnoredPath(input.statePath)) {
    throw new Error("state path must be explicitly ignored");
  }
  const { state, binary } = readInputs(input);
  assertCheckpoint(state, binary, input.expected);
  if (state.schemaVersion === 3) {
    validateStoredCheckpoint(state, input.expected);
    return { command: "migrate-state-v3", status: "ALREADY_V3", backupCreated: false, stateMutation: false };
  }
  if (state.schemaVersion !== 2) throw new Error("state schema must be v2 or v3");

  const migrated = migratedUploadState(state, binary, input.expected);
  const timestamp = (adapters.timestamp ?? (() => new Date().toISOString().replace(/[:.]/g, "-")))();
  const historyDir = join(dirname(input.statePath), "history");
  const backupPath = backupState(input.statePath, historyDir, timestamp);
  adapters.onBackup?.(backupPath);
  const save = adapters.saveStateAtomic ?? saveStateAtomic;
  try {
    save(input.statePath, migrated);
    const reread = JSON.parse(readFileSync(input.statePath, "utf8"));
    validateStoredCheckpoint(reread, input.expected);
  } catch (error) {
    restoreBackup(backupPath, input.statePath);
    throw new Error(`post-write validation failed; original state restored: ${error.message}`);
  }
  return { command: "migrate-state-v3", status: "MIGRATED", backupCreated: true, stateMutation: true };
}
