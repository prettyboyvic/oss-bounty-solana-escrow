import {
  existsSync,
  realpathSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { PublicKey } from "@solana/web3.js";

export const DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const DEVNET_GENESIS_HASH =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const CLASSIC_TOKEN_PROGRAM_ID =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function assertExactKeys(value, expected, label) {
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!expected.includes(key)) {
      throw new Error(`unexpected config key "${key}" in ${label}`);
    }
  }
  for (const key of expected) {
    if (!(key in value)) {
      throw new Error(`missing config key "${key}" in ${label}`);
    }
  }
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

export function assertAllowedRpcUrl(value, mode = "devnet") {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("an explicit Solana devnet RPC URL is required");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error("an explicit Solana devnet RPC URL is required");
  }

  if (mode === "local-test") {
    const isLoopback =
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if (!isLoopback) {
      throw new Error("local-test mode requires an explicit loopback RPC URL");
    }
    return url;
  }

  if (
    mode !== "devnet" ||
    url.protocol !== "https:" ||
    url.hostname !== "api.devnet.solana.com" ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("an explicit Solana devnet RPC URL is required");
  }

  return url;
}

export function assertDevnetGenesis(actual, expected = DEVNET_GENESIS_HASH) {
  if (actual !== expected) {
    throw new Error(
      `devnet genesis hash mismatch: expected ${expected}, received ${actual}`,
    );
  }
}

export function assertClassicTokenProgram(programId) {
  if (programId !== CLASSIC_TOKEN_PROGRAM_ID) {
    throw new Error(
      `expected classic SPL Token Program ${CLASSIC_TOKEN_PROGRAM_ID}`,
    );
  }
}

export function validatePublicConfig(value) {
  assertObject(value, "public config");
  assertExactKeys(
    value,
    ["schemaVersion", "cluster", "programId", "token"],
    "public config",
  );
  if (value.schemaVersion !== 1) {
    throw new Error("public config schemaVersion must be 1");
  }

  assertObject(value.cluster, "cluster");
  assertExactKeys(
    value.cluster,
    ["name", "rpcUrl", "genesisHash"],
    "cluster",
  );
  if (value.cluster.name !== "devnet") {
    throw new Error("cluster name must be devnet");
  }
  assertAllowedRpcUrl(value.cluster.rpcUrl, "devnet");
  assertDevnetGenesis(value.cluster.genesisHash);

  try {
    new PublicKey(value.programId);
  } catch {
    throw new Error("programId must be a valid Solana public key");
  }

  assertObject(value.token, "token");
  assertExactKeys(
    value.token,
    ["programId", "displayLabel", "decimals"],
    "token",
  );
  assertClassicTokenProgram(value.token.programId);
  if (value.token.displayLabel !== "DEVTEST") {
    throw new Error("test token display label must be DEVTEST");
  }
  if (value.token.decimals !== 6) {
    throw new Error("DEVTEST must use six decimals");
  }

  return structuredClone(value);
}

function isOutside(base, candidate) {
  const rel = relative(base, candidate);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

function nearestExistingParent(path) {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`no existing parent for signer path ${path}`);
    }
    current = parent;
  }
  return current;
}

export function assertSignerPathContained(repoRoot, candidate) {
  const root = resolve(repoRoot);
  const devnet = join(root, ".devnet");
  const resolved = resolve(candidate);

  if (isOutside(devnet, resolved)) {
    throw new Error("signer path must remain inside .devnet");
  }

  if (existsSync(devnet)) {
    const realDevnet = realpathSync(devnet);
    const existingParent = nearestExistingParent(dirname(resolved));
    const realParent = realpathSync(existingParent);
    if (isOutside(realDevnet, realParent)) {
      throw new Error("signer path symlink escapes .devnet");
    }
  }

  return resolved;
}

const SECRET_KEYS = new Set([
  "apikey",
  "authorization",
  "credential",
  "mnemonic",
  "passphrase",
  "privatekey",
  "secret",
  "secretkey",
  "seed",
  "seedphrase",
]);

export function sanitizePublicOutput(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizePublicOutput);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_KEYS.has(key.toLowerCase()))
      .map(([key, item]) => [key, sanitizePublicOutput(item)]),
  );
}
