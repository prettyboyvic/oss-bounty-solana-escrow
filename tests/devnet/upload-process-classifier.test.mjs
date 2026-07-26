import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const classifierModule = await import("../../scripts/devnet/upload-process-classifier.mjs");
const {
  classifyRetainedUploadProcess,
  inspectRetainedUploadProcesses,
  parseWindowsCommandLine,
} = classifierModule;

const REPO_ROOT = "C:\\work tree\\oss-bounty-solana-escrow";
const PROGRAM = "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z";
const BUFFER = "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW";
const STATE = ".devnet\\state.json";
const SUPERVISOR = `${REPO_ROOT}\\scripts\\devnet\\upload-process-supervisor.mjs`;
const UPLOADER = `${REPO_ROOT}\\scripts\\devnet\\upload-buffer-cli.mjs`;
const OUTER_HOST = `${REPO_ROOT}\\scripts\\devnet\\upload-window-host.mjs`;

const context = Object.freeze({
  repoRoot: REPO_ROOT,
  currentPid: 900,
  program: PROGRAM,
  buffer: BUFFER,
  statePath: `${REPO_ROOT}\\${STATE}`,
  stateArgument: ".devnet/state.json",
  platform: "win32",
});

function uploaderTail(overrides = {}) {
  return [
    "upload-buffer-throttled",
    "--url", "https://api.devnet.solana.com",
    "--program", overrides.program ?? PROGRAM,
    "--buffer", overrides.buffer ?? BUFFER,
    "--state", overrides.state ?? STATE,
    "--authority", ".devnet\\test-only-keypair.json",
    "--max-chunks", "5",
    "--delay-ms", "3000",
    "--rpc-request-timeout-ms", "15000",
    "--acknowledge-devnet-write", "R4_BUFFER_UPLOAD",
  ];
}

function supervisorArgv(overrides = {}) {
  return [
    "C:\\Program Files\\nodejs\\node.exe",
    overrides.script ?? SUPERVISOR,
    "--timeout-ms", "10000",
    "--cleanup-timeout-ms", "500",
    "--",
    ...uploaderTail(overrides),
  ];
}

function uploaderArgv(overrides = {}) {
  return [
    "C:\\Program Files\\nodejs\\node.exe",
    overrides.script ?? UPLOADER,
    ...uploaderTail(overrides),
  ];
}

function outerHostArgv(overrides = {}) {
  return [
    "C:\\Program Files\\nodejs\\node.exe",
    overrides.script ?? OUTER_HOST,
    "--execution-id", "test-only-id",
    "--expected-invocations", "1",
    "--",
    "C:\\Program Files\\nodejs\\node.exe",
    ...supervisorArgv(overrides).slice(1),
  ];
}

function processRecord(pid, argv, overrides = {}) {
  return {
    pid,
    parentPid: overrides.parentPid ?? 1,
    name: Object.hasOwn(overrides, "name") ? overrides.name : "node.exe",
    executablePath: Object.hasOwn(overrides, "executablePath")
      ? overrides.executablePath
      : argv?.[0] ?? null,
    argv,
    commandLine: overrides.commandLine,
    creationTime: overrides.creationTime ?? "20260726010000.000000+420",
  };
}

function classify(argv, overrides = {}) {
  return classifyRetainedUploadProcess(processRecord(overrides.pid ?? 901, argv, overrides), context);
}

test("Windows argv parser preserves quoted executable paths, repeated whitespace, backslashes, and escaped quotes", () => {
  assert.deepEqual(
    parseWindowsCommandLine(
      '  "C:\\Program Files\\nodejs\\node.exe"   "C:\\work tree\\script.mjs"  "a\\\\\\"b"  plain  ',
    ),
    [
      "C:\\Program Files\\nodejs\\node.exe",
      "C:\\work tree\\script.mjs",
      'a\\"b',
      "plain",
    ],
  );
});

test("PowerShell, pwsh, and cmd wrappers containing the complete frozen command are not retained upload roles", () => {
  const nested = outerHostArgv().map((value) => `"${value}"`).join(" ");
  const wrappers = [
    ["powershell.exe", "-NoProfile", "-Command", `& { ${nested} }`],
    ["pwsh.exe", "-Command", `'${nested}'`],
    ["cmd.exe", "/c", nested],
  ];
  for (const [name, ...args] of wrappers) {
    const result = classifyRetainedUploadProcess({
      pid: 902,
      parentPid: 1,
      name,
      executablePath: `C:\\Windows\\System32\\${name}`,
      commandLine: [`"C:\\Windows\\System32\\${name}"`, ...args].join(" "),
      creationTime: "20260726010000.000000+420",
    }, context);
    assert.equal(result.role, null, name);
    assert.equal(result.conflicts, false, name);
  }
});

