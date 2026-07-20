import { resolve } from "node:path";

import { assertAllowedRpcUrl, DEVNET_RPC_URL } from "./safety.mjs";
import { PLAN_UPLOAD_IDENTITIES } from "./plan-upload-command.mjs";
import { isSafeRpcRequestSummary } from "./rpc-request-ledger.mjs";

export const LIVE_UPLOAD_ACKNOWLEDGEMENT = "R4_BUFFER_UPLOAD";
export const RELEASE_LEASE_ACKNOWLEDGEMENT = "R4_RELEASE_UPLOAD_LEASE";
export const APPLY_RECONCILIATION_ACKNOWLEDGEMENT = "R4_APPLY_UPLOAD_RECONCILIATION";
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
const RECONCILE_KEYS = new Set(["url", "program", "buffer", "state", "binary", "execution-id"]);
const APPLY_RECONCILIATION_KEYS = new Set([...RECONCILE_KEYS, "reconciliation-hash", "acknowledge-upload-reconciliation"]);
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
  assertAllowedRpcUrl(values.url, "devnet");
  if (values.url !== DEVNET_RPC_URL) throw new Error("exact devnet RPC is required");
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
  assertAllowedRpcUrl(values.url, "devnet");
  if (values.url !== DEVNET_RPC_URL) throw new Error("exact devnet RPC is required");
  if (values.program !== PLAN_UPLOAD_IDENTITIES.program) throw new Error("canonical program is required");
  if (values.buffer !== PLAN_UPLOAD_IDENTITIES.buffer) throw new Error("preserved buffer is required");
}

function assertSafeExecutionId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new Error("safe execution ID is required");
  }
}

