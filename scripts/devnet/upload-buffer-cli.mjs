import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseRuntimeCommand,
  sanitizeExecutionOutput,
  validateUploadRequest,
} from "./upload-execution-contract.mjs";
import { PLAN_UPLOAD_IDENTITIES, createPlanUploadConnection } from "./plan-upload-command.mjs";
import { inspectStateMigration, migrateStateV3 } from "./state-migration-command.mjs";
import { RPC_METHOD_CLASSES, RPC_OUTCOMES } from "./rpc-request-ledger.mjs";
import { createRpcRequestScheduler } from "./rpc-request-scheduler.mjs";
import { inspectRetainedUploadProcessesProduction } from "./upload-process-classifier.mjs";
import {
  applyUploadReconciliation,
  reconcilePreSelectionUploadLease,
  reconcileUploadLease,
  recoverPreSelectionUploadLease,
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
const SAFE_RPC_METHOD_CLASSES = new Set(RPC_METHOD_CLASSES);
const SAFE_RPC_OUTCOMES = new Set(RPC_OUTCOMES.filter((outcome) => outcome !== "SUCCESS"));
const SAFE_POST_LEASE_CODES = new Set([
  "SIGNER_PREPARATION_FAILED",
  "TELEMETRY_INITIALIZATION_FAILED",
  "TELEMETRY_PERSISTENCE_FAILED",
  "TELEMETRY_REPLAY_VALIDATION_FAILED",
  "TELEMETRY_SUBSCRIBER_SETUP_FAILED",
  "TERMINALIZATION_FAILED",
  "UPLOAD_EXECUTION_FAILED",
]);
const SAFE_POST_LEASE_PHASES = new Set([
  "SIGNER_PREPARATION",
  "SUBSCRIBER_SETUP",
  "TELEMETRY_INITIALIZATION",
  "TELEMETRY_REPLAY",
  "TERMINALIZATION",
  "UPLOAD_EXECUTION",
]);

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
  if (SAFE_POST_LEASE_CODES.has(error?.safeCode) &&
      SAFE_POST_LEASE_PHASES.has(error?.safePhase)) {
    return {
      code: error.safeCode,
      phase: error.safePhase,
      retryable: false,
      terminal: true,
    };
  }
  if (
    SAFE_RPC_OUTCOMES.has(error?.classification) &&
    SAFE_RPC_METHOD_CLASSES.has(error?.methodClass) &&
    Number.isSafeInteger(error?.sequence) && error.sequence > 0 &&
    typeof error?.signaturePersisted === "boolean"
  ) {
    return {
      classification: error.classification,
      methodClass: error.methodClass,
      sequence: error.sequence,
      signaturePersisted: error.signaturePersisted,
    };
  }
  return containsRateLimit(error) ? RATE_LIMITED_ERROR : SAFE_COMMAND_ERROR;
}

function defaultIgnoredPath(path) {
  const result = spawnSync("git", ["check-ignore", "--quiet", "--", path], {
    cwd: DEFAULT_REPO_ROOT,
    windowsHide: true,
  });
  return result.status === 0;
}

function runGitValue(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0 || result.signal !== null) {
    throw new Error("repository identity inspection failed");
  }
  return result.stdout.trim();
}

