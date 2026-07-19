import { resolve } from "node:path";

import { assertAllowedRpcUrl, DEVNET_RPC_URL } from "./safety.mjs";
import { PLAN_UPLOAD_IDENTITIES } from "./plan-upload-command.mjs";

export const LIVE_UPLOAD_ACKNOWLEDGEMENT = "R4_BUFFER_UPLOAD";
export const RELEASE_LEASE_ACKNOWLEDGEMENT = "R4_RELEASE_UPLOAD_LEASE";
export const MIGRATE_STATE_ACKNOWLEDGEMENT = "R4_MIGRATE_STATE_V3";
export const MAX_UPLOAD_CHUNKS = 5;
export const MIN_UPLOAD_DELAY_MS = 1_000;

const LIVE_KEYS = new Set([
  "url",
  "program",
  "buffer",
  "state",
  "authority",
  "max-chunks",
  "delay-ms",
  "acknowledge-devnet-write",
]);
const INSPECT_KEYS = new Set(["state", "binary"]);
const MIGRATE_KEYS = new Set(["state", "binary", "acknowledge-state-migration"]);
const RECONCILE_KEYS = new Set(["url", "program", "buffer", "state", "execution-id"]);
const RELEASE_KEYS = new Set([...RECONCILE_KEYS, "reconciliation-hash", "acknowledge-lease-release"]);

function parseExactOptions(argv, allowed) {
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!flag?.startsWith("--") || index + 1 >= argv.length) {
      throw new Error("complete explicit command arguments are required");
    }
    const key = flag.slice(2);
    if (!allowed.has(key)) throw new Error(`unknown argument --${key}`);
    if (key in values) throw new Error(`duplicate argument --${key}`);
    values[key] = argv[index + 1];
  }
  for (const key of allowed) {
    if (!(key in values) || values[key] === "") {
      if (key === "acknowledge-devnet-write") throw new Error("explicit devnet-write acknowledgement is required");
      throw new Error(`required argument --${key} is missing`);
    }
  }
  return values;
}

function parseInteger(value, label, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} violates the hard policy`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} violates the hard policy`);
  }
  return parsed;
}

export function parseUploadCommand(argv) {
  if (argv[0] !== "upload-buffer-throttled") {
    throw new Error("public command is required");
  }
  const values = parseExactOptions(argv, LIVE_KEYS);
  const rpc = assertAllowedRpcUrl(values.url, "devnet");
  if (rpc.origin !== DEVNET_RPC_URL) throw new Error("exact devnet RPC is required");
  if (values.program !== PLAN_UPLOAD_IDENTITIES.program) throw new Error("canonical program is required");
  if (values.buffer !== PLAN_UPLOAD_IDENTITIES.buffer) throw new Error("preserved buffer is required");
  if (values["acknowledge-devnet-write"] !== LIVE_UPLOAD_ACKNOWLEDGEMENT) {
    throw new Error("explicit devnet-write acknowledgement is required");
  }
  return {
    command: argv[0],
    url: values.url,
    program: values.program,
    buffer: values.buffer,
    state: values.state,
    authority: values.authority,
    maxChunks: parseInteger(values["max-chunks"], "maxChunks", 1, MAX_UPLOAD_CHUNKS),
    delayMs: parseInteger(values["delay-ms"], "delayMs", MIN_UPLOAD_DELAY_MS),
    acknowledgement: values["acknowledge-devnet-write"],
  };
}

function assertCanonicalLeaseCommand(values) {
  const rpc = assertAllowedRpcUrl(values.url, "devnet");
  if (rpc.origin !== DEVNET_RPC_URL) throw new Error("exact devnet RPC is required");
  if (values.program !== PLAN_UPLOAD_IDENTITIES.program) throw new Error("canonical program is required");
  if (values.buffer !== PLAN_UPLOAD_IDENTITIES.buffer) throw new Error("preserved buffer is required");
}

export function parseRuntimeCommand(argv) {
  switch (argv[0]) {
    case "upload-buffer-throttled":
      return parseUploadCommand(argv);
    case "inspect-state-migration": {
      const values = parseExactOptions(argv, INSPECT_KEYS);
      return { command: argv[0], state: values.state, binary: values.binary };
    }
    case "migrate-state-v3": {
      const values = parseExactOptions(argv, MIGRATE_KEYS);
      if (values["acknowledge-state-migration"] !== MIGRATE_STATE_ACKNOWLEDGEMENT) {
        throw new Error("explicit state-migration acknowledgement is required");
      }
      return { command: argv[0], state: values.state, binary: values.binary, acknowledgement: values["acknowledge-state-migration"] };
    }
    case "reconcile-upload-lease": {
      const values = parseExactOptions(argv, RECONCILE_KEYS);
      assertCanonicalLeaseCommand(values);
      return { command: argv[0], url: values.url, program: values.program, buffer: values.buffer, state: values.state, executionId: values["execution-id"] };
    }
    case "release-upload-lease": {
      const values = parseExactOptions(argv, RELEASE_KEYS);
      assertCanonicalLeaseCommand(values);
      if (!/^[a-f0-9]{64}$/i.test(values["reconciliation-hash"])) throw new Error("matching reconciliation hash is required");
      if (values["acknowledge-lease-release"] !== RELEASE_LEASE_ACKNOWLEDGEMENT) throw new Error("explicit lease-release acknowledgement is required");
      return {
        command: argv[0],
        url: values.url,
        program: values.program,
        buffer: values.buffer,
        state: values.state,
        executionId: values["execution-id"],
        reconciliationHash: values["reconciliation-hash"],
        acknowledgement: values["acknowledge-lease-release"],
      };
    }
    default:
      throw new Error("approved public command is required");
  }
}

export function validateUploadRequest(parsed, { repoRoot, isIgnoredPath }) {
  if (typeof repoRoot !== "string" || typeof isIgnoredPath !== "function") {
    throw new Error("explicit repository and ignore validation are required");
  }
  const statePath = resolve(repoRoot, parsed.state);
  const authorityPath = resolve(repoRoot, parsed.authority);
  if (!isIgnoredPath(statePath) || !isIgnoredPath(authorityPath)) {
    throw new Error("state and authority paths must be explicitly ignored");
  }
  return { ...parsed, statePath, authorityPath };
}

const SECRET_KEY = /^(mnemonic|secret|secretkey|privatekey|seed|seedphrase|signedtransaction|rawtransaction|keypair)$/i;

function assertSafeOutput(value, path = "output") {
  if (Array.isArray(value)) {
    if (value.length === 64 && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
      throw new Error("secret-bearing output is forbidden");
    }
    value.forEach((item, index) => assertSafeOutput(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error("secret-bearing output is forbidden");
    assertSafeOutput(item, `${path}.${key}`);
  }
}

export function sanitizeExecutionOutput(value) {
  assertSafeOutput(value);
  return structuredClone(value);
}
