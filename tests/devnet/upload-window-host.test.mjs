import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";

import {
  HOST_EXIT_CODES,
  parseUploadWindowHostArgs,
  runOwnedHostChild,
  runUploadWindowHost,
  sanitizeHostArguments,
  verifyAuthorizationManifest,
  writeJsonAtomic,
} from "../../scripts/devnet/upload-window-host.mjs";

const SHA = {
  repository: "1".repeat(40),
  state: "2".repeat(64),
  buffer: "3".repeat(64),
  binary: "4".repeat(64),
  plan: "5".repeat(64),
};

const INNER_ARGS = [
  "scripts/devnet/upload-process-supervisor.mjs",
  "--timeout-ms", "10000",
  "--",
  "upload-buffer-throttled",
  "--url", "https://api.devnet.solana.com",
  "--program", "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z",
  "--buffer", "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW",
  "--state", ".devnet/state.json",
  "--authority", ".devnet/deployment-authority.devnet-keypair.json",
  "--max-chunks", "5",
  "--delay-ms", "3000",
  "--acknowledge-devnet-write", "R4_BUFFER_UPLOAD",
];

function hostArgs(resultRoot, overrides = {}) {
  const values = {
    "execution-id": "r4-test-001",
    "outer-timeout-ms": "12000",
    "cleanup-allowance-ms": "1000",
    "result-root": resultRoot,
    "expected-repository-sha": SHA.repository,
    "expected-state-sha": SHA.state,
    "expected-buffer-sha": SHA.buffer,
    "expected-binary-sha": SHA.binary,
    "expected-plan-fingerprint": SHA.plan,
    "expected-candidates": "264-268",
    "expected-invocations": "1",
    ...overrides,
  };
  const argv = [];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) argv.push(`--${key}`, String(value));
  }
  return [...argv, "--", process.execPath, ...INNER_ARGS];
}

function verifiedManifest(parsed) {
  return {
    ...parsed.manifest,
    repositoryRoot: "C:/repo",
    branch: "main",
    head: SHA.repository,
    originMain: SHA.repository,
    ahead: 0,
    behind: 0,
    statePath: ".devnet/state.json",
    binaryPath: "target/sbf-solana-solana/release/oss_bounty_escrow.so",
    candidateIndexes: [264, 265, 266, 267, 268],
    verifiedAt: "2026-07-26T00:00:00.000Z",
  };
}

function terminalResult(classification = "UPLOAD_PROCESS_EXITED") {
  return {
    classification,
    uploaderInvocationCount: 1,
    childExitCode: 0,
    childSignal: null,
  };
}

function tempRoot(label = "upload-host-") {
  return mkdtempSync(join(tmpdir(), label));
}

function successChild({ stdoutPath, stderrPath, onSpawn }) {
  onSpawn({ pid: 4321 });
  const stdout = `${JSON.stringify(terminalResult(), null, 2)}\n`;
  const stderr = "fake diagnostic\n";
  writeFileSync(stdoutPath, stdout);
  writeFileSync(stderrPath, stderr);
  return Promise.resolve({
    pid: 4321,
    exitCode: 0,
    signal: null,
    outerTimedOut: false,
    interrupted: false,
    cleanupCompleted: true,
  });
}

async function runFixture(root, overrides = {}) {
  return runUploadWindowHost(hostArgs(root, overrides.argv), {
    repoRoot: "C:/repo",
    verifyManifest: overrides.verifyManifest ?? (async (parsed) => verifiedManifest(parsed)),
    revalidateManifest: overrides.revalidateManifest,
    runChild: overrides.runChild ?? successChild,
    hostPid: 1234,
    now: (() => {
      const values = [
        "2026-07-26T00:00:00.000Z",
        "2026-07-26T00:00:01.000Z",
      ];
      return () => values.shift() ?? "2026-07-26T00:00:01.000Z";
    })(),
    monotonicNow: (() => {
      const values = [100, 1100];
      return () => values.shift() ?? 1100;
    })(),
    emitFinal: overrides.emitFinal ?? (() => {}),
    emitEmergency: overrides.emitEmergency,
    writeJsonAtomic: overrides.writeJsonAtomic,
    fsyncDirectory: overrides.fsyncDirectory,
    fsyncFile: overrides.fsyncFile,
  });
}

