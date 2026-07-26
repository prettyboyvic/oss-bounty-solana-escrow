import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const STARTUP_TIMEOUT_MS = 30_000;
export const READINESS_POLL_INTERVAL_MS = 250;
const RPC_REQUEST_TIMEOUT_MS = 1_000;
const CLEANUP_TIMEOUT_MS = 5_000;
const LOG_TAIL_BYTES = 64 * 1024;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DIRECTORY = resolve(REPO_ROOT, ".tmp/local-validator");
const LEDGER_PATH = resolve(RUNTIME_DIRECTORY, "ledger");
export const VALIDATOR_LOG_PATH = resolve(
  RUNTIME_DIRECTORY,
  "validator.log",
);
const PAYER_ACCOUNT_PATH = resolve(REPO_ROOT, ".tmp/test-payer-account.json");

let activeValidator = null;
let activeTestProcess = null;
let interruptCleanup = null;
let interruptExitCode = null;

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assertOwnedRuntimePath(path) {
  const pathFromRuntime = relative(RUNTIME_DIRECTORY, resolve(path));
  if (
    pathFromRuntime === "" ||
    pathFromRuntime.startsWith("..") ||
    resolve(pathFromRuntime) === pathFromRuntime
  ) {
    throw new Error(`refusing non-child local-validator runtime path: ${path}`);
  }
}

function sanitizeArgument(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]/g, "?");
}

function quoteArgument(value) {
  const sanitized = sanitizeArgument(value);
  return /^[A-Za-z0-9_./:\\-]+$/.test(sanitized)
    ? sanitized
    : JSON.stringify(sanitized);
}

function commandText(command) {
  return [
    quoteArgument(command.executable),
    ...command.args.map(quoteArgument),
  ].join(" ");
}

function readinessError(code, message, details) {
  return Object.assign(new Error(message), { code, ...details });
}

export function buildValidatorCommand({
  executable = "solana-test-validator",
  ledgerPath,
  port,
  payerAddress,
  payerAccountPath,
  programId,
  programPath,
  logPath,
}) {
  if (
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    !ledgerPath ||
    !payerAddress ||
    !payerAccountPath ||
    !programId ||
    !programPath ||
    !logPath
  ) {
    throw new Error("complete local-validator command inputs are required");
  }
  return Object.freeze({
    executable,
    args: Object.freeze([
      "--reset",
      "--ledger", ledgerPath,
      "--bind-address", "127.0.0.1",
      "--rpc-port", String(port),
      "--account", payerAddress, payerAccountPath,
      "--bpf-program", programId, programPath,
      "--quiet",
    ]),
    shell: false,
    port,
    ledgerPath,
    logPath,
  });
}

export function buildIntegrationTestCommand() {
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

export async function waitForValidatorReadiness({
  child,
  timeoutMs,
  pollIntervalMs,
  probe,
  now = Date.now,
  sleep: pacedSleep = sleep,
}) {
  const startedAt = now();
  let attempts = 0;
  let lastBlockhashError = null;
  let lastProgramAccountResult = null;

  while (now() - startedAt < timeoutMs) {
    const elapsedMs = now() - startedAt;
    if (
      child.supervisorSpawnError ||
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      throw readinessError(
        "LOCAL_VALIDATOR_EXITED",
        child.supervisorSpawnError
          ? `local validator spawn failed: ${errorMessage(child.supervisorSpawnError)}`
          : "local validator exited before readiness",
        {
          elapsedMs,
          exitCode: child.exitCode,
          signal: child.signalCode,
          lastBlockhashError,
          lastProgramAccountResult,
        },
      );
    }

    attempts += 1;
    try {
      const result = await probe();
      lastBlockhashError = null;
      lastProgramAccountResult = result.programAccountResult;
      if (result.blockhash && result.programExecutable === true) {
        return Object.freeze({
          attempts,
          elapsedMs,
          blockhash: result.blockhash,
          programExecutable: true,
          lastProgramAccountResult,
        });
      }
    } catch (error) {
      lastBlockhashError = errorMessage(error);
    }

    const remainingMs = timeoutMs - (now() - startedAt);
    if (remainingMs > 0) {
      await pacedSleep(Math.min(pollIntervalMs, remainingMs));
    }
  }

  throw readinessError(
    "LOCAL_VALIDATOR_START_TIMEOUT",
    "local validator did not become ready before the startup timeout",
    {
      elapsedMs: now() - startedAt,
      attempts,
      lastBlockhashError,
      lastProgramAccountResult,
    },
  );
}

function processStatus(child) {
  if (!child) return "not spawned";
  if (child.exitCode !== null) return `exited (${child.exitCode})`;
  if (child.signalCode !== null) return `signaled (${child.signalCode})`;
  if (child.supervisorSpawnError) {
    return `spawn error (${errorMessage(child.supervisorSpawnError)})`;
  }
  return "running";
}

export function formatValidatorDiagnostics({
  phase,
  command,
  child,
  elapsedMs,
  timeoutMs,
  lastBlockhashError,
  lastProgramAccountResult,
  logTail,
  cleanupResult,
}) {
  return [
    "----- local validator diagnostics -----",
    `phase: ${phase}`,
    `command: ${commandText(command)}`,
    `pid: ${child?.pid ?? "unavailable"}`,
    `process status: ${processStatus(child)}`,
    `exit code: ${child?.exitCode ?? "null"}`,
    `signal: ${child?.signalCode ?? "null"}`,
    `port: ${command.port}`,
    `ledger: ${sanitizeArgument(command.ledgerPath)}`,
    `elapsed: ${elapsedMs} ms`,
    `timeout: ${timeoutMs} ms`,
    `last blockhash RPC error: ${lastBlockhashError ?? "none"}`,
    `last program-account result: ${lastProgramAccountResult ?? "unavailable"}`,
    `cleanup: ${JSON.stringify(cleanupResult)}`,
    `validator log tail (maximum ${LOG_TAIL_BYTES} bytes):`,
    logTail || "<empty>",
    "----- end local validator diagnostics -----",
  ].join("\n");
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      child.removeListener("close", onClose);
      resolvePromise(false);
    }, timeoutMs);
    const onClose = () => {
      clearTimeout(timeout);
      resolvePromise(true);
    };
    child.once("close", onClose);
  });
}

function signalOwnedPosixGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function terminateOwnedTree(child) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: CLEANUP_TIMEOUT_MS,
    });
    return;
  }
  signalOwnedPosixGroup(child.pid, "SIGTERM");
  if (!(await waitForChildExit(child, CLEANUP_TIMEOUT_MS))) {
    signalOwnedPosixGroup(child.pid, "SIGKILL");
    await waitForChildExit(child, CLEANUP_TIMEOUT_MS);
  }
}

function checkPortFree(port) {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolvePromise(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolvePromise(true));
    });
  });
}

async function waitForPortFree(port) {
  const deadline = Date.now() + CLEANUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await checkPortFree(port)) return true;
    await sleep(100);
  }
  return checkPortFree(port);
}

export async function cleanupOwnedProcessTree(child, {
  terminateTree = async () => terminateOwnedTree(child),
  waitForExit = async () => {
    await waitForChildExit(child, CLEANUP_TIMEOUT_MS);
    return {
      exitCode: child.exitCode,
      signal: child.signalCode,
    };
  },
  isPortFree = waitForPortFree,
  port,
} = {}) {
  if (!child?.pid) {
    return Object.freeze({
      ok: true,
      portFree: await isPortFree(port),
      exitCode: child?.exitCode ?? null,
      signal: child?.signalCode ?? null,
    });
  }
  try {
    await terminateTree(child.pid);
    const status = await waitForExit(child);
    const portFree = await isPortFree(port);
    return Object.freeze({
      ok: portFree,
      portFree,
      exitCode: status.exitCode ?? child.exitCode ?? null,
      signal: status.signal ?? child.signalCode ?? null,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      portFree: await isPortFree(port).catch(() => false),
      exitCode: child.exitCode,
      signal: child.signalCode,
      error: errorMessage(error),
    });
  }
}

function boundedLogTail(path) {
  if (!existsSync(path)) return "<log file unavailable>";
  const bytes = readFileSync(path);
  return bytes.subarray(Math.max(0, bytes.length - LOG_TAIL_BYTES)).toString("utf8");
}

async function defaultRpcProbe({ rpcUrl, programId }) {
  let rpcId = 0;
  const request = async (method, params) => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++rpcId,
        method,
        params,
      }),
      signal: AbortSignal.timeout(RPC_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error) {
      throw new Error(`${method} RPC ${payload.error.code}: ${payload.error.message}`);
    }
    return payload.result;
  };

  const latest = await request("getLatestBlockhash", [{
    commitment: "confirmed",
  }]);
  if (
    typeof latest?.value?.blockhash !== "string" ||
    !Number.isSafeInteger(latest?.value?.lastValidBlockHeight)
  ) {
    throw new Error("getLatestBlockhash returned an unusable response");
  }

  try {
    const account = await request("getAccountInfo", [
      programId,
      { commitment: "confirmed", encoding: "base64" },
    ]);
    return {
      blockhash: latest.value.blockhash,
      programExecutable: account?.value?.executable === true,
      programAccountResult: account?.value == null
        ? "account unavailable"
        : account.value.executable === true
          ? "executable"
          : "present but not executable",
    };
  } catch (error) {
    return {
      blockhash: latest.value.blockhash,
      programExecutable: false,
      programAccountResult: `RPC error: ${errorMessage(error)}`,
    };
  }
}

