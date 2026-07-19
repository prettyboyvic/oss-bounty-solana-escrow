import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";

import { PLAN_UPLOAD_IDENTITIES } from "../../scripts/devnet/plan-upload-command.mjs";
import { createPlanFingerprint } from "../../scripts/devnet/throttled-uploader.mjs";
import { planBufferUpload } from "../../scripts/devnet/upload-plan.mjs";
import {
  encodeBase58,
  executeUploadWindow,
  preflightUploadExecution,
} from "../../scripts/devnet/upload-execution-command.mjs";
import { leasePaths } from "../../scripts/devnet/upload-execution-lease.mjs";

const RPC = "https://api.devnet.solana.com";
const GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const OWNER = "BPFLoaderUpgradeab1e11111111111111111111111";
const METADATA_LENGTH = 37;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function bufferAccount(programBytes, overrides = {}) {
  const data = Buffer.alloc(METADATA_LENGTH + programBytes.length);
  data.writeUInt32LE(1, 0);
  data[4] = 1;
  new PublicKey(overrides.authority ?? PLAN_UPLOAD_IDENTITIES.authority).toBuffer().copy(data, 5);
  Buffer.from(programBytes).copy(data, METADATA_LENGTH);
  return {
    data,
    owner: new PublicKey(overrides.owner ?? OWNER),
    executable: false,
    lamports: 1,
    rentEpoch: 0,
  };
}

function fixture({ chunks = 2, status = "PLANNED", balance } = {}) {
  const root = mkdtempSync(join(tmpdir(), "upload-execution-"));
  const statePath = join(root, "state.json");
  const binaryPath = join(root, "program.so");
  const authorityPath = join(root, "authority.json");
  const localBytes = Buffer.from(Array.from({ length: chunks * 1011 }, (_, index) => (index % 250) + 1));
  const currentBytes = Buffer.alloc(localBytes.length);
  const plan = planBufferUpload({
    localBytes,
    bufferBytes: currentBytes,
    buffer: new PublicKey(PLAN_UPLOAD_IDENTITIES.buffer),
    authority: new PublicKey(PLAN_UPLOAD_IDENTITIES.authority),
  });
  assert.equal(plan.totalChunks, chunks);
  const allocation = localBytes.length + METADATA_LENGTH;
  const fingerprint = createPlanFingerprint({
    program: PLAN_UPLOAD_IDENTITIES.program,
    buffer: PLAN_UPLOAD_IDENTITIES.buffer,
    authority: PLAN_UPLOAD_IDENTITIES.authority,
    allocation,
    binarySha256: sha256(localBytes),
    maxPayload: plan.maxPayload,
    chunks: plan.chunks,
  });
  const records = plan.chunks.map(({ index, offset, length, sha256: chunkSha256 }) => ({
    index,
    offset,
    length,
    sha256: chunkSha256,
    status,
    signature: status === "PLANNED" ? null : `existing-signature-${index}`,
  }));
  const state = {
    schemaVersion: 3,
    identities: { program: PLAN_UPLOAD_IDENTITIES.program },
    deployment: {
      buffer: {
        publicKey: PLAN_UPLOAD_IDENTITIES.buffer,
        expectedOwner: OWNER,
        expectedAuthority: PLAN_UPLOAD_IDENTITIES.authority,
        allocatedLength: allocation,
        localBinary: { length: localBytes.length, sha256: sha256(localBytes) },
        planFingerprint: fingerprint,
        chunks: records,
        uploadWindows: [],
      },
    },
  };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  writeFileSync(binaryPath, localBytes);
  writeFileSync(authorityPath, "test-only-placeholder");
  const account = bufferAccount(currentBytes);
  const calls = [];
  const rpc = {
    rpcEndpoint: RPC,
    getGenesisHash: async () => { calls.push("genesis"); return GENESIS; },
    getAccountInfo: async (key) => {
      const address = key.toBase58();
      calls.push(address === PLAN_UPLOAD_IDENTITIES.program ? "program" : "buffer");
      return address === PLAN_UPLOAD_IDENTITIES.program ? null : account;
    },
    getBalance: async () => { calls.push("balance"); return balance ?? 10_000_000_000; },
    getMinimumBalanceForRentExemption: async (length) => { calls.push(`rent:${length}`); return length === 36 ? 100 : 200; },
  };
  const request = {
    command: "upload-buffer-throttled",
    url: RPC,
    program: PLAN_UPLOAD_IDENTITIES.program,
    buffer: PLAN_UPLOAD_IDENTITIES.buffer,
    statePath,
    authorityPath,
    binaryPath,
    maxChunks: 5,
    delayMs: 1000,
    acknowledgement: "R4_BUFFER_UPLOAD",
  };
  return { root, statePath, binaryPath, authorityPath, localBytes, currentBytes, account, rpc, calls, request, state, plan, fingerprint, allocation };
}