test("parses the closed outer-host contract and exact-one invocation", () => {
  const parsed = parseUploadWindowHostArgs(hostArgs(".devnet/upload-host-results"));
  assert.equal(parsed.executionId, "r4-test-001");
  assert.equal(parsed.outerTimeoutMs, 12000);
  assert.equal(parsed.cleanupAllowanceMs, 1000);
  assert.equal(parsed.manifest.expectedInvocations, 1);
  assert.deepEqual(parsed.manifest.expectedCandidates, [264, 265, 266, 267, 268]);
  assert.equal(parsed.innerCommand, process.execPath);
  assert.deepEqual(parsed.innerArgs, INNER_ARGS);
});

test("rejects expected-invocations other than exactly one", () => {
  for (const value of [undefined, "0", "2", "-1", "1.0", "one"]) {
    assert.throws(
      () => parseUploadWindowHostArgs(hostArgs(".devnet/results", { "expected-invocations": value })),
      /expected-invocations/i,
    );
  }
});

test("rejects unsafe execution IDs and path traversal", () => {
  for (const value of ["", ".", "..", "../x", "x/y", "x\\y", "CON", "nul.txt", "x ", "é", "a".repeat(65)]) {
    assert.throws(
      () => parseUploadWindowHostArgs(hostArgs(".devnet/results", { "execution-id": value })),
      /execution ID/i,
    );
  }
});

test("rejects invalid timeout values and a non-outliving outer boundary", () => {
  for (const value of ["0", "-1", "1.5", "10s", "2147483648"]) {
    assert.throws(
      () => parseUploadWindowHostArgs(hostArgs(".devnet/results", { "outer-timeout-ms": value })),
      /timeout/i,
    );
  }
  assert.throws(
    () => parseUploadWindowHostArgs(hostArgs(".devnet/results", {
      "outer-timeout-ms": "11000",
      "cleanup-allowance-ms": "1000",
    })),
    /outlive/i,
  );
});

test("rejects an arbitrary child instead of the upload process supervisor", () => {
  const argv = hostArgs(".devnet/results");
  argv[argv.indexOf("--") + 2] = "scripts/devnet/not-the-supervisor.mjs";
  assert.throws(() => parseUploadWindowHostArgs(argv), /inner supervisor/i);
});

