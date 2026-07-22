import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import * as uploadExecutionContract from "../../scripts/devnet/upload-execution-contract.mjs";
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

function leaseArgv(command, overrides = {}) {
  const values = {
    url: RPC,
    program: PROGRAM,
    buffer: BUFFER,
    state: ".devnet/state.json",
    binary: "target/program.so",
    "execution-id": "execution-1",
    ...(command === "release-upload-lease" ? {
      "reconciliation-hash": "a".repeat(64),
      "acknowledge-lease-release": "R4_RELEASE_UPLOAD_LEASE",
    } : {}),
    ...(command === "apply-upload-reconciliation" ? {
      "reconciliation-hash": "a".repeat(64),
      "acknowledge-upload-reconciliation": "R4_APPLY_UPLOAD_RECONCILIATION",
    } : {}),
    ...overrides,
  };
  return [command, ...Object.entries(values).flatMap(([key, value]) => [`--${key}`, value])];
}

function withoutOption(argv, key) {
  const copy = [...argv];
  copy.splice(copy.indexOf(`--${key}`), 2);
  return copy;
}

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
  const reconcile = parseRuntimeCommand(leaseArgv("reconcile-upload-lease"));
  assert.equal(reconcile.executionId, "execution-1");
  assert.equal(reconcile.binary, "target/program.so");
  const apply = parseRuntimeCommand(leaseArgv("apply-upload-reconciliation"));
  assert.equal(apply.command, "apply-upload-reconciliation");
  assert.equal(apply.binary, "target/program.so");
  assert.equal(apply.reconciliationHash, "a".repeat(64));
  assert.equal(apply.acknowledgement, "R4_APPLY_UPLOAD_RECONCILIATION");
  assert.equal(uploadExecutionContract.APPLY_RECONCILIATION_ACKNOWLEDGEMENT, "R4_APPLY_UPLOAD_RECONCILIATION");
  const release = parseRuntimeCommand(leaseArgv("release-upload-lease"));
  assert.equal(release.reconciliationHash, "a".repeat(64));
  assert.equal(release.acknowledgement, "R4_RELEASE_UPLOAD_LEASE");
  assert.equal(release.binary, "target/program.so");
  assert.throws(() => parseRuntimeCommand(["release-upload-lease", "--url", RPC]), /required/);
  assert.throws(() => parseRuntimeCommand(["clear-upload-lease"]), /public command/);
});

test("requires the binary path for reconcile, apply and release", () => {
  for (const command of ["reconcile-upload-lease", "apply-upload-reconciliation", "release-upload-lease"]) {
    assert.throws(() => parseRuntimeCommand(withoutOption(leaseArgv(command), "binary")), /--binary/);
  }
});

test("requires the literal apply acknowledgement and exact apply options", () => {
  assert.throws(
    () => parseRuntimeCommand(leaseArgv("apply-upload-reconciliation", { "acknowledge-upload-reconciliation": "yes" })),
    /acknowledgement/,
  );
  assert.throws(
    () => parseRuntimeCommand(withoutOption(leaseArgv("apply-upload-reconciliation"), "acknowledge-upload-reconciliation")),
    /acknowledgement|required/,
  );
  assert.throws(
    () => parseRuntimeCommand([...leaseArgv("apply-upload-reconciliation"), "--hidden-enable", "1"]),
    /unknown argument/,
  );
  assert.throws(
    () => parseRuntimeCommand([...leaseArgv("apply-upload-reconciliation"), "--binary", "other.so"]),
    /duplicate argument/,
  );
});

test("rejects unsafe or overlong execution IDs", () => {
  for (const executionId of [".", "..", "../escape", "..\\escape", "nested/path", "nested\\path", "line\nbreak", "a".repeat(129)]) {
    for (const command of ["reconcile-upload-lease", "apply-upload-reconciliation", "release-upload-lease"]) {
      assert.throws(() => parseRuntimeCommand(leaseArgv(command, { "execution-id": executionId })), /execution ID/);
    }
  }
  assert.equal(parseRuntimeCommand(leaseArgv("reconcile-upload-lease", { "execution-id": "a".repeat(128) })).executionId.length, 128);
});

test("requires canonical lowercase reconciliation hashes", () => {
  for (const command of ["apply-upload-reconciliation", "release-upload-lease"]) {
    assert.throws(
      () => parseRuntimeCommand(leaseArgv(command, { "reconciliation-hash": "A".repeat(64) })),
      /lowercase reconciliation hash/,
    );
  }
});