test("preflight validates ordered read-only invariants without signer, blockhash or send", async () => {
  const input = fixture();
  const forbidden = [];
  const result = await preflightUploadExecution(input.request, {
    rpc: input.rpc,
    loadAuthorityKeypair: () => forbidden.push("signer"),
    getLatestBlockhash: () => forbidden.push("blockhash"),
    sendRawTransaction: () => forbidden.push("send"),
  });
  assert.deepEqual(input.calls, ["genesis", "program", "buffer", "balance", "rent:36", `rent:${45 + input.localBytes.length}`]);
  assert.deepEqual(forbidden, []);
  assert.equal(result.plan.remainingChunks, 2);
  assert.equal(result.funding.operationalReserveLamports, 250_000_000);
  assert.equal(result.liveWriteExecuted, false);
  assert.equal(existsSync(leasePaths(input.statePath).activeDirectory), false);
});

test("funding exact boundary passes, one lamport short blocks, and malformed rent fails closed", async () => {
  const required = 100 + 200 + (2 * 10_000) + 10_000 + 250_000_000;
  const exact = fixture({ balance: required });
  assert.equal((await preflightUploadExecution(exact.request, { rpc: exact.rpc })).funding.status, "SUFFICIENT");
  const short = fixture({ balance: required - 1 });
  await assert.rejects(preflightUploadExecution(short.request, { rpc: short.rpc }), /BLOCKED_FUNDING/);
  const malformed = fixture();
  malformed.rpc.getMinimumBalanceForRentExemption = async () => -1;
  await assert.rejects(preflightUploadExecution(malformed.request, { rpc: malformed.rpc }), /nonnegative safe integer/);
});

test("preflight rejects wrong genesis, existing program, buffer metadata, state identity and fingerprint", async () => {
  const cases = [
    (input) => { input.rpc.getGenesisHash = async () => "wrong"; },
    (input) => { input.rpc.getAccountInfo = async (key) => key.toBase58() === PLAN_UPLOAD_IDENTITIES.program ? { data: Buffer.alloc(36) } : input.account; },
    (input) => { input.account.owner = new PublicKey(PLAN_UPLOAD_IDENTITIES.program); },
    (input) => { const state = JSON.parse(readFileSync(input.statePath)); state.deployment.buffer.expectedAuthority = PLAN_UPLOAD_IDENTITIES.program; writeFileSync(input.statePath, JSON.stringify(state)); },
    (input) => { const state = JSON.parse(readFileSync(input.statePath)); state.deployment.buffer.planFingerprint = "0".repeat(64); writeFileSync(input.statePath, JSON.stringify(state)); },
  ];
  for (const mutate of cases) {
    const input = fixture();
    mutate(input);
    await assert.rejects(preflightUploadExecution(input.request, { rpc: input.rpc }), /mismatch|UNEXPECTED_EXISTING_PROGRAM|fingerprint/);
    assert.equal(existsSync(leasePaths(input.statePath).activeDirectory), false);
  }
});