test("successful child completion persists all required durable evidence", async () => {
  const root = tempRoot();
  try {
    const result = await runFixture(root);
    const directory = join(root, "r4-test-001");
    assert.equal(result.verdict, "HOST_CHILD_SUCCEEDED");
    assert.equal(result.exitCode, HOST_EXIT_CODES.SUCCESS);
    assert.deepEqual(
      readdirSync(directory).sort(),
      ["authorization.json", "host-result.json", "invocation.json", "supervisor-stderr.log", "supervisor-stdout.log"],
    );
    const durable = JSON.parse(readFileSync(join(directory, "host-result.json")));
    assert.equal(durable.childSpawnCount, 1);
    assert.equal(durable.retryOccurred, false);
    assert.equal(durable.innerTerminalStatus, "VALID");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("execution marker and completed logs are flushed before durable result", async () => {
  const root = tempRoot();
  const flushedDirectories = [];
  const flushedFiles = [];
  try {
    const result = await runFixture(root, {
      fsyncDirectory(path) {
        flushedDirectories.push(path);
      },
      fsyncFile(path) {
        flushedFiles.push(path);
      },
    });
    assert.equal(result.verdict, "HOST_CHILD_SUCCEEDED");
    assert.deepEqual(flushedDirectories, [root]);
    assert.deepEqual(flushedFiles.sort(), [
      join(root, "r4-test-001", "supervisor-stderr.log"),
      join(root, "r4-test-001", "supervisor-stdout.log"),
    ].sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("authorization manifest is persisted before child spawn", async () => {
  const root = tempRoot();
  try {
    await runFixture(root, {
      runChild(input) {
        assert.ok(existsSync(join(root, "r4-test-001", "authorization.json")));
        return successChild(input);
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("log-open failure prevents child spawn after authorization intent", async () => {
  const root = tempRoot();
  let spawns = 0;
  try {
    await assert.rejects(
      runOwnedHostChild({
        command: process.execPath,
        args: ["ignored"],
        cwd: process.cwd(),
        stdoutPath: root,
        stderrPath: join(root, "stderr.log"),
        outerTimeoutMs: 12000,
        cleanupAllowanceMs: 1000,
        spawnProcess() {
          spawns += 1;
          throw new Error("spawn must not be reached");
        },
      }),
    );
    assert.equal(spawns, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("synchronous child spawn failure closes logs and returns deterministically", async () => {
  const root = tempRoot();
  try {
    const result = await runOwnedHostChild({
      command: process.execPath,
      args: ["ignored"],
      cwd: process.cwd(),
      stdoutPath: join(root, "stdout.log"),
      stderrPath: join(root, "stderr.log"),
      outerTimeoutMs: 12000,
      cleanupAllowanceMs: 1000,
      spawnProcess() {
        throw new Error("injected spawn failure");
      },
    });
    assert.equal(result.spawnObserved, false);
    assert.equal(result.spawnFailed, true);
    assert.equal(result.cleanupCompleted, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("asynchronous child spawn failure closes logs and returns deterministically", async () => {
  const root = tempRoot();
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  try {
    const result = await runOwnedHostChild({
      command: process.execPath,
      args: ["ignored"],
      cwd: process.cwd(),
      stdoutPath: join(root, "stdout.log"),
      stderrPath: join(root, "stderr.log"),
      outerTimeoutMs: 12000,
      cleanupAllowanceMs: 1000,
      spawnProcess: () => {
        queueMicrotask(() => child.emit("error", new Error("injected async spawn failure")));
        return child;
      },
    });
    assert.equal(result.spawnObserved, false);
    assert.equal(result.spawnFailed, true);
    assert.equal(result.cleanupCompleted, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("log stream failure triggers owned cleanup and reports persistence failure", async () => {
  const root = tempRoot();
  const child = new EventEmitter();
  child.pid = 779;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const logStreams = [];
  const cleanup = [];
  try {
    const pending = runOwnedHostChild({
      command: process.execPath,
      args: ["ignored"],
      cwd: process.cwd(),
      stdoutPath: join(root, "stdout.log"),
      stderrPath: join(root, "stderr.log"),
      outerTimeoutMs: 12000,
      cleanupAllowanceMs: 1000,
      spawnProcess: () => {
        queueMicrotask(() => child.emit("spawn"));
        return child;
      },
      createLogWriteStream(_path, { fd }) {
        closeSync(fd);
        const stream = new PassThrough();
        logStreams.push(stream);
        return stream;
      },
      terminateOwnedTree: async ({ pid, force }) => {
        cleanup.push({ pid, force });
        child.stdout.end();
        child.stderr.end();
        logStreams[1].destroy();
        child.emit("close", null, "SIGTERM");
      },
    });
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    logStreams[0].destroy(new Error("injected log stream failure"));
    const result = await pending;
    assert.deepEqual(cleanup, [{ pid: 779, force: false }]);
    assert.equal(result.logPersistenceFailed, true);
    assert.equal(result.cleanupCompleted, true);
    assert.equal(result.spawnObserved, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [label, message] of [
  ["binding mismatch", "repository SHA mismatch"],
  ["dirty repository", "worktree is dirty"],
  ["state mismatch", "state SHA mismatch"],
  ["buffer mismatch", "buffer SHA mismatch"],
  ["candidate mismatch", "candidate mismatch"],
]) {
  test(`${label} prevents child spawn and records zero invocations`, async () => {
    const root = tempRoot();
    let spawns = 0;
    try {
      const result = await runFixture(root, {
        verifyManifest: async () => { throw new Error(message); },
        runChild: async () => { spawns += 1; },
      });
      assert.equal(spawns, 0);
      assert.equal(result.childSpawnCount, 0);
      assert.equal(result.verdict, "HOST_MANIFEST_REJECTED");
      assert.equal(result.exitCode, HOST_EXIT_CODES.MANIFEST_FAILURE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("final local revalidation mismatch is durable and prevents child spawn", async () => {
  const root = tempRoot();
  let spawns = 0;
  try {
    const result = await runFixture(root, {
      revalidateManifest: async () => {
        throw new Error("state SHA mismatch");
      },
      runChild: async () => {
        spawns += 1;
      },
    });
    assert.equal(spawns, 0);
    assert.equal(result.childSpawnCount, 0);
    assert.equal(result.verdict, "HOST_MANIFEST_REJECTED");
    assert.equal(result.durableResultPersisted, true);
    assert.equal(existsSync(join(root, "r4-test-001", "authorization.json")), true);
    assert.equal(existsSync(join(root, "r4-test-001", "invocation.json")), false);
    assert.equal(existsSync(join(root, "r4-test-001", "host-result.json")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exactly one child is spawned", async () => {
  const root = tempRoot();
  let spawns = 0;
  try {
    const result = await runFixture(root, {
      runChild(input) {
        spawns += 1;
        return successChild(input);
      },
    });
    assert.equal(spawns, 1);
    assert.equal(result.childSpawnCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("child failure is preserved and never retried", async () => {
  const root = tempRoot();
  let spawns = 0;
  try {
    const result = await runFixture(root, {
      runChild({ stdoutPath, stderrPath, onSpawn }) {
        spawns += 1;
        onSpawn({ pid: 50 });
        writeFileSync(stdoutPath, `${JSON.stringify({ ...terminalResult(), childExitCode: 7 })}\n`);
        writeFileSync(stderrPath, "failed\n");
        return Promise.resolve({ pid: 50, exitCode: 7, signal: null, outerTimedOut: false, interrupted: false, cleanupCompleted: true });
      },
    });
    assert.equal(spawns, 1);
    assert.equal(result.verdict, "HOST_CHILD_NONZERO");
    assert.equal(result.childExitCode, 7);
    assert.equal(result.retryOccurred, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("outer timeout is durable and never retried", async () => {
  const root = tempRoot();
  let spawns = 0;
  try {
    const result = await runFixture(root, {
      runChild({ stdoutPath, stderrPath, onSpawn }) {
        spawns += 1;
        onSpawn({ pid: 51 });
        writeFileSync(stdoutPath, "");
        writeFileSync(stderrPath, "timed out\n");
        return Promise.resolve({ pid: 51, exitCode: null, signal: "SIGKILL", outerTimedOut: true, interrupted: false, cleanupCompleted: true });
      },
    });
    assert.equal(spawns, 1);
    assert.equal(result.verdict, "HOST_OUTER_TIMEOUT");
    assert.equal(result.exitCode, HOST_EXIT_CODES.OUTER_TIMEOUT);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reusing an execution ID is rejected before child spawn", async () => {
  const root = tempRoot();
  let secondSpawns = 0;
  try {
    await runFixture(root);
    const result = await runFixture(root, {
      runChild: async () => { secondSpawns += 1; },
    });
    assert.equal(secondSpawns, 0);
    assert.equal(result.verdict, "HOST_EXECUTION_ID_CONSUMED");
    assert.equal(result.exitCode, HOST_EXIT_CODES.EXECUTION_ID_CONSUMED);
    assert.equal(result.childSpawnCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a consumed execution ID remains consumed after child failure", async () => {
  const root = tempRoot();
  try {
    await runFixture(root, {
      runChild({ stdoutPath, stderrPath, onSpawn }) {
        onSpawn({ pid: 55 });
        writeFileSync(stdoutPath, "");
        writeFileSync(stderrPath, "failed\n");
        return Promise.resolve({ pid: 55, exitCode: 1, signal: null, outerTimedOut: false, interrupted: false, cleanupCompleted: true });
      },
    });
    const replay = await runFixture(root);
    assert.equal(replay.verdict, "HOST_EXECUTION_ID_CONSUMED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stdout and stderr are complete, separate, hashed, and sized", async () => {
  const root = tempRoot();
  try {
    const result = await runFixture(root);
    assert.match(readFileSync(result.stdout.path, "utf8"), /UPLOAD_PROCESS_EXITED/);
    assert.equal(readFileSync(result.stderr.path, "utf8"), "fake diagnostic\n");
    assert.equal(result.stdout.bytes, readFileSync(result.stdout.path).length);
    assert.match(result.stdout.sha256, /^[a-f0-9]{64}$/);
    assert.match(result.stderr.sha256, /^[a-f0-9]{64}$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("host result is written only after child completion and log closure", async () => {
  const root = tempRoot();
  try {
    await runFixture(root, {
      runChild(input) {
        assert.equal(existsSync(join(root, "r4-test-001", "host-result.json")), false);
        return successChild(input);
      },
    });
    assert.equal(existsSync(join(root, "r4-test-001", "host-result.json")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("atomic JSON persistence leaves no temporary final file", () => {
  const root = tempRoot();
  try {
    const path = join(root, "host-result.json");
    writeJsonAtomic(path, { ok: true });
    assert.deepEqual(JSON.parse(readFileSync(path)), { ok: true });
    assert.deepEqual(readdirSync(root), ["host-result.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("atomic JSON rename failure leaves no final or temporary result", () => {
  const root = tempRoot();
  try {
    const path = join(root, "host-result.json");
    assert.throws(
      () => writeJsonAtomic(path, { ok: true }, {
        renameSync() { throw new Error("injected rename failure"); },
      }),
      /rename failure/,
    );
    assert.equal(existsSync(path), false);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("valid inner terminal JSON is captured", async () => {
  const root = tempRoot();
  try {
    const result = await runFixture(root);
    assert.deepEqual(result.innerTerminalResult, terminalResult());
    assert.equal(result.innerTerminalStatus, "VALID");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [label, stdout, status, verdict, exitCode] of [
  ["missing", "ordinary output\n", "MISSING", "HOST_INNER_TERMINAL_MISSING", HOST_EXIT_CODES.INNER_TERMINAL_MISSING],
  ["malformed", "{not-json}\n", "MALFORMED", "HOST_INNER_TERMINAL_MALFORMED", HOST_EXIT_CODES.INNER_TERMINAL_MALFORMED],
]) {
  test(`${label} inner terminal JSON is classified`, async () => {
    const root = tempRoot();
    try {
      const result = await runFixture(root, {
        runChild({ stdoutPath, stderrPath, onSpawn }) {
          onSpawn({ pid: 99 });
          writeFileSync(stdoutPath, stdout);
          writeFileSync(stderrPath, "");
          return Promise.resolve({ pid: 99, exitCode: 0, signal: null, outerTimedOut: false, interrupted: false, cleanupCompleted: true });
        },
      });
      assert.equal(result.innerTerminalStatus, status);
      assert.equal(result.verdict, verdict);
      assert.equal(result.exitCode, exitCode);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("inner terminal JSON with extra or secret-bearing fields is malformed", async () => {
  const root = tempRoot();
  try {
    const result = await runFixture(root, {
      runChild({ stdoutPath, stderrPath, onSpawn }) {
        onSpawn({ pid: 991 });
        writeFileSync(stdoutPath, `${JSON.stringify({ ...terminalResult(), privateKey: "CANARY" })}\n`);
        writeFileSync(stderrPath, "");
        return Promise.resolve({ pid: 991, exitCode: 0, signal: null, outerTimedOut: false, interrupted: false, cleanupCompleted: true });
      },
    });
    assert.equal(result.innerTerminalStatus, "MALFORMED");
    assert.equal(result.innerTerminalResult, null);
    assert.doesNotMatch(JSON.stringify(result), /CANARY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("host interruption produces durable evidence", async () => {
  const root = tempRoot();
  try {
    const result = await runFixture(root, {
      runChild({ stdoutPath, stderrPath, onSpawn }) {
        onSpawn({ pid: 100 });
        writeFileSync(stdoutPath, "");
        writeFileSync(stderrPath, "");
        return Promise.resolve({ pid: 100, exitCode: null, signal: "SIGTERM", outerTimedOut: false, interrupted: true, cleanupCompleted: true });
      },
    });
    assert.equal(result.verdict, "HOST_INTERRUPTED");
    assert.equal(result.exitCode, HOST_EXIT_CODES.INTERRUPTED);
    assert.equal(existsSync(join(root, "r4-test-001", "host-result.json")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup failure takes precedence over child failure", async () => {
  const root = tempRoot();
  try {
    const result = await runFixture(root, {
      runChild({ stdoutPath, stderrPath, onSpawn }) {
        onSpawn({ pid: 101 });
        writeFileSync(stdoutPath, "");
        writeFileSync(stderrPath, "");
        return Promise.resolve({ pid: 101, exitCode: 9, signal: null, outerTimedOut: false, interrupted: false, cleanupCompleted: false });
      },
    });
    assert.equal(result.verdict, "HOST_CLEANUP_FAILED");
    assert.equal(result.exitCode, HOST_EXIT_CODES.CLEANUP_FAILURE);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistence failure returns a deterministic terminal failure", async () => {
  const root = tempRoot();
  let writes = 0;
  let finalEmissions = 0;
  let emergencyEmissions = 0;
  try {
    const result = await runFixture(root, {
      writeJsonAtomic(path, value) {
        writes += 1;
        if (path.endsWith("host-result.json")) throw new Error("injected persistence failure");
        return writeJsonAtomic(path, value);
      },
      emitFinal() {
        finalEmissions += 1;
      },
      emitEmergency() {
        emergencyEmissions += 1;
      },
    });
    assert.equal(writes, 3);
    assert.equal(result.verdict, "HOST_RESULT_PERSISTENCE_FAILED");
    assert.equal(result.exitCode, HOST_EXIT_CODES.PERSISTENCE_FAILURE);
    assert.equal(existsSync(join(root, "r4-test-001", "host-result.json")), false);
    assert.equal(finalEmissions, 0);
    assert.equal(emergencyEmissions, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invocation evidence failure preserves the observed spawn count", async () => {
  const root = tempRoot();
  try {
    const result = await runFixture(root, {
      writeJsonAtomic(path, value) {
        if (path.endsWith("invocation.json")) throw new Error("injected invocation persistence failure");
        return writeJsonAtomic(path, value);
      },
    });
    assert.equal(result.verdict, "HOST_RESULT_PERSISTENCE_FAILED");
    assert.equal(result.exitCode, HOST_EXIT_CODES.PERSISTENCE_FAILURE);
    assert.equal(result.childSpawnCount, 1);
    assert.equal(result.durableResultPersisted, true);
    assert.equal(existsSync(join(root, "r4-test-001", "invocation.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("evidence redacts key paths and credential-bearing URL components", async () => {
  const root = tempRoot();
  try {
    const args = hostArgs(root);
    const authorityIndex = args.lastIndexOf("--authority") + 1;
    args[authorityIndex] = ".devnet/CANARY-secret-keypair.json";
    const result = await runUploadWindowHost(args, {
      repoRoot: "C:/repo",
      verifyManifest: async (parsed) => verifiedManifest(parsed),
      runChild: successChild,
      emitFinal: () => {},
    });
    const evidence = JSON.stringify(result);
    assert.doesNotMatch(evidence, /CANARY|password|user|secret-keypair/);
    assert.match(evidence, /<redacted-keypair-path>/);
    assert.deepEqual(
      sanitizeHostArguments(["--url", "https://user:password@api.devnet.solana.com/?token=CANARY"]),
      ["--url", "https://api.devnet.solana.com"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lease telemetry is never used as durable host evidence", async () => {
  const root = tempRoot();
  try {
    const result = await runFixture(root);
    assert.doesNotMatch(result.resultPath, /upload-lease/);
    assert.match(result.resultPath, /r4-test-001[\\/]host-result\.json$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Windows-safe invocation explicitly disables shell use", async () => {
  const root = tempRoot();
  let received;
  try {
    await runFixture(root, {
      runChild(input) {
        received = input;
        return successChild(input);
      },
    });
    assert.equal(received.shell, false);
    assert.equal(received.command, process.execPath);
    assert.deepEqual(received.args, INNER_ARGS);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manifest verifier validates candidates without reading the authority file", async () => {
  const state = {
    schemaVersion: 3,
    deployment: {
      buffer: {
        planFingerprint: SHA.plan,
        chunks: [0, 1, 2, 3, 4].map((index) => ({
          index,
          offset: index * 2,
          length: 2,
          sha256: "a".repeat(64),
          status: "PLANNED",
          signature: null,
        })),
      },
    },
  };
  const binary = Buffer.from("abcdefghij");
  let authorityReads = 0;
  let retainedProcessIdentity;
  const parsed = parseUploadWindowHostArgs(hostArgs(".devnet/results", {
    "expected-state-sha": "a".repeat(64),
    "expected-binary-sha": "b".repeat(64),
    "expected-candidates": "0-4",
  }));
  const verified = await verifyAuthorizationManifest(parsed, {
    repoRoot: "C:/repo",
    collectRepositorySnapshot: async () => ({
      root: "C:/repo", branch: "main", head: SHA.repository, originMain: SHA.repository,
      ahead: 0, behind: 0, clean: true, gitOperationActive: false, resultRootIgnored: true,
    }),
    readStateBytes: () => Buffer.from(JSON.stringify(state)),
    readBinaryBytes: () => binary,
    sha256: (bytes) => bytes === binary ? "b".repeat(64) : "a".repeat(64),
    verifyFinalizedBuffer: async () => ({ sha256: SHA.buffer }),
    pathExists: () => false,
    retainedProcessCount: async (identity) => {
      retainedProcessIdentity = identity;
      return 0;
    },
    readAuthorityFile: () => { authorityReads += 1; },
  });
  assert.deepEqual(verified.candidateIndexes, [0, 1, 2, 3, 4]);
  assert.equal(authorityReads, 0);
  assert.equal(retainedProcessIdentity.program, INNER_ARGS[INNER_ARGS.indexOf("--program") + 1]);
  assert.equal(retainedProcessIdentity.buffer, INNER_ARGS[INNER_ARGS.indexOf("--buffer") + 1]);
  assert.equal(retainedProcessIdentity.statePath, resolve("C:/repo", ".devnet/state.json"));
  assert.equal(retainedProcessIdentity.stateArgument, ".devnet/state.json");
});

test("outer timeout cleanup terminates only the owned child tree and observes allowance", async () => {
  const root = tempRoot("upload-host-owned-tree-");
  const unrelated = process.pid;
  const calls = [];
  try {
    const result = await runOwnedHostChild({
      command: process.execPath,
      args: [resolve("tests/devnet/fixtures/fake-upload-supervisor.mjs"), "--mode", "hang"],
      cwd: process.cwd(),
      stdoutPath: join(root, "stdout.log"),
      stderrPath: join(root, "stderr.log"),
      outerTimeoutMs: 200,
      cleanupAllowanceMs: 300,
      terminateOwnedTree: async ({ pid, force }) => {
        calls.push({ pid, force });
        try { process.kill(pid, force ? "SIGKILL" : "SIGTERM"); } catch {}
      },
    });
    assert.equal(result.outerTimedOut, true);
    assert.equal(calls.every(({ pid }) => pid !== unrelated), true);
    assert.equal(calls[0].force, false);
    assert.equal(result.cleanupCompleted, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup escalation waits for the exact injected allowance", async () => {
  const root = tempRoot("upload-host-cleanup-clock-");
  const child = new EventEmitter();
  child.pid = 777;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const timers = [];
  const cleanup = [];
  try {
    const pending = runOwnedHostChild({
      command: process.execPath,
      args: ["ignored"],
      cwd: process.cwd(),
      stdoutPath: join(root, "stdout.log"),
      stderrPath: join(root, "stderr.log"),
      outerTimeoutMs: 12000,
      cleanupAllowanceMs: 1234,
      spawnProcess: () => {
        queueMicrotask(() => child.emit("spawn"));
        return child;
      },
      setTimer(fn, ms) {
        const timer = { fn, ms, unref() {} };
        timers.push(timer);
        return timer;
      },
      clearTimer() {},
      terminateOwnedTree: async ({ pid, force }) => {
        cleanup.push({ pid, force });
        if (force) {
          child.stdout.end();
          child.stderr.end();
          child.emit("close", null, "SIGKILL");
        }
      },
    });
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    assert.equal(timers[0].ms, 12000);
    await timers[0].fn();
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    assert.equal(timers[1].ms, 617);
    assert.equal(timers[2].ms, 1234);
    assert.deepEqual(cleanup, [{ pid: 777, force: false }]);
    await timers[1].fn();
    const result = await pending;
    assert.deepEqual(cleanup, [{ pid: 777, force: false }, { pid: 777, force: true }]);
    assert.equal(result.outerTimedOut, true);
    assert.equal(result.cleanupCompleted, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup deadline resolves when the owned child ignores all termination", async () => {
  const root = tempRoot("upload-host-cleanup-deadline-");
  const child = new EventEmitter();
  child.pid = 778;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const timers = [];
  const cleanup = [];
  let unrefs = 0;
  child.unref = () => {
    unrefs += 1;
  };
  try {
    const pending = runOwnedHostChild({
      command: process.execPath,
      args: ["ignored"],
      cwd: process.cwd(),
      stdoutPath: join(root, "stdout.log"),
      stderrPath: join(root, "stderr.log"),
      outerTimeoutMs: 12000,
      cleanupAllowanceMs: 1000,
      spawnProcess: () => {
        queueMicrotask(() => child.emit("spawn"));
        return child;
      },
      setTimer(fn, ms) {
        const timer = { fn, ms, unref() {} };
        timers.push(timer);
        return timer;
      },
      clearTimer() {},
      terminateOwnedTree: async ({ pid, force }) => {
        cleanup.push({ pid, force });
      },
    });
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    await timers[0].fn();
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    await timers[1].fn();
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    await timers[2].fn();
    const result = await pending;
    assert.deepEqual(cleanup, [
      { pid: 778, force: false },
      { pid: 778, force: true },
    ]);
    assert.equal(result.outerTimedOut, true);
    assert.equal(result.cleanupCompleted, false);
    assert.equal(result.spawnObserved, true);
    assert.equal(unrefs, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a real host process exits after deadline even when its child survives cleanup", () => {
  const root = tempRoot("upload-host-real-deadline-");
  let survivingPid;
  try {
    const probe = spawnSync(process.execPath, [
      resolve("tests/devnet/fixtures/fake-upload-supervisor.mjs"),
      "--mode", "host-deadline-probe",
      "--stdout-path", join(root, "child-stdout.log"),
      "--stderr-path", join(root, "child-stderr.log"),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: false,
      timeout: 5000,
      windowsHide: true,
    });
    assert.equal(probe.error?.code, undefined);
    assert.equal(probe.status, 0, probe.stderr);
    const result = JSON.parse(probe.stdout.trim());
    survivingPid = result.pid;
    assert.equal(result.outerTimedOut, true);
    assert.equal(result.cleanupCompleted, false);
    assert.equal(result.spawnObserved, true);
  } finally {
    if (Number.isSafeInteger(survivingPid)) {
      try { process.kill(survivingPid, "SIGKILL"); } catch {}
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("outer boundary remains active through stalled log closure", async () => {
  const root = tempRoot("upload-host-log-close-deadline-");
  const child = new EventEmitter();
  child.pid = 780;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const timers = [];
  try {
    const pending = runOwnedHostChild({
      command: process.execPath,
      args: ["ignored"],
      cwd: process.cwd(),
      stdoutPath: join(root, "stdout.log"),
      stderrPath: join(root, "stderr.log"),
      outerTimeoutMs: 12000,
      cleanupAllowanceMs: 1000,
      spawnProcess: () => {
        queueMicrotask(() => {
          child.emit("spawn");
          child.stdout.end();
          child.stderr.end();
          child.emit("close", 0, null);
        });
        return child;
      },
      createLogWriteStream(_path, { fd }) {
        closeSync(fd);
        return new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
          final() {},
        });
      },
      setTimer(fn, ms) {
        const timer = { fn, ms, unref() {} };
        timers.push(timer);
        return timer;
      },
      clearTimer() {},
    });
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    assert.equal(timers[0].ms, 12000);
    await timers[0].fn();
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    assert.equal(timers[2].ms, 1000);
    await timers[2].fn();
    const result = await pending;
    assert.equal(result.outerTimedOut, true);
    assert.equal(result.cleanupCompleted, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fake-child end-to-end streams a valid terminal result without uploader access", async () => {
  const root = tempRoot("upload-host-e2e-");
  try {
    const result = await runOwnedHostChild({
      command: process.execPath,
      args: [resolve("tests/devnet/fixtures/fake-upload-supervisor.mjs"), "--mode", "success"],
      cwd: process.cwd(),
      stdoutPath: join(root, "stdout.log"),
      stderrPath: join(root, "stderr.log"),
      outerTimeoutMs: 2000,
      cleanupAllowanceMs: 500,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.outerTimedOut, false);
    assert.match(readFileSync(join(root, "stdout.log"), "utf8"), /UPLOAD_PROCESS_EXITED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fake-child host end-to-end persists durable result and rejects execution-ID reuse", async () => {
  const root = tempRoot("upload-host-full-e2e-");
  try {
    const runChild = (input) => runOwnedHostChild({
      ...input,
      cwd: process.cwd(),
      args: [resolve("tests/devnet/fixtures/fake-upload-supervisor.mjs"), "--mode", "success"],
    });
    const first = await runFixture(root, { runChild });
    assert.equal(first.verdict, "HOST_CHILD_SUCCEEDED");
    assert.equal(first.childSpawnCount, 1);
    assert.equal(JSON.parse(readFileSync(first.resultPath)).stdout.sha256, first.stdout.sha256);
    const replay = await runFixture(root, { runChild });
    assert.equal(replay.verdict, "HOST_EXECUTION_ID_CONSUMED");
    assert.equal(replay.childSpawnCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("5000ms final-output margin covers the observed post-child durable pipeline", async (context) => {
  const root = tempRoot("upload-host-margin-");
  const timing = {};
  try {
    const runChild = async (input) => {
      const result = await runOwnedHostChild({
        ...input,
        cwd: process.cwd(),
        args: [resolve("tests/devnet/fixtures/fake-upload-supervisor.mjs"), "--mode", "success"],
      });
      timing.childClosed = performance.now();
      return result;
    };
    const result = await runFixture(root, {
      runChild,
      writeJsonAtomic(path, value) {
        if (path.endsWith("host-result.json")) timing.persistenceStarted = performance.now();
        writeJsonAtomic(path, value);
        if (path.endsWith("host-result.json")) timing.persistenceFinished = performance.now();
      },
      emitFinal() {
        timing.finalEmitted = performance.now();
      },
    });
    const postChildMs = timing.finalEmitted - timing.childClosed;
    assert.equal(result.verdict, "HOST_CHILD_SUCCEEDED");
    assert.ok(timing.childClosed <= timing.persistenceStarted);
    assert.ok(timing.persistenceStarted <= timing.persistenceFinished);
    assert.ok(timing.persistenceFinished <= timing.finalEmitted);
    assert.ok(postChildMs >= 0 && postChildMs < 5_000, `post-child pipeline took ${postChildMs}ms`);
    context.diagnostic(`observed post-child parse/hash/persist/final-output pipeline: ${postChildMs.toFixed(4)}ms`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
