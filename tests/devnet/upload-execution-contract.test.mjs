import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  LIVE_UPLOAD_ACKNOWLEDGEMENT,
  sanitizeExecutionOutput,
  parseUploadCommand,
  parseRuntimeCommand,
  validateUploadRequest,
} from "../../scripts/devnet/upload-execution-contract.mjs";

const RPC = "https://api.devnet.solana.com";
const PROGRAM = "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z";
const BUFFER = "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW";

function argv(overrides = {}) {
  const values = {
    url: RPC,
    program: PROGRAM,
    buffer: BUFFER,
    state: ".devnet/state.json",
    authority: ".devnet/authority.json",
    "max-chunks": "5",
    "delay-ms": "1000",
    "acknowledge-devnet-write": "R4_BUFFER_UPLOAD",
    ...overrides,
  };
  return [
    "upload-buffer-throttled",
    ...Object.entries(values).flatMap(([key, value]) => [`--${key}`, value]),
  ];
}

test("requires the complete explicit live-upload contract and literal acknowledgement", () => {
  const parsed = parseUploadCommand(argv());
  assert.equal(parsed.command, "upload-buffer-throttled");
  assert.equal(parsed.url, RPC);
  assert.equal(parsed.program, PROGRAM);
  assert.equal(parsed.buffer, BUFFER);
  assert.equal(parsed.maxChunks, 5);
  assert.equal(parsed.delayMs, 1000);
  assert.equal(parsed.acknowledgement, LIVE_UPLOAD_ACKNOWLEDGEMENT);

  for (const key of ["url", "program", "buffer", "state", "authority", "max-chunks", "delay-ms", "acknowledge-devnet-write"]) {
    const input = argv();
    input.splice(input.indexOf(`--${key}`), 2);
    assert.throws(() => parseUploadCommand(input), /required|acknowledgement/);
  }
  assert.throws(() => parseUploadCommand(argv({ "acknowledge-devnet-write": "yes" })), /acknowledgement/);
  assert.throws(() => parseUploadCommand([...argv(), "--hidden-enable", "1"]), /unknown argument/);
});

test("parses only the approved public migration and lease commands", () => {
  assert.deepEqual(parseRuntimeCommand(["inspect-state-migration", "--state", ".devnet/state.json", "--binary", "target/program.so"]), {
    command: "inspect-state-migration", state: ".devnet/state.json", binary: "target/program.so",
  });
  assert.equal(parseRuntimeCommand(["migrate-state-v3", "--state", ".devnet/state.json", "--binary", "target/program.so", "--acknowledge-state-migration", "R4_MIGRATE_STATE_V3"]).acknowledgement, "R4_MIGRATE_STATE_V3");
  const reconcile = parseRuntimeCommand(["reconcile-upload-lease", "--url", RPC, "--program", PROGRAM, "--buffer", BUFFER, "--state", ".devnet/state.json", "--execution-id", "execution-1"]);
  assert.equal(reconcile.executionId, "execution-1");
  const release = parseRuntimeCommand(["release-upload-lease", "--url", RPC, "--program", PROGRAM, "--buffer", BUFFER, "--state", ".devnet/state.json", "--execution-id", "execution-1", "--reconciliation-hash", "a".repeat(64), "--acknowledge-lease-release", "R4_RELEASE_UPLOAD_LEASE"]);
  assert.equal(release.reconciliationHash, "a".repeat(64));
  assert.equal(release.acknowledgement, "R4_RELEASE_UPLOAD_LEASE");
  assert.throws(() => parseRuntimeCommand(["release-upload-lease", "--url", RPC]), /required/);
  assert.throws(() => parseRuntimeCommand(["clear-upload-lease"]), /public command/);
});

test("rejects alternate clusters, credentialized URLs and alternate public identities", () => {
  for (const url of [
    "https://api.mainnet-beta.solana.com",
    "https://api.testnet.solana.com",
    "http://localhost:8899",
    "https://user:pass@api.devnet.solana.com",
    "https://example.com",
  ]) {
    assert.throws(() => parseUploadCommand(argv({ url })), /devnet RPC|credentials/);
  }
  assert.throws(() => parseUploadCommand(argv({ program: BUFFER })), /program/);
  assert.throws(() => parseUploadCommand(argv({ buffer: PROGRAM })), /buffer/);
});

test("enforces the first-window hard rate policy", () => {
  for (const value of ["0", "6", "-1", "1.5", "Infinity"]) {
    assert.throws(() => parseUploadCommand(argv({ "max-chunks": value })), /maxChunks/);
  }
  for (const value of ["0", "999", "-1", "1.5", "Infinity"]) {
    assert.throws(() => parseUploadCommand(argv({ "delay-ms": value })), /delayMs/);
  }
  assert.equal(parseUploadCommand(argv({ "max-chunks": "1", "delay-ms": "1000" })).maxChunks, 1);
});

test("validates explicit ignored paths without reading global config or signer files", () => {
  const calls = [];
  const repoRoot = resolve("test-repo-root");
  const request = validateUploadRequest(parseUploadCommand(argv()), {
    repoRoot,
    isIgnoredPath(path) {
      calls.push(path);
      return path.includes(".devnet");
    },
  });
  assert.equal(request.statePath, resolve(repoRoot, ".devnet/state.json"));
  assert.equal(request.authorityPath, resolve(repoRoot, ".devnet/authority.json"));
  assert.equal(calls.length, 2);
  assert.throws(() => validateUploadRequest(parseUploadCommand(argv({ state: "state.json" })), { repoRoot, isIgnoredPath: () => false }), /ignored/);
});

test("rejects every secret-bearing output shape instead of redacting it ambiguously", () => {
  for (const value of [
    { mnemonic: "words" },
    { nested: { secretKey: [1, 2, 3] } },
    { signedTransaction: "raw-bytes" },
    { bytes: Array.from({ length: 64 }, (_, index) => index) },
  ]) {
    assert.throws(() => sanitizeExecutionOutput(value), /secret-bearing output/);
  }
  assert.deepEqual(sanitizeExecutionOutput({ status: "SAFE", signature: "public-signature" }), { status: "SAFE", signature: "public-signature" });
});