test("unrelated Node scripts, test runners, task runners, and embedded script-name arguments do not match", () => {
  const completeCommand = outerHostArgv().join(" ");
  const cases = [
    ["C:\\repo\\unrelated.mjs", completeCommand],
    ["C:\\repo\\node-test-runner.mjs", "upload-buffer-cli.mjs", PROGRAM, BUFFER, STATE],
    ["C:\\repo\\task-runner.mjs", completeCommand],
    ["C:\\repo\\unrelated.mjs", `prefix:${SUPERVISOR}:suffix`, PROGRAM, BUFFER, STATE],
  ];
  for (const args of cases) {
    const result = classify(["C:\\Program Files\\nodejs\\node.exe", ...args]);
    assert.equal(result.role, null);
    assert.equal(result.conflicts, false);
  }
});

test("real supervisor, production uploader, and conflicting outer-host argv shapes match by role", () => {
  assert.deepEqual(
    [classify(supervisorArgv()).role, classify(uploaderArgv()).role, classify(outerHostArgv()).role],
    ["INNER_SUPERVISOR", "UPLOADER", "OUTER_HOST"],
  );
  assert.equal(classify(supervisorArgv()).conflicts, true);
  assert.equal(classify(uploaderArgv()).conflicts, true);
  assert.equal(classify(outerHostArgv()).conflicts, true);
});

test("current host PID is excluded but a real parent or ancestor supervisor is not bypassed", () => {
  assert.equal(classify(supervisorArgv(), { pid: context.currentPid }).conflicts, false);
  assert.equal(classify(supervisorArgv(), { pid: 903, parentPid: context.currentPid }).conflicts, true);
  assert.equal(classify(supervisorArgv(), { pid: 904, parentPid: 1 }).conflicts, true);
});

test("relative, absolute, forward-slash, and case-varied Windows entrypoint paths normalize exactly", () => {
  assert.equal(classify(supervisorArgv({ script: "scripts/devnet/upload-process-supervisor.mjs" })).conflicts, true);
  assert.equal(classify(supervisorArgv({ script: SUPERVISOR.toUpperCase() })).conflicts, true);
  assert.equal(classify(supervisorArgv({ script: SUPERVISOR.replaceAll("\\", "/") })).conflicts, true);
  assert.equal(classify(supervisorArgv({ script: `${SUPERVISOR}.backup` })).role, null);
});

test("program, buffer, and state mismatches prevent workflow conflict after role proof", () => {
  assert.equal(classify(supervisorArgv({ program: "wrong-program" })).conflicts, false);
  assert.equal(classify(uploaderArgv({ buffer: "wrong-buffer" })).conflicts, false);
  assert.equal(classify(outerHostArgv({ state: ".devnet\\other-state.json" })).conflicts, false);
});

test("missing executable identity never produces an ungrounded positive and yields bounded fail-closed evidence", () => {
  const record = processRecord(905, supervisorArgv(), {
    name: null,
    executablePath: null,
  });
  record.argv[0] = "";
  const classified = classifyRetainedUploadProcess(record, context);
  assert.equal(classified.role, null);
  assert.equal(classified.conflicts, false);

  const inspection = inspectRetainedUploadProcesses([record], context);
  assert.deepEqual(inspection.conflicts, []);
  assert.equal(inspection.diagnostics.length, 1);
  assert.equal(inspection.diagnostics[0].code, "EXECUTABLE_IDENTITY_UNAVAILABLE");
  assert.equal(inspection.diagnostics[0].pid, 905);
  assert.doesNotMatch(JSON.stringify(inspection.diagnostics), /test-only-keypair|api\.devnet|R4_BUFFER_UPLOAD/);
});

test("a transient Node record without entrypoint evidence is not an upload candidate", () => {
  const inspection = inspectRetainedUploadProcesses([{
    pid: 906,
    parentPid: 1,
    name: "node.exe",
    executablePath: "C:\\Program Files\\nodejs\\node.exe",
    commandLine: null,
    creationTime: "20260726010000.000000+420",
  }], context);
  assert.equal(inspection.conflicts.length, 0);
  assert.deepEqual(inspection.diagnostics, []);
});