function runChildCommand(command, options = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command.executable, command.args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ANCHOR_PROVIDER_URL: "http://127.0.0.1:8899",
        ANCHOR_WALLET: resolve(REPO_ROOT, ".tmp/anchor-test-wallet.json"),
      },
      stdio: "inherit",
      windowsHide: true,
      detached: process.platform !== "win32",
      shell: false,
      ...options,
    });
    activeTestProcess = child;
    child.once("error", (error) => {
      activeTestProcess = null;
      resolvePromise({ exitCode: 1, signal: null, error: errorMessage(error) });
    });
    child.once("close", (exitCode, signal) => {
      activeTestProcess = null;
      resolvePromise({ exitCode: exitCode ?? 1, signal });
    });
  });
}

export async function superviseLocalValidator(config, adapters) {
  let ownedChild = null;
  let readiness = null;
  let testResult = null;
  let startupFailure = null;
  let cleanupResult = null;

  try {
    ownedChild = adapters.spawnValidator(config.validatorCommand);
    readiness = await adapters.waitForReadiness({
      child: ownedChild,
      timeoutMs: config.startupTimeoutMs,
      pollIntervalMs: config.pollIntervalMs,
    });
    testResult = await adapters.runTests(config.testCommand);
  } catch (error) {
    startupFailure = error;
  } finally {
    cleanupResult = await adapters.cleanupOwnedProcessTree(ownedChild, {
      port: config.validatorCommand.port,
    });
  }

  if (startupFailure) {
    const diagnostic = await adapters.renderDiagnostics({
      phase: startupFailure.code === "LOCAL_VALIDATOR_EXITED"
        ? "early-exit"
        : "readiness",
      command: config.validatorCommand,
      child: ownedChild,
      elapsedMs: startupFailure.elapsedMs ?? 0,
      timeoutMs: config.startupTimeoutMs,
      lastBlockhashError: startupFailure.lastBlockhashError ?? null,
      lastProgramAccountResult:
        startupFailure.lastProgramAccountResult ?? null,
      cleanupResult,
    });
    adapters.writeDiagnostic(diagnostic);
    return Object.freeze({
      exitCode: 1,
      validatorPid: ownedChild?.pid ?? null,
      validatorSpawnCount: ownedChild ? 1 : 0,
      readiness: null,
      cleanupResult,
      startupFailure: startupFailure.code ?? "LOCAL_VALIDATOR_START_FAILED",
    });
  }

  const originalTestExitCode = testResult?.exitCode ?? 1;
  return Object.freeze({
    exitCode: originalTestExitCode === 0 && !cleanupResult.ok
      ? 1
      : originalTestExitCode,
    validatorPid: ownedChild.pid,
    validatorSpawnCount: 1,
    readiness,
    cleanupResult,
    testSignal: testResult?.signal ?? null,
  });
}

function spawnValidator(command) {
  const logDescriptor = openSync(command.logPath, "a");
  const child = spawn(command.executable, command.args, {
    cwd: REPO_ROOT,
    stdio: ["ignore", logDescriptor, logDescriptor],
    windowsHide: true,
    detached: process.platform !== "win32",
    shell: false,
  });
  closeSync(logDescriptor);
  child.supervisorSpawnError = null;
  child.once("error", (error) => {
    child.supervisorSpawnError = error;
  });
  activeValidator = child;
  process.stdout.write(
    `LOCAL_VALIDATOR_SPAWN pid=${child.pid ?? "unavailable"} port=${command.port} ` +
    `ledger=${command.ledgerPath} command=${commandText(command)}\n`,
  );
  return child;
}

function parseArgs(argv) {
  if (
    argv.length !== 4 ||
    argv[0] !== "--program" ||
    !argv[1] ||
    argv[2] !== "--program-id" ||
    !argv[3]
  ) {
    throw new Error(
      "usage: node scripts/local-validator-supervisor.mjs " +
      "--program <program.so> --program-id <public-key>",
    );
  }
  return {
    programPath: resolve(REPO_ROOT, argv[1]),
    programId: argv[3],
  };
}

