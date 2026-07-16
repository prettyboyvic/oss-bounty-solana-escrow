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
    schemaVersion: 1,
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
    deployment: {},
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
  if (value.schemaVersion > 1) {
    throw new Error(
      `future state schemaVersion ${value.schemaVersion} is not supported`,
    );
  }
  if (value.schemaVersion !== 1) {
    throw new Error(`state schemaVersion ${value.schemaVersion} is unsupported`);
  }
  assertNoSecretMaterial(value);
  return structuredClone(value);
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
  const state = loadState(path);
  mkdirSync(historyDir, { recursive: true });
  const backup = join(
    historyDir,
    `state-v${state.schemaVersion}-${timestamp}.json`,
  );
  copyFileSync(path, backup);
  return backup;
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
