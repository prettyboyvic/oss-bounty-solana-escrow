import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseRuntimeCommand,
  sanitizeExecutionOutput,
  validateUploadRequest,
} from "./upload-execution-contract.mjs";
import { PLAN_UPLOAD_IDENTITIES, createPlanUploadConnection } from "./plan-upload-command.mjs";
import { inspectStateMigration, migrateStateV3 } from "./state-migration-command.mjs";
import {
  applyUploadReconciliation,
  reconcileUploadLease,
  releaseUploadLease,
} from "./upload-execution-lease.mjs";
import {
  collectLeaseReconciliationInput,
  createProductionUploadDependencies,
  executeUploadWindow,
} from "./upload-execution-command.mjs";

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const RATE_LIMITED_ERROR = Object.freeze({ code: "RPC_RATE_LIMITED", retryable: false, terminal: true });
const SAFE_COMMAND_ERROR = Object.freeze({ code: "COMMAND_FAILED_SAFE", retryable: false, terminal: true });
const RATE_LIMIT_TEXT = /\b429\s+too many requests\b|\btoo many requests\b|\brate[-_ ]limit(?:ed|ing| exceeded| response)\b/i;
const RATE_LIMIT_JSON = /["']?(?:code|status|statusCode|httpStatus)["']?\s*:\s*429\b/i;
const NEGATED_RATE_LIMIT = /\bnot\s+rate[-_ ]limited\b/i;
const RATE_LIMIT_NUMBER_KEYS = /^(?:code|status|statusCode|httpStatus)$/i;
const INSPECT_ERROR_KEYS = ["message", "code", "status", "statusCode", "httpStatus", "data", "body", "response", "error", "cause"];

function containsRateLimit(value, seen = new WeakSet(), key = "", depth = 0) {
  if (typeof value === "string") {
    if (NEGATED_RATE_LIMIT.test(value)) return false;
    return RATE_LIMIT_TEXT.test(value) || RATE_LIMIT_JSON.test(value);
  }
  if (typeof value === "number") return value === 429 && RATE_LIMIT_NUMBER_KEYS.test(key);
  if (value === null || (typeof value !== "object" && typeof value !== "function") || depth > 8) return false;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || seen.has(value)) return false;
  seen.add(value);
  let enumerableKeys = [];
  try {
    enumerableKeys = Object.keys(value);
  } catch {
    // Continue with the known error-shape keys.
  }
  for (const property of new Set([...INSPECT_ERROR_KEYS, ...enumerableKeys])) {
    if (property === "stack") continue;
    let item;
    try {
      item = value[property];
    } catch {
      continue;
    }
    if (containsRateLimit(item, seen, property, depth + 1)) return true;
  }
  return false;
}

export function sanitizeCliErrorMessage(error) {
  return containsRateLimit(error) ? RATE_LIMITED_ERROR : SAFE_COMMAND_ERROR;
}

function defaultIgnoredPath(path) {
  const result = spawnSync("git", ["check-ignore", "--quiet", "--", path], {
    cwd: DEFAULT_REPO_ROOT,
    windowsHide: true,
  });
  return result.status === 0;
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const parsed = parseRuntimeCommand(argv);
  const repoRoot = dependencies.repoRoot ?? DEFAULT_REPO_ROOT;
  const isIgnoredPath = dependencies.isIgnoredPath ?? defaultIgnoredPath;
  if (parsed.command === "upload-buffer-throttled") {
    const request = {
      ...validateUploadRequest(parsed, { repoRoot, isIgnoredPath }),
      binaryPath: resolve(repoRoot, "target", "sbf-solana-solana", "release", "oss_bounty_escrow.so"),
    };
    const execute = dependencies.executeUploadWindow ?? executeUploadWindow;
    const runtime = dependencies.executionDependencies ?? createProductionUploadDependencies(parsed.url);
    return sanitizeExecutionOutput(await execute(request, runtime));
  }
  const statePath = resolve(repoRoot, parsed.state);
  if (!isIgnoredPath(statePath)) throw new Error("state path must be explicitly ignored");
  if (parsed.command === "inspect-state-migration" || parsed.command === "migrate-state-v3") {
    const binaryPath = resolve(repoRoot, parsed.binary);
    const injectedHandler = parsed.command === "inspect-state-migration"
      ? dependencies.inspectStateMigration
      : dependencies.migrateStateV3;
    if (injectedHandler) return sanitizeExecutionOutput(await injectedHandler({ ...parsed, statePath, binaryPath }));
    const binary = readFileSync(binaryPath);
    const expected = {
      program: PLAN_UPLOAD_IDENTITIES.program,
      buffer: PLAN_UPLOAD_IDENTITIES.buffer,
      authority: PLAN_UPLOAD_IDENTITIES.authority,
      owner: PLAN_UPLOAD_IDENTITIES.loader,
      allocation: binary.length + 37,
      binaryLength: binary.length,
      binarySha256: createHash("sha256").update(binary).digest("hex"),
    };
    const request = { ...parsed, statePath, binaryPath, expected };
    const handler = parsed.command === "inspect-state-migration"
      ? inspectStateMigration
      : ((value) => migrateStateV3(value, { isIgnoredPath }));
    return sanitizeExecutionOutput(await handler(request));
  }
  const binaryPath = resolve(repoRoot, parsed.binary);
  const request = { ...parsed, statePath, binaryPath };
  const handlerProperty = {
    "reconcile-upload-lease": "reconcileUploadLease",
    "apply-upload-reconciliation": "applyUploadReconciliation",
    "release-upload-lease": "releaseUploadLease",
  }[parsed.command];
  const injectedHandler = dependencies[handlerProperty];
  if (injectedHandler) return sanitizeExecutionOutput(await injectedHandler(request));
  const rpc = createPlanUploadConnection(parsed.url);
  const reconciliationInput = await collectLeaseReconciliationInput(request, { rpc });
  const result = {
    "reconcile-upload-lease": () => reconcileUploadLease(reconciliationInput),
    "apply-upload-reconciliation": () => applyUploadReconciliation({ ...reconciliationInput, reconciliationHash: parsed.reconciliationHash, acknowledgement: parsed.acknowledgement }),
    "release-upload-lease": () => releaseUploadLease({ ...reconciliationInput, reconciliationHash: parsed.reconciliationHash, acknowledgement: parsed.acknowledgement }),
  }[parsed.command]();
  return sanitizeExecutionOutput(result);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const report = await main();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(sanitizeCliErrorMessage(error))}\n`);
    process.exitCode = 1;
  }
}
