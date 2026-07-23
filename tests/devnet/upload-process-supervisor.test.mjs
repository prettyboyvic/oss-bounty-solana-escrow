import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MIN_UPLOAD_PROCESS_TIMEOUT_MS,
  parseUploadProcessSupervisorArgs,
  runOwnedProcess,
  superviseUploadProcess,
} from "../../scripts/devnet/upload-process-supervisor.mjs";

const UPLOAD_ARGS = [
  "upload-buffer-throttled",
  "--url", "https://api.devnet.solana.com",
  "--program", "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z",
  "--buffer", "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW",
  "--state", ".devnet/state.json",
  "--authority", "IGNORED_TEST_AUTHORITY_PATH",
  "--max-chunks", "5",
  "--delay-ms", "3000",
  "--acknowledge-devnet-write", "R4_BUFFER_UPLOAD",
];

function supervisorArgs(timeoutMs = 120_000) {
  return ["--timeout-ms", String(timeoutMs), "--", ...UPLOAD_ARGS];
}

test("parses an explicit millisecond timeout without unit conversion", () => {
  const parsed = parseUploadProcessSupervisorArgs(supervisorArgs(120_000));
  assert.equal(parsed.timeoutMs, 120_000);
  assert.deepEqual(parsed.uploaderArgs, UPLOAD_ARGS);
});

test("rejects invalid timeout values before uploader invocation", async () => {
  for (const value of ["", "0", "-1", "1.5", "1000", "2147483648", "10s"]) {
    let invocations = 0;
    await assert.rejects(
      superviseUploadProcess(["--timeout-ms", value, "--", ...UPLOAD_ARGS], {
        runProcess: async () => {
          invocations += 1;
          return { timedOut: false, exitCode: 0, signal: null };
        },
      }),
      /timeout/i,
    );
    assert.equal(invocations, 0);
  }
  assert.equal(MIN_UPLOAD_PROCESS_TIMEOUT_MS, 3_000);
});

test("allows a valid child to initialize for more than one second", async () => {
  const started = performance.now();
  const result = await runOwnedProcess({
    command: process.execPath,
    args: ["-e", "setTimeout(() => process.exit(0), 1200)"],
    timeoutMs: 4_000,
  });
  const elapsedMs = performance.now() - started;
  assert.equal(result.timedOut, false);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.ok(elapsedMs >= 1_100, `child exited too early: ${elapsedMs}`);
});

test("a real timeout remains bounded and invokes the owned process once", async () => {
  let invocations = 0;
  const started = performance.now();
  const result = await runOwnedProcess({
    command: process.execPath,
    args: ["-e", "setTimeout(() => process.exit(0), 10000)"],
    timeoutMs: 250,
    onSpawn: () => { invocations += 1; },
  });
  const elapsedMs = performance.now() - started;
  assert.equal(result.timedOut, true);
  assert.equal(invocations, 1);
  assert.ok(elapsedMs >= 200, `timeout fired too early: ${elapsedMs}`);
  assert.ok(elapsedMs < 4_000, `timeout cleanup was not bounded: ${elapsedMs}`);
});

test("timeout cleanup terminates the owned process tree", async () => {
  const directory = mkdtempSync(join(tmpdir(), "upload-supervisor-tree-"));
  const pidPath = join(directory, "grandchild.pid");
  const childScript = join(directory, "child.mjs");
  writeFileSync(childScript, `
    import { spawn } from "node:child_process";
    import { writeFileSync } from "node:fs";
    const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: false,
      stdio: "ignore",
    });
    writeFileSync(${JSON.stringify(pidPath)}, String(grandchild.pid));
    setInterval(() => {}, 1000);
  `);
  try {
    const result = await runOwnedProcess({
      command: process.execPath,
      args: [childScript],
      timeoutMs: 500,
    });
    assert.equal(result.timedOut, true);
    const grandchildPid = Number(readFileSync(pidPath, "utf8"));
    assert.ok(Number.isSafeInteger(grandchildPid) && grandchildPid > 0);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.throws(() => process.kill(grandchildPid, 0));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pre-lease timeout is blocked without fabricated execution evidence or retry", async () => {
  let invocations = 0;
  const result = await superviseUploadProcess(supervisorArgs(), {
    repoRoot: "C:\\offline-fixture",
    leaseExists: () => false,
    runProcess: async () => {
      invocations += 1;
      return { timedOut: true, exitCode: null, signal: "SIGTERM" };
    },
  });
  assert.equal(invocations, 1);
  assert.deepEqual(result, {
    classification: "UPLOAD_TIMEOUT_PRE_LEASE_NOOP_BLOCKED",
    terminal: true,
    retryable: false,
    replayAllowed: false,
    uploaderInvocationCount: 1,
    executionId: null,
    lease: "ABSENT",
    telemetry: "UNAVAILABLE",
    perChunkResults: [],
    childExitCode: null,
    childSignal: "SIGTERM",
  });
});

test("timeout with an existing lease remains blocked for reconciliation", async () => {
  const result = await superviseUploadProcess(supervisorArgs(), {
    repoRoot: "C:\\offline-fixture",
    leaseExists: () => true,
    runProcess: async () => ({ timedOut: true, exitCode: null, signal: "SIGKILL" }),
  });
  assert.equal(result.classification, "UPLOAD_TIMEOUT_ACTIVE_LEASE_BLOCKED");
  assert.equal(result.lease, "ACTIVE");
  assert.equal(result.telemetry, "PRESERVE_EXISTING");
  assert.equal(result.executionId, null);
  assert.deepEqual(result.perChunkResults, []);
});

test("successful child behavior is preserved without a second invocation", async () => {
  let invocations = 0;
  let processInput;
  let leaseReads = 0;
  const result = await superviseUploadProcess(supervisorArgs(), {
    repoRoot: "C:\\offline-fixture",
    leaseExists: () => { leaseReads += 1; return true; },
    runProcess: async (input) => {
      invocations += 1;
      processInput = input;
      return { timedOut: false, exitCode: 0, signal: null };
    },
  });
  assert.equal(invocations, 1);
  assert.equal(leaseReads, 0);
  assert.equal(processInput.command, process.execPath);
  assert.match(processInput.args[0], /upload-buffer-cli\.mjs$/);
  assert.deepEqual(processInput.args.slice(1), UPLOAD_ARGS);
  assert.equal(processInput.timeoutMs, 120_000);
  assert.deepEqual(result, {
    classification: "UPLOAD_PROCESS_EXITED",
    uploaderInvocationCount: 1,
    childExitCode: 0,
    childSignal: null,
  });
});
