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
import { reconcileUploadLease, releaseUploadLease } from "./upload-execution-lease.mjs";
import {
  collectLeaseReconciliationInput,
  createProductionUploadDependencies,
  executeUploadWindow,
} from "./upload-execution-command.mjs";

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const UNSAFE_CLI_ERROR = /(?:https?:\/\/|[A-Za-z]:\\|(?:^|[\s"'])(?:\/[^\s"']+)+|mnemonic|private[-_ ]?key|secret|keypair|signed[-_ ]?transaction|\[(?:\s*\d+\s*,){15,})/i;

export function sanitizeCliErrorMessage(error) {
  const message = String(error?.message ?? "command failed");
  if (message.length > 200 || UNSAFE_CLI_ERROR.test(message)) return "COMMAND_FAILED_SAFE";
  return message.replace(/[\r\n\t]/g, " ");
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
  const request = { ...parsed, statePath };
  const injectedHandler = parsed.command === "reconcile-upload-lease"
    ? dependencies.reconcileUploadLease
    : dependencies.releaseUploadLease;
  if (injectedHandler) return sanitizeExecutionOutput(await injectedHandler(request));
  const rpc = createPlanUploadConnection(parsed.url);
  const reconciliationInput = await collectLeaseReconciliationInput(request, { rpc });
  const result = parsed.command === "reconcile-upload-lease"
    ? reconcileUploadLease(reconciliationInput)
    : releaseUploadLease({ ...reconciliationInput, reconciliationHash: parsed.reconciliationHash, acknowledgement: parsed.acknowledgement });
  return sanitizeExecutionOutput(result);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const report = await main();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${sanitizeCliErrorMessage(error)}\n`);
    process.exitCode = 1;
  }
}