test("multiple records produce stable PID-sorted, deduplicated evidence", () => {
  const records = [
    processRecord(909, uploaderArgv()),
    processRecord(907, supervisorArgv()),
    processRecord(909, uploaderArgv(), { creationTime: "20260726020000.000000+420" }),
    processRecord(908, ["C:\\Program Files\\nodejs\\node.exe", "C:\\repo\\other.mjs"]),
  ];
  const forward = inspectRetainedUploadProcesses(records, context);
  const reverse = inspectRetainedUploadProcesses([...records].reverse(), context);
  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.conflicts.map(({ pid, role }) => ({ pid, role })), [
    { pid: 907, role: "INNER_SUPERVISOR" },
    { pid: 909, role: "UPLOADER" },
  ]);
  assert.deepEqual(forward.conflicts[0], {
    pid: 907,
    parentPid: 1,
    role: "INNER_SUPERVISOR",
    executableName: "node.exe",
    entrypoint: "scripts/devnet/upload-process-supervisor.mjs",
    creationTime: "20260726010000.000000+420",
  });
});

test("inspection is read-only and never invokes broad process termination", () => {
  let terminationCount = 0;
  const inspection = inspectRetainedUploadProcesses(
    [processRecord(910, supervisorArgv())],
    { ...context, terminateProcess: () => { terminationCount += 1; } },
  );
  assert.equal(inspection.conflicts.length, 1);
  assert.equal(terminationCount, 0);
});

test("PowerShell parent preflight reaches one fake child and execution-ID reuse is rejected before retry", {
  skip: process.platform !== "win32",
}, () => {
  const ignoredTestRoot = resolve(".devnet", "test-process-classifier");
  mkdirSync(ignoredTestRoot, { recursive: true });
  const resultRoot = mkdtempSync(join(ignoredTestRoot, "probe-"));
  const executionId = "test-only-powershell-wrapper";
  const probe = resolve("tests/devnet/fixtures/powershell-upload-host-probe.mjs");
  const hostArgv = [
    "--execution-id", executionId,
    "--child-lifecycle-timeout-ms", "11000",
    "--outer-cleanup-allowance-ms", "1000",
    "--finalization-timeout-ms", "2000",
    "--host-total-timeout-ms", "15000",
    "--result-root", resultRoot,
    "--expected-repository-sha", "1".repeat(40),
    "--expected-state-sha", "2".repeat(64),
    "--expected-buffer-sha", "3".repeat(64),
    "--expected-binary-sha", "4".repeat(64),
    "--expected-plan-fingerprint", "5".repeat(64),
    "--expected-candidate-evidence-sha", "6".repeat(64),
    "--expected-candidates", "0-4",
    "--expected-invocations", "1",
    "--",
    process.execPath,
    "scripts/devnet/upload-process-supervisor.mjs",
    "--timeout-ms", "10000",
    "--cleanup-timeout-ms", "500",
    "--",
    ...uploaderTail({ state: ".devnet\\test-process-classifier-state.json" }),
  ];
  const quotePowerShell = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const completeCommand = [process.execPath, probe, ...hostArgv]
    .map(quotePowerShell)
    .join(" ");
  const invoke = () => spawnSync("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `& ${completeCommand}`,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  try {
    const first = invoke();
    assert.equal(first.status, 0, first.stderr);
    const firstResult = JSON.parse(first.stdout.trim().split(/\r?\n/).at(-1));
    assert.deepEqual(firstResult, {
      verdict: "HOST_CHILD_SUCCEEDED",
      exitCode: 0,
      childSpawnCount: 1,
      durableResultPersisted: true,
      errorSummary: null,
    }, first.stderr);
    const durable = JSON.parse(readFileSync(
      join(resultRoot, executionId, "host-result.json"),
      "utf8",
    ));
    assert.equal(durable.childSpawnCount, 1);
    assert.equal(durable.innerTerminalResult.uploaderInvocationCount, 1);

    const second = invoke();
    assert.equal(second.status, 0, second.stderr);
    const secondResult = JSON.parse(second.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(
      secondResult.verdict,
      "HOST_EXECUTION_ID_CONSUMED",
      JSON.stringify(secondResult),
    );
    assert.equal(secondResult.childSpawnCount, 0);
    assert.equal(secondResult.durableResultPersisted, false);
  } finally {
    rmSync(resultRoot, { recursive: true, force: true });
  }
});