test("execution persists SENT and locally derived signature before sending each transaction", async () => {
  const input = fixture({ chunks: 2 });
  const lifecycle = [];
  let inFlight = 0;
  let maximumInFlight = 0;
  const result = await executeUploadWindow(input.request, {
    rpc: input.rpc,
    executionId: () => "window-persist-before-send",
    pid: 9001,
    hostname: "test-host",
    now: () => "2026-07-19T00:00:00.000Z",
    loadAuthorityKeypair: async () => { lifecycle.push("load-signer"); return { publicKey: new PublicKey(PLAN_UPLOAD_IDENTITIES.authority) }; },
    getLatestBlockhash: async () => { lifecycle.push("blockhash"); return { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }; },
    buildAndSign: async ({ chunk }) => { lifecycle.push(`sign:${chunk.index}`); return { signature: `signature-${chunk.index}`, rawTransaction: Buffer.from([chunk.index]) }; },
    sendRawTransaction: async (_raw, chunk) => {
      lifecycle.push(`send:${chunk.index}`);
      const record = JSON.parse(readFileSync(input.statePath)).deployment.buffer.chunks[chunk.index];
      assert.equal(record.status, "SENT");
      assert.equal(record.signature, `signature-${chunk.index}`);
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
    },
    confirmSignature: async (_signature, _timeout, _signed, chunk) => { lifecycle.push(`confirm:${chunk.index}`); inFlight -= 1; return { err: null }; },
    readChunkMatches: async (chunk) => { lifecycle.push(`match:${chunk.index}`); return true; },
    sleep: async (ms) => { lifecycle.push(`sleep:${ms}`); },
  });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.liveWriteExecuted, true);
  assert.equal(result.liveWriteAttempted, true);
  assert.equal(result.leaseLifecycle, "RECONCILIATION_REQUIRED");
  assert.equal(maximumInFlight, 1);
  assert.equal(lifecycle.filter((item) => item === "blockhash").length, 2);
  for (const index of [0, 1]) {
    assert.ok(lifecycle.indexOf(`sign:${index}`) < lifecycle.indexOf(`send:${index}`));
    assert.ok(lifecycle.indexOf(`send:${index}`) < lifecycle.indexOf(`confirm:${index}`));
    assert.ok(lifecycle.indexOf(`confirm:${index}`) < lifecycle.indexOf(`match:${index}`));
  }
  const state = JSON.parse(readFileSync(input.statePath));
  assert.deepEqual(state.deployment.buffer.chunks.map(({ status }) => status), ["CONFIRMED", "CONFIRMED"]);
  assert.equal(state.deployment.buffer.uploadWindows[0].terminal, true);
  assert.equal(existsSync(leasePaths(input.statePath).activeDirectory), true);
});

test("five-chunk ceiling is absolute and exact skipped chunks do not consume it", async () => {
  const input = fixture({ chunks: 6 });
  const sent = [];
  const result = await executeUploadWindow(input.request, {
    rpc: input.rpc,
    executionId: () => "window-five",
    pid: 9002,
    hostname: "test-host",
    now: () => "2026-07-19T00:00:00.000Z",
    loadAuthorityKeypair: async () => ({ publicKey: new PublicKey(PLAN_UPLOAD_IDENTITIES.authority) }),
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
    buildAndSign: async ({ chunk }) => ({ signature: `signature-${chunk.index}`, rawTransaction: Buffer.from([chunk.index]) }),
    sendRawTransaction: async (_raw, chunk) => { sent.push(chunk.index); },
    confirmSignature: async () => ({ err: null }),
    readChunkMatches: async () => true,
    sleep: async () => {},
  });
  assert.equal(result.status, "WINDOW_LIMIT");
  assert.deepEqual(sent, [0, 1, 2, 3, 4]);
  assert.equal(JSON.parse(readFileSync(input.statePath)).deployment.buffer.chunks[5].status, "PLANNED");
});

test("existing SENT or UNKNOWN is reconciled before signer and unresolved evidence stops", async () => {
  for (const status of ["SENT", "UNKNOWN"]) {
    const input = fixture({ chunks: 1, status });
    const calls = [];
    const result = await executeUploadWindow(input.request, {
      rpc: input.rpc,
      executionId: () => `window-${status}`,
      pid: status === "SENT" ? 9003 : 9004,
      hostname: "test-host",
      now: () => "2026-07-19T00:00:00.000Z",
      confirmSignature: async () => { calls.push("reconcile-signature"); return null; },
      readChunkMatches: async () => { calls.push("reconcile-bytes"); return false; },
      loadAuthorityKeypair: async () => { calls.push("signer"); throw new Error("must not load signer"); },
      getLatestBlockhash: async () => { calls.push("blockhash"); throw new Error("must not fetch blockhash"); },
      sendRawTransaction: async () => { calls.push("send"); },
      sleep: async () => {},
    });
    assert.equal(result.status, "UNKNOWN");
    assert.deepEqual(calls, ["reconcile-signature", "reconcile-bytes"]);
  }
});

