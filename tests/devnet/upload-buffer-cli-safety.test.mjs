import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createRpcRequestLedger } from "../../scripts/devnet/rpc-request-ledger.mjs";
import { main, sanitizeCliErrorMessage } from "../../scripts/devnet/upload-buffer-cli.mjs";

const ENTRY = fileURLToPath(new URL("../../scripts/devnet/upload-buffer-cli.mjs", import.meta.url));
const ENTRY_URL = pathToFileURL(ENTRY).href;
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RATE_LIMITED = { code: "RPC_RATE_LIMITED", retryable: false, terminal: true };
const COMMAND_FAILED = { code: "COMMAND_FAILED_SAFE", retryable: false, terminal: true };

function publicFileSnapshot(path) {
  if (!existsSync(path)) return { exists: false };
  const stat = statSync(path, { bigint: true });
  return {
    exists: true,
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}

function runColdImport(importUrl, cwd) {
  const probe = String.raw`
    import fs from "node:fs";
    import fsPromises from "node:fs/promises";
    import http from "node:http";
    import https from "node:https";
    import net from "node:net";
    import tls from "node:tls";
    import dgram from "node:dgram";
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";

    const forbidden = (name) => (..._args) => { throw new Error("FORBIDDEN_IMPORT_CAPABILITY:" + name); };
    const replace = (target, names, prefix) => {
      for (const name of names) {
        const descriptor = Object.getOwnPropertyDescriptor(target, name);
        if (typeof target[name] === "function" && (descriptor?.writable || descriptor?.set)) {
          target[name] = forbidden(prefix + "." + name);
        }
      }
    };
    const fileMutations = [
      "appendFile", "appendFileSync", "chmod", "chmodSync", "chown", "chownSync",
      "copyFile", "copyFileSync", "cp", "cpSync", "createWriteStream", "link", "linkSync",
      "mkdir", "mkdirSync", "mkdtemp", "mkdtempSync", "rename", "renameSync", "rm", "rmSync",
      "rmdir", "rmdirSync", "symlink", "symlinkSync", "truncate", "truncateSync", "unlink",
      "unlinkSync", "utimes", "utimesSync", "write", "writeFile", "writeFileSync", "writeSync",
      "writev", "writevSync",
    ];
    replace(fs, fileMutations, "fs");
    replace(fsPromises, fileMutations, "fsPromises");
    const sensitiveRuntimePath = /(?:^|[\\/])\.devnet(?:[\\/]|$)|(?:^|[\\/])\.config[\\/]solana(?:[\\/]|$)|(?:^|[\\/])(?:state|[^\\/]*(?:authority|keypair)[^\\/]*)\.json$|(?:^|[\\/])solana[\\/]cli[\\/]config\.ya?ml$|\.so$/i;
    const guardReads = (target, names, prefix) => {
      for (const name of names) {
        const original = target[name];
        const descriptor = Object.getOwnPropertyDescriptor(target, name);
        if (typeof original === "function" && (descriptor?.writable || descriptor?.set)) {
          target[name] = (...args) => {
            if (sensitiveRuntimePath.test(String(args[0]))) {
              throw new Error("FORBIDDEN_IMPORT_CAPABILITY:" + prefix + "." + name);
            }
            return original.apply(target, args);
          };
        }
      }
    };
    guardReads(fs, ["access", "accessSync", "createReadStream", "existsSync", "open", "openSync", "readFile", "readFileSync", "readdir", "readdirSync"], "fs");
    guardReads(fsPromises, ["access", "open", "readFile", "readdir"], "fsPromises");
    replace(http, ["get", "request"], "http");
    replace(https, ["get", "request"], "https");
    replace(net, ["connect", "createConnection", "createServer"], "net");
    replace(tls, ["connect", "createServer"], "tls");
    replace(dgram, ["createSocket"], "dgram");
    replace(childProcess, ["exec", "execFile", "execFileSync", "execSync", "fork", "spawn", "spawnSync"], "childProcess");
    syncBuiltinESMExports();

    globalThis.fetch = forbidden("global.fetch");
    if (typeof globalThis.WebSocket === "function") globalThis.WebSocket = forbidden("global.WebSocket");
    const before = JSON.stringify({
      argv: process.argv,
      cwd: process.cwd(),
      env: Object.entries(process.env).sort(([left], [right]) => left.localeCompare(right)),
      execArgv: process.execArgv,
      exitCode: process.exitCode ?? null,
      title: process.title,
    });
    await import(process.env.UPLOAD_CLI_IMPORT_URL);
    const after = JSON.stringify({
      argv: process.argv,
      cwd: process.cwd(),
      env: Object.entries(process.env).sort(([left], [right]) => left.localeCompare(right)),
      execArgv: process.execArgv,
      exitCode: process.exitCode ?? null,
      title: process.title,
    });
    if (after !== before) throw new Error("FORBIDDEN_IMPORT_PROCESS_MUTATION");
    process.stdout.write("IMPORT_OK\n");
  `;
  return spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, UPLOAD_CLI_IMPORT_URL: importUrl },
    timeout: 10_000,
  });
}

