import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const SECRET_FIELD =
  /^(secret|secretkey|privatekey|mnemonic|seed|seedphrase|passphrase|credential)$/i;

function assertNoSecretMaterial(value, path = "state") {
  if (Array.isArray(value)) {
    if (
      value.length === 64 &&
      value.every(
        (item) =>
          Number.isInteger(item) &&
          item >= 0 &&
          item <= 255,
      )
    ) {
      throw new Error(
        `keypair-shaped byte array is forbidden in ${path}`,
      );
    }
    value.forEach((item, index) =>
      assertNoSecretMaterial(item, `${path}[${index}]`),
    );
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) {
      throw new Error(`secret material is forbidden in ${path}.${key}`);
    }
    assertNoSecretMaterial(item, `${path}.${key}`);
  }
}

export function createInitialState(publicConfig, sourceCommit) {
  return {
    schemaVersion: 2,
    runId: randomUUID(),
    cluster: structuredClone(publicConfig.cluster),
    source: {
      commit: sourceCommit,
      binary: null,
    },
    program: {
      id: publicConfig.programId,
    },
    identities: {},
    deployment: { buffer: null },
    mint: {},
    flows: {
      release: {},
      refund: {},
    },
    transactions: {},
    captures: [],
  };
}

export function migrateState(value) {
  if (!Number.isInteger(value?.schemaVersion)) {
    throw new Error("state schemaVersion is required");
  }
  if (value.schemaVersion > 2) {
    throw new Error(
      `future state schemaVersion ${value.schemaVersion} is not supported`,
    );
  }
  if (value.schemaVersion < 1) {
    throw new Error(`state schemaVersion ${value.schemaVersion} is unsupported`);
  }
  assertNoSecretMaterial(value);
  const migrated = structuredClone(value);
  if (migrated.schemaVersion === 1) {
    migrated.schemaVersion = 2;
    migrated.deployment = {
      ...(migrated.deployment ?? {}),
      buffer: migrated.deployment?.buffer ?? null,
    };
  }
  return migrated;
}

export function loadState(path) {
  return migrateState(JSON.parse(readFileSync(path, "utf8")));
}

export function saveStateAtomic(path, state) {
  assertNoSecretMaterial(state);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temporary, path);
}

export function backupState(path, historyDir, timestamp) {
  if (!existsSync(path)) {
    throw new Error(`state file does not exist: ${path}`);
  }
  const state = JSON.parse(readFileSync(path, "utf8"));
  if (!Number.isInteger(state?.schemaVersion)) {
    throw new Error("state schemaVersion is required");
  }
  assertNoSecretMaterial(state);
  mkdirSync(historyDir, { recursive: true });
  const preferredBackup = join(
    historyDir,
    `state-v${state.schemaVersion}-${timestamp}.json`,
  );
  const backup = existsSync(preferredBackup)
    ? join(
        historyDir,
        `state-v${state.schemaVersion}-${timestamp}-${randomUUID()}.json`,
      )
    : preferredBackup;
  const temporary = `${backup}.tmp`;
  copyFileSync(path, temporary);
  renameSync(temporary, backup);
  return backup;
}

export function migrateStateFile(path, historyDir, timestamp) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const migrated = migrateState(raw);
  if (raw.schemaVersion === migrated.schemaVersion) {
    return { state: migrated, backup: null };
  }
  const backup = backupState(path, historyDir, timestamp);
  saveStateAtomic(path, migrated);
  return { state: migrated, backup };
}

export function configureDeploymentBuffer(state, input) {
  const migrated = migrateState(state);
  if (
    !input?.publicKey ||
    !input.expectedOwner ||
    !input.expectedAuthority ||
    !Number.isInteger(input.allocatedLength) ||
    input.allocatedLength <= 0 ||
    !Number.isInteger(input.localBinaryLength) ||
    input.localBinaryLength <= 0 ||
    !input.localBinarySha256
  ) {
    throw new Error("complete public deployment buffer metadata is required");
  }
  migrated.deployment = migrated.deployment ?? {};
  migrated.deployment.buffer = {
    publicKey: input.publicKey,
    expectedOwner: input.expectedOwner,
    expectedAuthority: input.expectedAuthority,
    allocatedLength: input.allocatedLength,
    localBinary: {
      length: input.localBinaryLength,
      sha256: input.localBinarySha256,
    },
    creationSignature: null,
    writeAttempts: [],
    lastConfirmedProgress: null,
    status: "PLANNED",
    lastRpcError: null,
    retryEligible: true,
  };
  assertNoSecretMaterial(migrated);
  return migrated;
}

export function decideNextStep(observed) {
  switch (observed.status) {
    case "Initialized":
      return { action: "fund", replayAllowed: true };
    case "Funded":
      return { action: "settle", replayAllowed: true };
    case "Released":
    case "Refunded":
    case "Cancelled":
      return { action: "terminal", replayAllowed: false };
    default:
      throw new Error(`unknown escrow status ${observed.status}`);
  }
}