export function collectRecoveryRepositorySha(repoRoot, expectedSha) {
  const head = runGitValue(repoRoot, ["rev-parse", "HEAD"]);
  const originMain = runGitValue(repoRoot, ["rev-parse", "origin/main"]);
  const status = runGitValue(repoRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  const aheadBehind = runGitValue(repoRoot, [
    "rev-list",
    "--left-right",
    "--count",
    "HEAD...origin/main",
  ]);
  if (head !== expectedSha || originMain !== expectedSha ||
      status !== "" || aheadBehind !== "0\t0") {
    throw new Error("repository recovery binding mismatch");
  }
  return head;
}

// Establishes whether the historical incident repository SHA is a Git ancestor
// of the live recovery SHA. `git merge-base --is-ancestor A B` exits 0 when A
// is an ancestor of (or equal to) B, 1 when it is not, and non-{0,1} on any
// other error (for example an unknown object). Anything but a clean 0/1 result
// fails closed rather than being interpreted as "not an ancestor".
export function collectIncidentRepositoryAncestry(repoRoot, incidentSha, liveSha) {
  if (!/^[a-f0-9]{40}$/.test(incidentSha) || !/^[a-f0-9]{40}$/.test(liveSha)) {
    throw new Error("repository recovery binding mismatch");
  }
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", incidentSha, liveSha],
    { cwd: repoRoot, windowsHide: true, shell: false },
  );
  if (result.error || result.signal !== null ||
      (result.status !== 0 && result.status !== 1)) {
    throw new Error("repository ancestry inspection failed");
  }
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
    const runtime = dependencies.executionDependencies ?? createProductionUploadDependencies(parsed.url, {
      requestTimeoutMs: parsed.requestTimeoutMs,
    });
    try {
      return sanitizeExecutionOutput(await execute(request, runtime));
    } catch (error) {
      if (runtime.rpcRequestScheduler) await runtime.rpcRequestScheduler.abort(error);
      throw error;
    } finally {
      if (runtime.rpcRequestScheduler) await runtime.rpcRequestScheduler.close();
    }
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
  const preSelectionCommand = parsed.command === "reconcile-pre-selection-upload-lease" ||
    parsed.command === "recover-pre-selection-upload-lease";
  if (preSelectionCommand &&
      (!isIgnoredPath(resolve(repoRoot, parsed.leasePath)) ||
       !isIgnoredPath(resolve(repoRoot, parsed.outerEvidenceDirectory)))) {
    throw new Error("lease and outer evidence paths must be explicitly ignored");
  }
  const request = preSelectionCommand
    ? {
        ...parsed,
        statePath,
        binaryPath,
        outerEvidenceDirectory: resolve(repoRoot, parsed.outerEvidenceDirectory),
        expected: {
          ...parsed.expected,
          leasePath: resolve(repoRoot, parsed.leasePath),
        },
      }
    : { ...parsed, statePath, binaryPath };
  const handlerProperty = {
    "reconcile-upload-lease": "reconcileUploadLease",
    "apply-upload-reconciliation": "applyUploadReconciliation",
    "release-upload-lease": "releaseUploadLease",
    "reconcile-pre-selection-upload-lease": "reconcilePreSelectionUploadLease",
    "recover-pre-selection-upload-lease": "recoverPreSelectionUploadLease",
  }[parsed.command];
  const injectedHandler = dependencies[handlerProperty];
  if (injectedHandler) return sanitizeExecutionOutput(await injectedHandler(request));
  const rpc = createPlanUploadConnection(parsed.url);
  const rpcRequestScheduler = createRpcRequestScheduler();
  try {
    const reconciliationInput = await collectLeaseReconciliationInput(
      preSelectionCommand
        ? { ...request, executionId: request.expected.innerExecutionId }
        : request,
      { rpc, rpcRequestScheduler },
    );
    let result;
    if (preSelectionCommand) {
      const repositorySha = collectRecoveryRepositorySha(
        repoRoot,
        request.expected.repositorySha,
      );
      const incidentRepositoryIsAncestor = collectIncidentRepositoryAncestry(
        repoRoot,
        request.expected.incidentRepositorySha,
        repositorySha,
      );
      const inspection = await inspectRetainedUploadProcessesProduction({
        repoRoot,
        currentPid: process.pid,
        statePath,
        stateArgument: parsed.state,
        program: parsed.program,
        buffer: parsed.buffer,
      });
      const recoveryInput = {
        ...request,
        observations: {
          repositorySha,
          incidentRepositoryIsAncestor,
          bufferDataSha256: reconciliationInput.observations.bufferDataSha256,
          programAbsent: reconciliationInput.observations.programAbsent,
          confirmedChunksMatch:
            reconciliationInput.observations.confirmedChunksMatch,
          buffer: {
            address: reconciliationInput.observations.buffer.address,
            owner: reconciliationInput.observations.buffer.owner,
            authority: reconciliationInput.observations.buffer.authority,
            allocation: reconciliationInput.observations.buffer.allocation,
          },
          retainedProcessesClear:
            inspection.conflicts.length === 0 &&
            inspection.diagnostics.length === 0,
          operationLockAbsent:
            !existsSync(`${statePath}.upload-lease-operation-lock`),
        },
      };
      if (parsed.command === "reconcile-pre-selection-upload-lease") {
        result = reconcilePreSelectionUploadLease(recoveryInput);
      } else {
        result = await recoverPreSelectionUploadLease(recoveryInput, {
          async refreshInput(lockedInput) {
            const freshReconciliationInput = await collectLeaseReconciliationInput(
              {
                ...lockedInput,
                executionId: lockedInput.expected.innerExecutionId,
              },
              { rpc, rpcRequestScheduler },
            );
            const freshRepositorySha = collectRecoveryRepositorySha(
              repoRoot,
              lockedInput.expected.repositorySha,
            );
            const freshIncidentRepositoryIsAncestor =
              collectIncidentRepositoryAncestry(
                repoRoot,
                lockedInput.expected.incidentRepositorySha,
                freshRepositorySha,
              );
            const freshInspection =
              await inspectRetainedUploadProcessesProduction({
                repoRoot,
                currentPid: process.pid,
                statePath,
                stateArgument: parsed.state,
                program: parsed.program,
                buffer: parsed.buffer,
              });
            return {
              ...lockedInput,
              observations: {
                repositorySha: freshRepositorySha,
                incidentRepositoryIsAncestor: freshIncidentRepositoryIsAncestor,
                bufferDataSha256:
                  freshReconciliationInput.observations.bufferDataSha256,
                programAbsent:
                  freshReconciliationInput.observations.programAbsent,
                confirmedChunksMatch:
                  freshReconciliationInput.observations.confirmedChunksMatch,
                buffer: {
                  address:
                    freshReconciliationInput.observations.buffer.address,
                  owner: freshReconciliationInput.observations.buffer.owner,
                  authority:
                    freshReconciliationInput.observations.buffer.authority,
                  allocation:
                    freshReconciliationInput.observations.buffer.allocation,
                },
                retainedProcessesClear:
                  freshInspection.conflicts.length === 0 &&
                  freshInspection.diagnostics.length === 0,
                // The caller owns the exact operation lock at this boundary.
                operationLockAbsent: true,
              },
            };
          },
        });
      }
    } else {
      result = {
        "reconcile-upload-lease": () => reconcileUploadLease(reconciliationInput),
        "apply-upload-reconciliation": () => applyUploadReconciliation({ ...reconciliationInput, reconciliationHash: parsed.reconciliationHash, acknowledgement: parsed.acknowledgement }),
        "release-upload-lease": () => releaseUploadLease({ ...reconciliationInput, reconciliationHash: parsed.reconciliationHash, acknowledgement: parsed.acknowledgement }),
      }[parsed.command]();
    }
    return sanitizeExecutionOutput(result);
  } catch (error) {
    await rpcRequestScheduler.abort(error);
    throw error;
  } finally {
    await rpcRequestScheduler.close();
  }
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
