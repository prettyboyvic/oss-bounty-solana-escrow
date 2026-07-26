import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const supervisorModule = import(
  "../../scripts/local-validator-supervisor.mjs"
);

function fakeClock() {
  let elapsedMs = 0;
  return {
    now: () => elapsedMs,
    sleep: async (milliseconds) => {
      elapsedMs += milliseconds;
    },
  };
}

function validatorCommand() {
  return {
    executable: "solana-test-validator",
    args: [
      "--reset",
      "--ledger", "C:/repo/.tmp/local-validator/ledger",
      "--bind-address", "127.0.0.1",
      "--rpc-port", "8899",
      "--account", "payer", "C:/repo/.tmp/test-payer-account.json",
      "--bpf-program", "program", "C:/repo/target/deploy/program.so",
      "--quiet",
    ],
    port: 8899,
    ledgerPath: "C:/repo/.tmp/local-validator/ledger",
    logPath: "C:/repo/.tmp/local-validator/validator.log",
  };
}

function testCommand() {
  return {
    executable: process.execPath,
    args: [
      "--import", "tsx",
      "./node_modules/mocha/bin/mocha",
      "-t", "1000000",
      "tests/**/*.ts",
    ],
  };
}

function child(overrides = {}) {
  return {
    pid: 4242,
    exitCode: null,
    signalCode: null,
    ...overrides,
  };
}

function lifecycleAdapters(overrides = {}) {
  const calls = [];
  return {
    calls,
    adapters: {
      spawnValidator: () => {
        calls.push("spawn");
        return child();
      },
      waitForReadiness: async () => {
        calls.push("ready");
        return {
          attempts: 1,
          elapsedMs: 250,
          blockhash: "11111111111111111111111111111111",
          programExecutable: true,
        };
      },
      runTests: async (command) => {
        calls.push(["tests", command]);
        return { exitCode: 0, signal: null };
      },
      cleanupOwnedProcessTree: async (ownedChild) => {
        calls.push(["cleanup", ownedChild.pid]);
        return { ok: true, portFree: true, exitCode: 0, signal: null };
      },
      renderDiagnostics: async () => {
        calls.push("diagnostics");
        return "diagnostics";
      },
      writeDiagnostic: () => {
        calls.push("write-diagnostic");
      },
      ...overrides,
    },
  };
}

test("delayed readiness succeeds after paced blockhash and executable-program probes", async () => {
  const { waitForValidatorReadiness } = await supervisorModule;
  const clock = fakeClock();
  let attempts = 0;
  const result = await waitForValidatorReadiness({
    child: child(),
    timeoutMs: 30_000,
    pollIntervalMs: 250,
    now: clock.now,
    sleep: clock.sleep,
    probe: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error(`rpc unavailable ${attempts}`);
      return {
        blockhash: "11111111111111111111111111111111",
        programExecutable: true,
        programAccountResult: "executable",
      };
    },
  });

  assert.equal(attempts, 3);
  assert.equal(result.elapsedMs, 500);
  assert.equal(result.programExecutable, true);
});

test("readiness fails immediately when the child exits", async () => {
  const { waitForValidatorReadiness } = await supervisorModule;
  const clock = fakeClock();
  await assert.rejects(
    waitForValidatorReadiness({
      child: child({ exitCode: 1 }),
      timeoutMs: 30_000,
      pollIntervalMs: 250,
      now: clock.now,
      sleep: clock.sleep,
      probe: async () => assert.fail("RPC must not be called after child exit"),
    }),
    (error) => error.code === "LOCAL_VALIDATOR_EXITED" &&
      error.exitCode === 1 &&
      error.elapsedMs === 0,
  );
});

test("readiness times out boundedly when RPC never becomes healthy", async () => {
  const { waitForValidatorReadiness } = await supervisorModule;
  const clock = fakeClock();
  let attempts = 0;
  await assert.rejects(
    waitForValidatorReadiness({
      child: child(),
      timeoutMs: 30_000,
      pollIntervalMs: 250,
      now: clock.now,
      sleep: clock.sleep,
      probe: async () => {
        attempts += 1;
        throw new Error("connection refused");
      },
    }),
    (error) => error.code === "LOCAL_VALIDATOR_START_TIMEOUT" &&
      error.elapsedMs === 30_000 &&
      error.lastBlockhashError === "connection refused",
  );
  assert.equal(attempts, 120);
});

