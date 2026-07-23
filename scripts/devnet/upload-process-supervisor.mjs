import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseRuntimeCommand } from "./upload-execution-contract.mjs";

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const UPLOAD_ENTRY = resolve(REPO_ROOT, "scripts/devnet/upload-buffer-cli.mjs");

// Six paced preflight requests require five 500 ms start gaps even if every
// response is instantaneous. Three seconds is therefore a strict validation
// floor, not a recommended live-window timeout.
export const MIN_UPLOAD_PROCESS_TIMEOUT_MS = 3_000;

function parseTimeoutMs(value) {
  if (!/^[1-9]\d*$/.test(value ?? "")) {
    throw new Error("explicit upload process timeout in milliseconds is required");
  }
  const timeoutMs = Number(value);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_UPLOAD_PROCESS_TIMEOUT_MS ||
    timeoutMs > MAX_TIMER_DELAY_MS
  ) {
    throw new Error(
      `upload process timeout must be ${MIN_UPLOAD_PROCESS_TIMEOUT_MS}..${MAX_TIMER_DELAY_MS} milliseconds`,
    );
  }
  return timeoutMs;
}

export function parseUploadProcessSupervisorArgs(argv) {
  if (
    !Array.isArray(argv) ||
    argv.length < 4 ||
    argv[0] !== "--timeout-ms" ||
    argv[2] !== "--"
  ) {
    throw new Error(
      "usage: upload-process-supervisor --timeout-ms <milliseconds> -- upload-buffer-throttled ...",
    );
  }
  const timeoutMs = parseTimeoutMs(argv[1]);
  const uploaderArgs = argv.slice(3);
  const parsedUploader = parseRuntimeCommand(uploaderArgs);
  if (parsedUploader.command !== "upload-buffer-throttled") {
    throw new Error("upload process supervisor accepts only upload-buffer-throttled");
  }
  return Object.freeze({
    timeoutMs,
    uploaderArgs: Object.freeze([...uploaderArgs]),
    statePath: parsedUploader.state,
  });
}

function terminateWindowsProcessTree(pid) {
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
    timeout: 5_000,
  });
}

function signalPosixProcessTree(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

export function runOwnedProcess({
  command,
  args,
  timeoutMs,
  cwd = process.cwd(),
  stdio = "ignore",
  onSpawn = () => {},
}) {
  if (
    typeof command !== "string" ||
    command.length === 0 ||
    !Array.isArray(args) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMER_DELAY_MS ||
    typeof onSpawn !== "function"
  ) {
    throw new Error("valid owned process parameters are required");
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio,
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let timedOut = false;
    let settled = false;
    let forceKillTimer = null;

    const timeout = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32") {
        terminateWindowsProcessTree(child.pid);
      } else {
        signalPosixProcessTree(child.pid, "SIGTERM");
        forceKillTimer = setTimeout(
          () => signalPosixProcessTree(child.pid, "SIGKILL"),
          1_000,
        );
        forceKillTimer.unref();
      }
    }, timeoutMs);

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      rejectPromise(error);
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolvePromise(Object.freeze({ timedOut, exitCode, signal }));
    });

    try {
      onSpawn(Object.freeze({ pid: child.pid }));
    } catch (error) {
      clearTimeout(timeout);
      if (process.platform === "win32") terminateWindowsProcessTree(child.pid);
      else signalPosixProcessTree(child.pid, "SIGKILL");
      rejectPromise(error);
    }
  });
}

export async function superviseUploadProcess(
  argv,
  {
    repoRoot = REPO_ROOT,
    leaseExists = existsSync,
    runProcess = runOwnedProcess,
  } = {},
) {
  const parsed = parseUploadProcessSupervisorArgs(argv);
  const statePath = resolve(repoRoot, parsed.statePath);
  const result = await runProcess({
    command: process.execPath,
    args: [UPLOAD_ENTRY, ...parsed.uploaderArgs],
    timeoutMs: parsed.timeoutMs,
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (!result.timedOut) {
    return Object.freeze({
      classification: "UPLOAD_PROCESS_EXITED",
      uploaderInvocationCount: 1,
      childExitCode: result.exitCode,
      childSignal: result.signal,
    });
  }

  const activeLease = leaseExists(`${statePath}.upload-lease`);
  return Object.freeze({
    classification: activeLease
      ? "UPLOAD_TIMEOUT_ACTIVE_LEASE_BLOCKED"
      : "UPLOAD_TIMEOUT_PRE_LEASE_NOOP_BLOCKED",
    terminal: true,
    retryable: false,
    replayAllowed: false,
    uploaderInvocationCount: 1,
    executionId: null,
    lease: activeLease ? "ACTIVE" : "ABSENT",
    telemetry: activeLease ? "PRESERVE_EXISTING" : "UNAVAILABLE",
    perChunkResults: Object.freeze([]),
    childExitCode: result.exitCode,
    childSignal: result.signal,
  });
}

async function main() {
  const result = await superviseUploadProcess(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (
    result.classification !== "UPLOAD_PROCESS_EXITED" ||
    result.childExitCode !== 0
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    process.stderr.write(
      `${JSON.stringify({
        classification: "UPLOAD_SUPERVISOR_CONFIGURATION_BLOCKED",
        terminal: true,
        retryable: false,
      })}\n`,
    );
    process.exitCode = 1;
  }
}