test("cold-importing the public live CLI has no filesystem, RPC or process side effects", () => {
  const dir = mkdtempSync(join(tmpdir(), "upload-cli-import-"));
  const statePath = join(REPO_ROOT, ".devnet", "state.json");
  const leasePath = `${statePath}.upload-lease`;
  const publicProofPaths = [statePath, join(leasePath, "lease.json")];
  try {
    const before = {
      cwdFiles: readdirSync(dir),
      leaseFiles: existsSync(leasePath) ? readdirSync(leasePath).sort() : null,
      publicFiles: publicProofPaths.map(publicFileSnapshot),
    };
    const filesystemCanary = runColdImport(
      `data:text/javascript,${encodeURIComponent('import { writeFileSync } from "node:fs"; writeFileSync("IMPORT_SIDE_EFFECT", "forbidden");')}`,
      dir,
    );
    assert.notEqual(filesystemCanary.status, 0);
    assert.match(filesystemCanary.stderr, /FORBIDDEN_IMPORT_CAPABILITY:fs\.writeFileSync/);
    const signerReadCanary = runColdImport(
      `data:text/javascript,${encodeURIComponent('import { readFileSync } from "node:fs"; readFileSync(".devnet/authority-keypair.json");')}`,
      dir,
    );
    assert.notEqual(signerReadCanary.status, 0);
    assert.match(signerReadCanary.stderr, /FORBIDDEN_IMPORT_CAPABILITY:fs\.readFileSync/);
    const rpcCanary = runColdImport(
      `data:text/javascript,${encodeURIComponent('await fetch("https://rpc.invalid");')}`,
      dir,
    );
    assert.notEqual(rpcCanary.status, 0);
    assert.match(rpcCanary.stderr, /FORBIDDEN_IMPORT_CAPABILITY:global\.fetch/);
    const result = runColdImport(ENTRY_URL, dir);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "IMPORT_OK\n");
    assert.equal(result.stderr, "");
    assert.deepEqual({
      cwdFiles: readdirSync(dir),
      leaseFiles: existsSync(leasePath) ? readdirSync(leasePath).sort() : null,
      publicFiles: publicProofPaths.map(publicFileSnapshot),
    }, before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing acknowledgement fails before config, signer, blockhash or send access", async () => {
  const calls = [];
  const dependencies = new Proxy({}, {
    get(_target, property) {
      if (property === "repoRoot") return "D:/repo";
      return (...args) => {
        calls.push([property, args]);
        throw new Error(`forbidden dependency ${String(property)}`);
      };
    },
  });
  await assert.rejects(
    main([
      "upload-buffer-throttled",
      "--url", "https://api.devnet.solana.com",
      "--program", "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z",
      "--buffer", "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW",
      "--state", ".devnet/state.json",
      "--authority", ".devnet/authority.json",
      "--max-chunks", "5",
      "--delay-ms", "1000",
    ], dependencies),
    /acknowledgement/,
  );
  assert.deepEqual(calls, []);
});

test("environment variables and global Solana paths cannot enable or fill live arguments", async () => {
  const prior = { ...process.env };
  process.env.ENABLE_LIVE_UPLOAD = "1";
  process.env.SOLANA_CONFIG_FILE = "C:\\secret\\config.yml";
  try {
    await assert.rejects(main(["upload-buffer-throttled"], {}), /required/);
  } finally {
    process.env = prior;
  }
});

test("public command dispatch preserves read-only and local-only authority boundaries", async () => {
  const calls = [];
  const repoRoot = join(tmpdir(), "upload-cli-dispatch-root");
  const common = {
    repoRoot,
    isIgnoredPath: () => true,
    inspectStateMigration: async (request) => { calls.push(["inspect", request.command]); return { stateMutation: false }; },
    migrateStateV3: async (request) => { calls.push(["migrate", request.command]); return { stateMutation: true }; },
    reconcileUploadLease: async (request) => { calls.push(["reconcile", request.command, request.binaryPath]); return { stateMutation: false, onchainWrite: false }; },
    applyUploadReconciliation: async (request) => { calls.push(["apply", request.command, request.binaryPath]); return { stateMutation: true, onchainWrite: false }; },
    releaseUploadLease: async (request) => { calls.push(["release", request.command, request.binaryPath]); return { stateMutation: true, onchainWrite: false }; },
  };
  await main(["inspect-state-migration", "--state", ".devnet/state.json", "--binary", "target/program.so"], common);
  await main(["migrate-state-v3", "--state", ".devnet/state.json", "--binary", "target/program.so", "--acknowledge-state-migration", "R4_MIGRATE_STATE_V3"], common);
  await main(["reconcile-upload-lease", "--url", "https://api.devnet.solana.com", "--program", "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z", "--buffer", "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW", "--state", ".devnet/state.json", "--binary", "target/program.so", "--execution-id", "execution-1"], common);
  await main(["apply-upload-reconciliation", "--url", "https://api.devnet.solana.com", "--program", "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z", "--buffer", "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW", "--state", ".devnet/state.json", "--binary", "target/program.so", "--execution-id", "execution-1", "--reconciliation-hash", "a".repeat(64), "--acknowledge-upload-reconciliation", "R4_APPLY_UPLOAD_RECONCILIATION"], common);
  await main(["release-upload-lease", "--url", "https://api.devnet.solana.com", "--program", "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z", "--buffer", "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW", "--state", ".devnet/state.json", "--binary", "target/program.so", "--execution-id", "execution-1", "--reconciliation-hash", "a".repeat(64), "--acknowledge-lease-release", "R4_RELEASE_UPLOAD_LEASE"], common);
  assert.deepEqual(calls, [
    ["inspect", "inspect-state-migration"],
    ["migrate", "migrate-state-v3"],
    ["reconcile", "reconcile-upload-lease", join(repoRoot, "target/program.so")],
    ["apply", "apply-upload-reconciliation", join(repoRoot, "target/program.so")],
    ["release", "release-upload-lease", join(repoRoot, "target/program.so")],
  ]);
});

test("apply dispatch touches only its local-mutation dependency and passes exact resolved paths", async () => {
  const accesses = [];
  const repoRoot = join(tmpdir(), "upload-cli-apply-root");
  const target = {
    repoRoot,
    isIgnoredPath: () => true,
    applyUploadReconciliation: async (request) => {
      assert.equal(request.command, "apply-upload-reconciliation");
      assert.equal(request.statePath, join(repoRoot, ".devnet/state.json"));
      assert.equal(request.binaryPath, join(repoRoot, "target/program.so"));
      assert.equal(request.reconciliationHash, "a".repeat(64));
      assert.equal(request.acknowledgement, "R4_APPLY_UPLOAD_RECONCILIATION");
      return { command: request.command, stateMutation: true, onchainWrite: false };
    },
  };
  const dependencies = new Proxy(target, {
    get(object, property) {
      accesses.push(property);
      if (!Object.hasOwn(object, property)) throw new Error(`forbidden dependency access: ${String(property)}`);
      return object[property];
    },
  });
  const result = await main([
    "apply-upload-reconciliation",
    "--url", "https://api.devnet.solana.com",
    "--program", "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z",
    "--buffer", "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW",
    "--state", ".devnet/state.json",
    "--binary", "target/program.so",
    "--execution-id", "execution-1",
    "--reconciliation-hash", "a".repeat(64),
    "--acknowledge-upload-reconciliation", "R4_APPLY_UPLOAD_RECONCILIATION",
  ], dependencies);
  assert.deepEqual(result, { command: "apply-upload-reconciliation", stateMutation: true, onchainWrite: false });
  assert.deepEqual(accesses, ["repoRoot", "isIgnoredPath", "applyUploadReconciliation"]);
});

test("successful resume output preserves sixteen or more public skipped chunk indexes", async () => {
  const skippedIndexes = Array.from({ length: 20 }, (_, index) => index);
  const rpcRequestSummary = createRpcRequestLedger().summary();
  const result = await main([
    "upload-buffer-throttled",
    "--url", "https://api.devnet.solana.com",
    "--program", "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z",
    "--buffer", "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW",
    "--state", ".devnet/state.json",
    "--authority", ".devnet/authority.json",
    "--max-chunks", "5",
    "--delay-ms", "1000",
    "--acknowledge-devnet-write", "R4_BUFFER_UPLOAD",
  ], {
    repoRoot: join(tmpdir(), "upload-cli-resume-root"),
    isIgnoredPath: () => true,
    executionDependencies: {},
    executeUploadWindow: async () => ({
      command: "upload-buffer-throttled",
      executionId: "resume-public-index-output",
      status: "COMPLETE",
      processed: 0,
      sent: 0,
      confirmedIndexes: [],
      skippedIndexes,
      leaseLifecycle: "RECONCILIATION_REQUIRED",
      liveWriteAttempted: false,
      liveWriteExecuted: false,
      stateMutation: true,
      rpcRequestSummary,
    }),
  });
  assert.deepEqual(result.skippedIndexes, skippedIndexes);
  assert.deepEqual(result.rpcRequestSummary, rpcRequestSummary);
});

test("classifies message, structured, nested and body-backed 429 errors without retaining RPC details", () => {
  const cases = [
    new Error('429 Too Many Requests: {"jsonrpc":"2.0","error":{"code":429,"data":{"requestId":"CANARY-MESSAGE"}}}'),
    { message: "request failed", status: 429 },
    { message: "request failed", error: { code: 429 } },
    { message: "request failed", data: { error: { code: 429, data: { requestId: "CANARY-DATA" } } } },
    {
      message: "request failed",
      response: {
        status: 429,
        body: '{"error":{"message":"rate limited","requestId":"CANARY-BODY"}}',
        headers: {
          authorization: "Bearer CANARY-AUTHORIZATION",
          "x-request-id": "CANARY-HEADER",
        },
      },
    },
  ];
  for (const error of cases) {
    assert.deepEqual(sanitizeCliErrorMessage(error), RATE_LIMITED);
    assert.doesNotMatch(JSON.stringify(sanitizeCliErrorMessage(error)), /CANARY|authorization|requestId/i);
  }
});

test("ledger-backed RPC errors expose only safe method classification", async () => {
  const ticks = [10, 12];
  const ledger = createRpcRequestLedger({ monotonicNow: () => ticks.shift() });
  let error;
  try {
    await ledger.record({
      methodClass: "GET_ACCOUNT_INFO",
      retryNumber: 0,
      signaturePersisted: false,
      mutationCapability: "read",
    }, async () => {
      throw { status: 429, body: "CANARY-BODY", headers: { authorization: "CANARY-TOKEN" } };
    });
  } catch (caught) {
    error = caught;
  }

  const output = sanitizeCliErrorMessage(error);
  assert.deepEqual(output, {
    classification: "RPC_RATE_LIMITED",
    methodClass: "GET_ACCOUNT_INFO",
    sequence: 1,
    signaturePersisted: false,
  });
  assert.doesNotMatch(JSON.stringify(output), /CANARY|body|header|authorization/i);
});

test("rate-limit inspection is cycle safe", () => {
  const error = { message: "request failed" };
  error.cause = error;
  assert.deepEqual(sanitizeCliErrorMessage(error), COMMAND_FAILED);
  error.data = { response: { statusCode: 429 } };
  assert.deepEqual(sanitizeCliErrorMessage(error), RATE_LIMITED);
});

test("does not misclassify unrelated 429 text or negated rate-limit language", () => {
  for (const error of [
    new Error("local chunk 429 failed checksum"),
    new Error("request is not rate limited"),
    { response: { status: 500, body: "diagnostic counter 429" } },
  ]) {
    assert.deepEqual(sanitizeCliErrorMessage(error), COMMAND_FAILED);
  }
});

test("fails closed without retaining bodies, headers, credentials, transactions, keys or mnemonic text", () => {
  const cases = [
    new Error("RPC failed at https://rpc.example.invalid/?api-key=CANARY-CREDENTIAL"),
    new Error("cannot read C:\\secret\\authority-keypair.json"),
    { message: "request failed", data: { keyBytes: Array.from({ length: 32 }, (_, index) => index) } },
    new Error(`invalid private key [${Array.from({ length: 64 }, (_, index) => index).join(",")}]`),
    { message: "request failed", data: { mnemonic: "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu" } },
    { message: "request failed", data: { rawTransaction: Uint8Array.from({ length: 96 }, (_, index) => index) } },
    {
      message: "HTTP request failed",
      response: {
        body: '{"error":{"data":{"requestId":"CANARY-RESPONSE-BODY"}}}',
        headers: { authorization: "Bearer CANARY-HEADER-TOKEN", "x-request-id": "CANARY-REQUEST-ID" },
      },
    },
  ];
  for (const error of cases) {
    assert.deepEqual(sanitizeCliErrorMessage(error), COMMAND_FAILED);
    assert.doesNotMatch(JSON.stringify(sanitizeCliErrorMessage(error)), /CANARY|mnemonic|rawTransaction|private key/i);
  }
});

test("direct CLI stderr is only the JSON terminal classification", () => {
  const result = spawnSync(process.execPath, [ENTRY], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `${JSON.stringify(COMMAND_FAILED)}\n`);
});