test("RPC readiness without an executable expected program times out", async () => {
  const { waitForValidatorReadiness } = await supervisorModule;
  const clock = fakeClock();
  await assert.rejects(
    waitForValidatorReadiness({
      child: child(),
      timeoutMs: 30_000,
      pollIntervalMs: 250,
      now: clock.now,
      sleep: clock.sleep,
      probe: async () => ({
        blockhash: "11111111111111111111111111111111",
        programExecutable: false,
        programAccountResult: "present but not executable",
      }),
    }),
    (error) => error.code === "LOCAL_VALIDATOR_START_TIMEOUT" &&
      error.lastBlockhashError === null &&
      error.lastProgramAccountResult === "present but not executable",
  );
});

test("Model A command preloads the program exactly once", async () => {
  const { buildValidatorCommand } = await supervisorModule;
  const command = buildValidatorCommand({
    executable: "solana-test-validator",
    ledgerPath: "C:/repo/.tmp/local-validator/ledger",
    port: 8899,
    payerAddress: "payer",
    payerAccountPath: "C:/repo/.tmp/test-payer-account.json",
    programId: "program",
    programPath: "C:/repo/target/deploy/program.so",
    logPath: "C:/repo/.tmp/local-validator/validator.log",
  });

  assert.equal(command.executable, "solana-test-validator");
  assert.equal(command.args.filter((value) => value === "--bpf-program").length, 1);
  assert.deepEqual(
    command.args.slice(command.args.indexOf("--bpf-program"), command.args.indexOf("--bpf-program") + 3),
    ["--bpf-program", "program", "C:/repo/target/deploy/program.so"],
  );
  assert.equal(command.shell, false);
});

test("the existing Anchor integration script is the only test command after readiness", async () => {
  const { buildIntegrationTestCommand } = await supervisorModule;
  assert.deepEqual(buildIntegrationTestCommand(), testCommand());
  assert.equal(buildIntegrationTestCommand().args.includes("anchor"), false);
});

test("supervision starts one validator and runs tests only after readiness", async () => {
  const { superviseLocalValidator } = await supervisorModule;
  const harness = lifecycleAdapters();
  const result = await superviseLocalValidator({
    validatorCommand: validatorCommand(),
    testCommand: testCommand(),
    startupTimeoutMs: 30_000,
    pollIntervalMs: 250,
  }, harness.adapters);

  assert.equal(harness.calls.filter((entry) => entry === "spawn").length, 1);
  assert.deepEqual(harness.calls.slice(0, 3), [
    "spawn",
    "ready",
    ["tests", testCommand()],
  ]);
  assert.equal(result.exitCode, 0);
});