test("first 429, confirmed failure and exact chunk mismatch stop without lifecycle calls", async () => {
  const scenarios = [
    { name: "429", send: async () => { throw new Error("429 Too Many Requests"); }, confirm: async () => ({ err: null }), match: async () => true, expected: "RATE_LIMITED" },
    { name: "failure", send: async () => {}, confirm: async () => ({ err: { InstructionError: [0, "InvalidAccountData"] } }), match: async () => false, expected: "CONFIRMED_FAILURE" },
    { name: "mismatch", send: async () => {}, confirm: async () => ({ err: null }), match: async () => false, expected: "UNKNOWN" },
  ];
  for (const scenario of scenarios) {
    const input = fixture({ chunks: 2 });
    let sends = 0;
    const result = await executeUploadWindow(input.request, {
      rpc: input.rpc,
      executionId: () => `window-${scenario.name}`,
      pid: 9100 + sends,
      hostname: "test-host",
      now: () => "2026-07-19T00:00:00.000Z",
      loadAuthorityKeypair: async () => ({ publicKey: new PublicKey(PLAN_UPLOAD_IDENTITIES.authority) }),
      getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
      buildAndSign: async ({ chunk }) => ({ signature: `signature-${chunk.index}`, rawTransaction: Buffer.from([chunk.index]) }),
      sendRawTransaction: async (...args) => { sends += 1; return scenario.send(...args); },
      confirmSignature: scenario.confirm,
      readChunkMatches: scenario.match,
      sleep: async () => {},
      finalize: () => { throw new Error("forbidden finalize"); },
      closeBuffer: () => { throw new Error("forbidden close"); },
      regenerateBuffer: () => { throw new Error("forbidden regenerate"); },
    });
    assert.equal(result.status, scenario.expected);
    assert.equal(sends, 1);
    assert.equal(result.liveWriteAttempted, true);
    assert.equal(result.liveWriteExecuted, null);
  }
});

test("transaction signatures use canonical base58 encoding", async () => {
  const { default: bs58 } = await import("bs58");
  for (const bytes of [Buffer.alloc(64), Buffer.from(Array.from({ length: 64 }, (_, index) => index))]) {
    assert.equal(encodeBase58(bytes), bs58.encode(bytes));
  }
});

test("wrong signer stops before blockhash/send and persists a sanitized terminal outcome", async () => {
  const input = fixture({ chunks: 1 });
  const calls = [];
  await assert.rejects(executeUploadWindow(input.request, {
    rpc: input.rpc,
    executionId: () => "window-wrong-signer",
    pid: 9201,
    hostname: "test-host",
    now: () => "2026-07-19T00:00:00.000Z",
    loadAuthorityKeypair: async () => ({ publicKey: new PublicKey(PLAN_UPLOAD_IDENTITIES.program) }),
    getLatestBlockhash: async () => { calls.push("blockhash"); },
    sendRawTransaction: async () => { calls.push("send"); },
    confirmSignature: async () => null,
    readChunkMatches: async () => false,
    sleep: async () => {},
  }), /signer mismatch/);
  assert.deepEqual(calls, []);
  assert.equal(JSON.parse(readFileSync(input.statePath)).deployment.buffer.uploadWindows[0].status, "SIGNER_MISMATCH");
});

test("ambiguous non-429 send error remains SENT and persists RPC_OUTCOME_UNKNOWN", async () => {
  const input = fixture({ chunks: 2 });
  let sends = 0;
  await assert.rejects(executeUploadWindow(input.request, {
    rpc: input.rpc,
    executionId: () => "window-rpc-unknown",
    pid: 9202,
    hostname: "test-host",
    now: () => "2026-07-19T00:00:00.000Z",
    loadAuthorityKeypair: async () => ({ publicKey: new PublicKey(PLAN_UPLOAD_IDENTITIES.authority) }),
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
    buildAndSign: async ({ chunk }) => ({ signature: `signature-${chunk.index}`, rawTransaction: Buffer.from([chunk.index]) }),
    sendRawTransaction: async () => { sends += 1; throw new Error("transport disconnected with raw details"); },
    confirmSignature: async () => null,
    readChunkMatches: async () => false,
    sleep: async () => {},
  }), /transport disconnected/);
  const state = JSON.parse(readFileSync(input.statePath));
  assert.equal(sends, 1);
  assert.equal(state.deployment.buffer.chunks[0].status, "SENT");
  assert.equal(state.deployment.buffer.chunks[1].status, "PLANNED");
  assert.equal(state.deployment.buffer.uploadWindows[0].status, "RPC_OUTCOME_UNKNOWN");
  assert.doesNotMatch(JSON.stringify(state.deployment.buffer.uploadWindows[0]), /raw details|transport disconnected/);
});