test("requires the exact canonical RPC and identities for every lease command", () => {
  for (const command of ["reconcile-upload-lease", "apply-upload-reconciliation", "release-upload-lease"]) {
    assert.throws(() => parseRuntimeCommand(leaseArgv(command, { url: `${RPC}/` })), /exact devnet RPC/);
    assert.throws(() => parseRuntimeCommand(leaseArgv(command, { program: BUFFER })), /program/);
    assert.throws(() => parseRuntimeCommand(leaseArgv(command, { buffer: PROGRAM })), /buffer/);
  }
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
    { nested: { private_key: [1, 2, 3] } },
    { signedTransaction: "raw-bytes" },
    { serialized_transaction: "A".repeat(120) },
    { bytes: Array.from({ length: 64 }, (_, index) => index) },
    { details: "https://user:password@rpc.invalid/?api-key=CANARY" },
    { rpc_url: "wss://rpc.invalid/?api-key=CANARY" },
    { response: { body: "CANARY-RPC-BODY", headers: { authorization: "Bearer CANARY" } } },
    { responseBody: "CANARY-RPC-BODY" },
    { requestId: "CANARY-REQUEST-ID" },
    { request_id: "CANARY-REQUEST-ID" },
    { payload: Uint8Array.from({ length: 32 }, (_, index) => index) },
    { payload: Buffer.from(Array.from({ length: 96 }, (_, index) => index)) },
    { details: "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu" },
    { authorityPath: ".devnet/authority-keypair.json" },
    { details: "\\\\server\\share\\authority-keypair.json" },
    { details: "~/.config/solana/id.json" },
    "C:\\secret\\authority-keypair.json",
  ]) {
    assert.throws(() => sanitizeExecutionOutput(value), /secret-bearing output/);
  }
  const publicResult = {
    command: "reconcile-upload-lease",
    result: "SAFE_TO_RELEASE",
    lifecycle: "SAFE_TO_RELEASE",
    executionId: "execution-1",
    releaseReady: false,
    preStateSha256: "a".repeat(64),
    stateSha256: "a".repeat(64),
    leaseSha256: "b".repeat(64),
    onchainEvidenceFingerprint: "c".repeat(64),
    evidenceHash: "d".repeat(64),
    verifiedTransactions: [{ chunkIndex: 222, signature: "public-signature", slot: 123, feeLamports: 5_000 }],
    proposedTransitions: [{ chunkIndex: 222, from: "SENT", to: "CONFIRMED", signature: "public-signature" }],
    stateMutation: false,
    onchainWrite: false,
  };
  assert.deepEqual(sanitizeExecutionOutput(publicResult), publicResult);

  const uploadResult = {
    command: "upload-buffer-throttled",
    executionId: "policy-schema",
    status: "COMPLETE",
    processed: 0,
    sent: 0,
    confirmedIndexes: [],
    skippedIndexes: [],
    leaseLifecycle: "RECONCILIATION_REQUIRED",
    liveWriteAttempted: false,
    liveWriteExecuted: false,
    stateMutation: true,
    rpcRequestPolicy: {
      globalRequestStartGapMs: 500,
      confirmationPollIntervalMs: 2000,
      rateLimitRetryScheduleMs: [2000, 5000],
      rawMethod: "CANARY",
    },
  };
  assert.throws(() => sanitizeExecutionOutput(uploadResult), /secret-bearing output/);
});

test("sanitized upload confirmation telemetry is exact, ordered and backward compatible", () => {
  const historical = {
    command: "upload-buffer-throttled",
    executionId: "historical-window",
    status: "COMPLETE",
    processed: 1,
    sent: 1,
    confirmedIndexes: [4],
    skippedIndexes: [],
    leaseLifecycle: "RECONCILIATION_REQUIRED",
    liveWriteAttempted: true,
    liveWriteExecuted: true,
    stateMutation: true,
  };
  assert.deepEqual(sanitizeExecutionOutput(historical), historical);

  const current = {
    ...historical,
    executionId: "current-window",
    confirmedIndexes: [4, 5],
    processed: 2,
    sent: 2,
    confirmations: [
      { chunkIndex: 4, confirmationDurationMs: 0 },
      { chunkIndex: 5, confirmationDurationMs: 12_345 },
    ],
  };
  assert.deepEqual(sanitizeExecutionOutput(current), current);

  for (const confirmations of [
    [{ chunkIndex: 4, confirmationDurationMs: -1 }, { chunkIndex: 5, confirmationDurationMs: 12_345 }],
    [{ chunkIndex: 4, confirmationDurationMs: 0.5 }, { chunkIndex: 5, confirmationDurationMs: 12_345 }],
    [{ chunkIndex: 5, confirmationDurationMs: 1 }, { chunkIndex: 4, confirmationDurationMs: 2 }],
    [{ chunkIndex: 4, confirmationDurationMs: 1 }, { chunkIndex: 4, confirmationDurationMs: 2 }],
    [{ chunkIndex: 4, confirmationDurationMs: 1 }],
    [{ chunkIndex: 4, confirmationDurationMs: 1, extra: true }, { chunkIndex: 5, confirmationDurationMs: 2 }],
  ]) {
    assert.throws(() => sanitizeExecutionOutput({ ...current, confirmations }), /secret-bearing output/);
  }
});