test("startup diagnostics contain bounded actionable lifecycle evidence", async () => {
  const { formatValidatorDiagnostics } = await supervisorModule;
  const diagnostics = formatValidatorDiagnostics({
    phase: "readiness",
    command: validatorCommand(),
    child: child({ exitCode: 1, signalCode: "SIGABRT" }),
    elapsedMs: 5_000,
    timeoutMs: 30_000,
    lastBlockhashError: "connection refused",
    lastProgramAccountResult: "account unavailable",
    logTail: "TAIL-CANARY",
    cleanupResult: { ok: true, portFree: true },
  });

  for (const expected of [
    "phase: readiness",
    "solana-test-validator",
    "pid: 4242",
    "port: 8899",
    "ledger: C:/repo/.tmp/local-validator/ledger",
    "elapsed: 5000 ms",
    "timeout: 30000 ms",
    "connection refused",
    "account unavailable",
    "TAIL-CANARY",
    "cleanup",
  ]) {
    assert.match(diagnostics, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("cleanup runs after successful integration tests", async () => {
  const { superviseLocalValidator } = await supervisorModule;
  const harness = lifecycleAdapters();
  const result = await superviseLocalValidator({
    validatorCommand: validatorCommand(),
    testCommand: testCommand(),
    startupTimeoutMs: 30_000,
    pollIntervalMs: 250,
  }, harness.adapters);

  assert.deepEqual(harness.calls.at(-1), ["cleanup", 4242]);
  assert.equal(result.exitCode, 0);
});

test("cleanup runs after integration test failure and preserves its exit code", async () => {
  const { superviseLocalValidator } = await supervisorModule;
  const harness = lifecycleAdapters({
    runTests: async () => {
      harness.calls.push("tests-failed");
      return { exitCode: 17, signal: null };
    },
  });
  const result = await superviseLocalValidator({
    validatorCommand: validatorCommand(),
    testCommand: testCommand(),
    startupTimeoutMs: 30_000,
    pollIntervalMs: 250,
  }, harness.adapters);

  assert.deepEqual(harness.calls.at(-1), ["cleanup", 4242]);
  assert.equal(result.exitCode, 17);
});

test("cleanup and diagnostics run after startup timeout", async () => {
  const { superviseLocalValidator } = await supervisorModule;
  const timeout = Object.assign(new Error("startup timeout"), {
    code: "LOCAL_VALIDATOR_START_TIMEOUT",
    elapsedMs: 30_000,
    lastBlockhashError: "connection refused",
    lastProgramAccountResult: "account unavailable",
  });
  const harness = lifecycleAdapters({
    waitForReadiness: async () => {
      harness.calls.push("ready-timeout");
      throw timeout;
    },
  });
  const result = await superviseLocalValidator({
    validatorCommand: validatorCommand(),
    testCommand: testCommand(),
    startupTimeoutMs: 30_000,
    pollIntervalMs: 250,
  }, harness.adapters);

  assert.ok(harness.calls.some((entry) =>
    Array.isArray(entry) && entry[0] === "cleanup" && entry[1] === 4242));
  assert.ok(harness.calls.includes("diagnostics"));
  assert.ok(harness.calls.includes("write-diagnostic"));
  assert.equal(result.exitCode, 1);
});

test("owned-tree cleanup never targets an unrelated process", async () => {
  const { cleanupOwnedProcessTree } = await supervisorModule;
  const targetedPids = [];
  const result = await cleanupOwnedProcessTree(child({ pid: 4242 }), {
    terminateTree: async (pid) => targetedPids.push(pid),
    waitForExit: async () => ({ exitCode: 0, signal: "SIGTERM" }),
    isPortFree: async () => true,
    port: 8899,
  });

  assert.deepEqual(targetedPids, [4242]);
  assert.equal(targetedPids.includes(5252), false);
  assert.equal(result.portFree, true);
});

test("owned-tree cleanup waits for child close before checking port release", async () => {
  const { cleanupOwnedProcessTree } = await supervisorModule;
  const ownedChild = Object.assign(new EventEmitter(), child());
  const lifecycle = [];
  const result = await cleanupOwnedProcessTree(ownedChild, {
    terminateTree: async () => {
      lifecycle.push("terminate");
      setImmediate(() => {
        ownedChild.exitCode = 0;
        lifecycle.push("close");
        ownedChild.emit("close", 0, null);
      });
    },
    isPortFree: async () => {
      lifecycle.push("port");
      return ownedChild.exitCode === 0;
    },
    port: 8899,
  });

  assert.deepEqual(lifecycle, ["terminate", "close", "port"]);
  assert.equal(result.ok, true);
});

test("cleanup failure changes only an otherwise successful exit status", async () => {
  const { superviseLocalValidator } = await supervisorModule;
  for (const testExitCode of [0, 23]) {
    const harness = lifecycleAdapters({
      runTests: async () => ({ exitCode: testExitCode, signal: null }),
      cleanupOwnedProcessTree: async () => ({ ok: false, portFree: false }),
    });
    const result = await superviseLocalValidator({
      validatorCommand: validatorCommand(),
      testCommand: testCommand(),
      startupTimeoutMs: 30_000,
      pollIntervalMs: 250,
    }, harness.adapters);
    assert.equal(result.exitCode, testExitCode === 0 ? 1 : testExitCode);
  }
});

test("PowerShell delegates lifecycle ownership to the shared Node runner", () => {
  const script = readFileSync(resolve(root, "scripts/test-local.ps1"), "utf8");
  assert.match(script, /local-validator-supervisor\.mjs/);
  assert.doesNotMatch(script, /Start-Process|Stop-Process|solana-test-validator|getHealth/);
});

test("CI uses the supervisor and uploads the complete failure log with bounded retention", () => {
  const workflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /node scripts\/local-validator-supervisor\.mjs/);
  assert.doesNotMatch(workflow, /run:\s*anchor test --skip-build\s*$/m);
  assert.match(workflow, /if:\s*failure\(\)/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /\.tmp\/local-validator\/validator\.log/);
  assert.match(workflow, /retention-days:\s*[1-9]\d*/);
});