function assertLowercaseReconciliationHash(value) {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("lowercase reconciliation hash is required");
  }
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
      assertSafeExecutionId(values["execution-id"]);
      return { command: argv[0], url: values.url, program: values.program, buffer: values.buffer, state: values.state, binary: values.binary, executionId: values["execution-id"] };
    }
    case "apply-upload-reconciliation": {
      const values = parseExactOptions(argv, APPLY_RECONCILIATION_KEYS);
      assertCanonicalLeaseCommand(values);
      assertSafeExecutionId(values["execution-id"]);
      assertLowercaseReconciliationHash(values["reconciliation-hash"]);
      if (values["acknowledge-upload-reconciliation"] !== APPLY_RECONCILIATION_ACKNOWLEDGEMENT) {
        throw new Error("explicit upload-reconciliation acknowledgement is required");
      }
      return {
        command: argv[0],
        url: values.url,
        program: values.program,
        buffer: values.buffer,
        state: values.state,
        binary: values.binary,
        executionId: values["execution-id"],
        reconciliationHash: values["reconciliation-hash"],
        acknowledgement: values["acknowledge-upload-reconciliation"],
      };
    }
    case "release-upload-lease": {
      const values = parseExactOptions(argv, RELEASE_KEYS);
      assertCanonicalLeaseCommand(values);
      assertSafeExecutionId(values["execution-id"]);
      assertLowercaseReconciliationHash(values["reconciliation-hash"]);
      if (values["acknowledge-lease-release"] !== RELEASE_LEASE_ACKNOWLEDGEMENT) throw new Error("explicit lease-release acknowledgement is required");
      return {
        command: argv[0],
        url: values.url,
        program: values.program,
        buffer: values.buffer,
        state: values.state,
        binary: values.binary,
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

const SECRET_KEYS = new Set([
  "authorization", "body", "cookie", "credential", "data", "endpoint", "error", "header", "headers",
  "keypair", "mnemonic", "path", "payload", "privatekey", "rawtransaction", "requestid", "response",
  "secret", "secretkey", "seed", "seedphrase", "serializedtransaction", "signedtransaction", "url",
]);
const SECRET_KEY_SUFFIX = /(?:authorization|body|credential|headers?|keypair|path|requestid|url)$/;
const SECRET_TEXT = /(?:https?|wss?):\/\/|[A-Za-z]:[\\/]|^\\\\|^\/\S|^~[\\/]|(?:^|[\\/])\.devnet(?:[\\/]|$)|(?:^|[\\/])\.config[\\/]solana(?:[\\/]|$)|(?:^|[\\/])[^\\/]*keypair[^\\/]*\.json$|mnemonic|private[-_ ]?key|secret[-_ ]?key|seed[-_ ]?phrase|signed[-_ ]?transaction|raw[-_ ]?transaction/i;
const MNEMONIC_LIKE_TEXT = /^(?:[a-z]+[\s,]+){11,}[a-z]+$/i;
const UPLOAD_RESULT_KEYS = [
  "command", "confirmedIndexes", "executionId", "leaseLifecycle", "liveWriteAttempted",
  "liveWriteExecuted", "processed", "sent", "skippedIndexes", "stateMutation", "status",
];
const UPLOAD_RESULT_STATUSES = new Set(["COMPLETE", "WINDOW_LIMIT", "RATE_LIMITED", "CONFIRMED_FAILURE", "UNKNOWN"]);

function isSecretKey(key) {
  const normalized = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return SECRET_KEYS.has(normalized) || SECRET_KEY_SUFFIX.test(normalized);
}

function isStrictPublicIndexArray(value) {
  return Array.isArray(value) && value.every((item, index) =>
    Number.isSafeInteger(item) && item >= 0 && (index === 0 || item > value[index - 1]),
  );
}

function allowedPublicIndexArrays(value) {
  const allowed = new WeakSet();
  const expectedKeys = value?.rpcRequestSummary === undefined
    ? UPLOAD_RESULT_KEYS
    : [...UPLOAD_RESULT_KEYS, "rpcRequestSummary"];
  if (Object.keys(value).sort().join("\0") !== [...expectedKeys].sort().join("\0") ||
      value.command !== "upload-buffer-throttled" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.executionId ?? "") ||
      !UPLOAD_RESULT_STATUSES.has(value.status) ||
      value.leaseLifecycle !== "RECONCILIATION_REQUIRED" || value.stateMutation !== true ||
      typeof value.liveWriteAttempted !== "boolean" ||
      (typeof value.liveWriteExecuted !== "boolean" && value.liveWriteExecuted !== null) ||
      !Number.isSafeInteger(value.processed) || value.processed < 0 || value.processed > MAX_UPLOAD_CHUNKS ||
      value.sent !== value.processed ||
      !isStrictPublicIndexArray(value.confirmedIndexes) || value.confirmedIndexes.length !== value.sent ||
      !isStrictPublicIndexArray(value.skippedIndexes) ||
      new Set([...value.confirmedIndexes, ...value.skippedIndexes]).size !== value.confirmedIndexes.length + value.skippedIndexes.length ||
      (value.rpcRequestSummary !== undefined && !isSafeRpcRequestSummary(value.rpcRequestSummary))) {
    return allowed;
  }
  allowed.add(value.confirmedIndexes);
  allowed.add(value.skippedIndexes);
  return allowed;
}

function assertSafeOutput(value, allowedIndexArrays, path = "output") {
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    throw new Error("secret-bearing output is forbidden");
  }
  if (Array.isArray(value)) {
    if (allowedIndexArrays.has(value)) return;
    if (value.length >= 16 && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
      throw new Error("secret-bearing output is forbidden");
    }
    value.forEach((item, index) => assertSafeOutput(item, allowedIndexArrays, `${path}[${index}]`));
    return;
  }
  if (typeof value === "string") {
    if (SECRET_TEXT.test(value) || MNEMONIC_LIKE_TEXT.test(value) || (/^[A-Za-z0-9+/]{80,}={0,2}$/.test(value) && /[+/=]/.test(value))) {
      throw new Error("secret-bearing output is forbidden");
    }
    return;
  }
  if (value === null || ["number", "boolean"].includes(typeof value)) return;
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("secret-bearing output is forbidden");
  }
  for (const [key, item] of Object.entries(value)) {
    if (isSecretKey(key)) throw new Error("secret-bearing output is forbidden");
    assertSafeOutput(item, allowedIndexArrays, `${path}.${key}`);
  }
}

export function sanitizeExecutionOutput(value) {
  if (value === null || Array.isArray(value) || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("secret-bearing output is forbidden");
  }
  assertSafeOutput(value, allowedPublicIndexArrays(value));
  return structuredClone(value);
}
