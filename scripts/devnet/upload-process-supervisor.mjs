import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { parseRuntimeCommand } from "./upload-execution-contract.mjs";

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const UPLOAD_ENTRY = resolve(REPO_ROOT, "scripts/devnet/upload-buffer-cli.mjs");

// Six paced preflight requests require five 500 ms start gaps even if every
// response is instantaneous. Three seconds is therefore a strict validation
// floor, not a recommended live-window timeout.
export const MIN_UPLOAD_PROCESS_TIMEOUT_MS = 3_000;
export const MIN_UPLOAD_PROCESS_CLEANUP_TIMEOUT_MS = 1;

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

function parseCleanupTimeoutMs(value) {
  if (!/^[1-9]\d*$/.test(value ?? "")) {
    throw new Error("explicit upload process cleanup timeout in milliseconds is required");
  }
  const cleanupTimeoutMs = Number(value);
  if (!Number.isSafeInteger(cleanupTimeoutMs) ||
      cleanupTimeoutMs < MIN_UPLOAD_PROCESS_CLEANUP_TIMEOUT_MS ||
      cleanupTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `upload process cleanup timeout must be ${MIN_UPLOAD_PROCESS_CLEANUP_TIMEOUT_MS}..${MAX_TIMER_DELAY_MS} milliseconds`,
    );
  }
  return cleanupTimeoutMs;
}

export function parseUploadProcessSupervisorArgs(argv) {
  if (
    !Array.isArray(argv) ||
    argv.length < 6 ||
    argv[0] !== "--timeout-ms" ||
    argv[2] !== "--cleanup-timeout-ms" ||
    argv[4] !== "--"
  ) {
    throw new Error(
      "usage: upload-process-supervisor --timeout-ms <milliseconds> --cleanup-timeout-ms <milliseconds> -- upload-buffer-throttled ...",
    );
  }
  const timeoutMs = parseTimeoutMs(argv[1]);
  const cleanupTimeoutMs = parseCleanupTimeoutMs(argv[3]);
  const uploaderArgs = argv.slice(5);
  const parsedUploader = parseRuntimeCommand(uploaderArgs);
  if (parsedUploader.command !== "upload-buffer-throttled") {
    throw new Error("upload process supervisor accepts only upload-buffer-throttled");
  }
  return Object.freeze({
    timeoutMs,
    cleanupTimeoutMs,
    uploaderArgs: Object.freeze([...uploaderArgs]),
    statePath: parsedUploader.state,
  });
}

function terminateWindowsProcessTree(pid, force, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const helper = spawn(
      "taskkill",
      ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { helper.kill(); } catch {}
      rejectPromise(new Error("upload process cleanup helper timed out"));
    }, timeoutMs);
    timer.unref?.();
    helper.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(error);
    });
    helper.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (exitCode === 0 || exitCode === 128) resolvePromise();
      else rejectPromise(new Error("upload process cleanup helper failed"));
    });
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
  cleanupTimeoutMs,
  cwd = process.cwd(),
  stdio = "ignore",
  onSpawn = () => {},
  monotonicNow = () => performance.now(),
}) {
  if (
    typeof command !== "string" ||
    command.length === 0 ||
    !Array.isArray(args) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMER_DELAY_MS ||
    !Number.isSafeInteger(cleanupTimeoutMs) ||
    cleanupTimeoutMs < MIN_UPLOAD_PROCESS_CLEANUP_TIMEOUT_MS ||
    cleanupTimeoutMs > MAX_TIMER_DELAY_MS ||
    typeof monotonicNow !== "function" ||
    typeof onSpawn !== "function"
  ) {
    throw new Error("valid owned process parameters are required");
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const timerOriginMonotonicMs = monotonicNow();
    const child = spawn(command, args, {
      cwd,
      stdio,
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let timedOut = false;
    let settled = false;
    let forceKillTimer = null;
    let cleanupDeadlineTimer = null;
    let cleanupStartedMonotonicMs = null;

    const result = (exitCode, signal, cleanupCompleted) => Object.freeze({
      timedOut,
      exitCode,
      signal,
      cleanupCompleted,
      timerOrigin: "IMMEDIATELY_BEFORE_CHILD_SPAWN",
      runtimeElapsedMs: Math.max(
        0,
        (cleanupStartedMonotonicMs ?? monotonicNow()) - timerOriginMonotonicMs,
      ),
      cleanupElapsedMs: cleanupStartedMonotonicMs === null
        ? 0
        : Math.max(0, monotonicNow() - cleanupStartedMonotonicMs),
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      cleanupStartedMonotonicMs = monotonicNow();
      const forceDelayMs = Math.max(1, Math.floor(cleanupTimeoutMs / 2));
      if (process.platform === "win32") {
        void terminateWindowsProcessTree(child.pid, false, forceDelayMs).catch(() => {});
        forceKillTimer = setTimeout(
          () => {
            void terminateWindowsProcessTree(
              child.pid,
              true,
              Math.max(1, cleanupTimeoutMs - forceDelayMs),
            ).catch(() => {});
          },
          forceDelayMs,
        );
        forceKillTimer.unref();
      } else {
        signalPosixProcessTree(child.pid, "SIGTERM");
        forceKillTimer = setTimeout(
          () => signalPosixProcessTree(child.pid, "SIGKILL"),
          forceDelayMs,
        );
        forceKillTimer.unref();
      }
      cleanupDeadlineTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.unref?.();
        resolvePromise(result(null, null, false));
      }, cleanupTimeoutMs);
      cleanupDeadlineTimer.unref?.();
    }, Math.max(1, timeoutMs - Math.max(0, monotonicNow() - timerOriginMonotonicMs)));

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (cleanupDeadlineTimer) clearTimeout(cleanupDeadlineTimer);
      rejectPromise(error);
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (cleanupDeadlineTimer) clearTimeout(cleanupDeadlineTimer);
      resolvePromise(result(exitCode, signal, true));
    });

    try {
      onSpawn(Object.freeze({ pid: child.pid }));
    } catch (error) {
      clearTimeout(timeout);
      if (process.platform === "win32") {
        void terminateWindowsProcessTree(child.pid, true, cleanupTimeoutMs).catch(() => {});
      }
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
    cleanupTimeoutMs: parsed.cleanupTimeoutMs,
    cwd: repoRoot,
    stdio: "inherit",
  });
  const timing = Object.freeze({
    innerRuntimeTimeoutMs: parsed.timeoutMs,
    innerCleanupTimeoutMs: parsed.cleanupTimeoutMs,
    timerOrigin: result.timerOrigin ?? "IMMEDIATELY_BEFORE_CHILD_SPAWN",
    runtimeElapsedMs: Number.isFinite(result.runtimeElapsedMs)
      ? result.runtimeElapsedMs
      : null,
    cleanupElapsedMs: Number.isFinite(result.cleanupElapsedMs)
      ? result.cleanupElapsedMs
      : null,
    cleanupCompleted: result.cleanupCompleted ?? true,
  });

  if (!result.timedOut) {
    return Object.freeze({
      classification: "UPLOAD_PROCESS_EXITED",
      uploaderInvocationCount: 1,
      childExitCode: result.exitCode,
      childSignal: result.signal,
      ...timing,
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
    ...timing,
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