function prepareRuntime() {
  assertOwnedRuntimePath(LEDGER_PATH);
  assertOwnedRuntimePath(VALIDATOR_LOG_PATH);
  mkdirSync(RUNTIME_DIRECTORY, { recursive: true });
  rmSync(LEDGER_PATH, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
  rmSync(VALIDATOR_LOG_PATH, { force: true });
}

function cleanupRuntime({ keepLog }) {
  assertOwnedRuntimePath(LEDGER_PATH);
  assertOwnedRuntimePath(VALIDATOR_LOG_PATH);
  rmSync(LEDGER_PATH, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
  if (!keepLog) rmSync(VALIDATOR_LOG_PATH, { force: true });
}

async function terminateActiveChildren() {
  if (activeTestProcess?.pid) {
    await cleanupOwnedProcessTree(activeTestProcess, {
      port: null,
      isPortFree: async () => true,
    });
    activeTestProcess = null;
  }
  if (activeValidator?.pid) {
    await cleanupOwnedProcessTree(activeValidator, { port: 8899 });
    activeValidator = null;
  }
}

function installInterruptHandlers() {
  const handlers = new Map();
  for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    const handler = () => {
      if (interruptCleanup) return;
      interruptExitCode = exitCode;
      interruptCleanup = terminateActiveChildren()
        .finally(() => {
          process.exitCode = exitCode;
        });
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) {
      process.removeListener(signal, handler);
    }
  };
}

async function main() {
  const { programPath, programId } = parseArgs(process.argv.slice(2));
  if (!existsSync(programPath)) {
    throw new Error(`missing SBF program artifact: ${programPath}`);
  }
  if (!existsSync(PAYER_ACCOUNT_PATH)) {
    throw new Error(`missing local test payer account: ${PAYER_ACCOUNT_PATH}`);
  }
  const payerFixture = JSON.parse(readFileSync(PAYER_ACCOUNT_PATH, "utf8"));
  const config = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "config/devnet.json"), "utf8"),
  );
  if (programId !== config.programId) {
    throw new Error("local validator program ID does not match config/devnet.json");
  }
  prepareRuntime();
  if (!(await checkPortFree(8899))) {
    throw new Error(
      "local validator RPC port 8899 is already in use; no process was terminated",
    );
  }

  const validatorCommand = buildValidatorCommand({
    ledgerPath: LEDGER_PATH,
    port: 8899,
    payerAddress: payerFixture.pubkey,
    payerAccountPath: PAYER_ACCOUNT_PATH,
    programId,
    programPath,
    logPath: VALIDATOR_LOG_PATH,
  });
  const removeInterruptHandlers = installInterruptHandlers();
  const result = await superviseLocalValidator({
    validatorCommand,
    testCommand: buildIntegrationTestCommand(),
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
    pollIntervalMs: READINESS_POLL_INTERVAL_MS,
  }, {
    spawnValidator,
    waitForReadiness: (input) => waitForValidatorReadiness({
      ...input,
      probe: () => defaultRpcProbe({
        rpcUrl: `http://127.0.0.1:${validatorCommand.port}`,
        programId,
      }),
    }),
    runTests: runChildCommand,
    cleanupOwnedProcessTree: async (child, options) => {
      const cleanup = await cleanupOwnedProcessTree(child, options);
      activeValidator = null;
      return cleanup;
    },
    renderDiagnostics: async (input) => formatValidatorDiagnostics({
      ...input,
      logTail: boundedLogTail(VALIDATOR_LOG_PATH),
    }),
    writeDiagnostic: (diagnostic) => process.stderr.write(`${diagnostic}\n`),
  });
  removeInterruptHandlers();

  if (interruptCleanup) await interruptCleanup;
  if (result.readiness) {
    process.stdout.write(
      `LOCAL_VALIDATOR_READY pid=${result.validatorPid} ` +
      `elapsedMs=${result.readiness.elapsedMs} attempts=${result.readiness.attempts} ` +
      "programExecutable=true\n",
    );
  }
  process.stdout.write(
    `LOCAL_VALIDATOR_CLEANUP pid=${result.validatorPid ?? "unavailable"} ` +
    `ok=${result.cleanupResult.ok} portFree=${result.cleanupResult.portFree}\n`,
  );
  cleanupRuntime({ keepLog: result.exitCode !== 0 });
  process.exitCode = interruptExitCode ?? result.exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`LOCAL_VALIDATOR_SUPERVISOR_ERROR ${errorMessage(error)}\n`);
    cleanupRuntime({ keepLog: existsSync(VALIDATOR_LOG_PATH) });
    process.exitCode = 1;
  }
}
