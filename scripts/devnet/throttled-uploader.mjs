import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  migrateState,
  saveStateAtomic,
  validateChunkRecords,
} from "./state.mjs";

const DEFAULT_POLICY = Object.freeze({ concurrency: 1, minimumDelayMs: 1000, maxChunksPerWindow: 5, maxRateLimitEvents: 1, confirmationTimeoutMs: 30000, readRetries: 3, readRetryDelayMs: 500 });
const CHUNK_TRANSITIONS = Object.freeze({
  PLANNED: new Set(["SENT", "CONFIRMED"]),
  SENT: new Set(["CONFIRMED", "FAILED", "UNKNOWN"]),
  UNKNOWN: new Set(["CONFIRMED", "FAILED", "UNKNOWN"]),
  CONFIRMED: new Set(["CONFIRMED"]),
  FAILED: new Set(["FAILED"]),
});

export function assertChunkTransition(from, to) {
  if (!CHUNK_TRANSITIONS[from]?.has(to)) {
    throw new Error(`invalid chunk transition ${from} -> ${to}`);
  }
  return true;
}

export function normalizeRatePolicy(input) {
  const policy = { ...DEFAULT_POLICY, ...input };
  if (policy.concurrency !== 1 || !Number.isInteger(policy.minimumDelayMs) || policy.minimumDelayMs <= 0 || !Number.isInteger(policy.maxChunksPerWindow) || policy.maxChunksPerWindow < 1 || !Number.isInteger(policy.maxRateLimitEvents) || policy.maxRateLimitEvents !== 1 || !Number.isInteger(policy.confirmationTimeoutMs) || policy.confirmationTimeoutMs < 1 || !Number.isInteger(policy.readRetries) || policy.readRetries < 1 || !Number.isInteger(policy.readRetryDelayMs) || policy.readRetryDelayMs < 1) throw new Error("unsafe throttled uploader policy");
  return policy;
}

export function reconcileChunk({ signatureStatus, chunkMatches, expired }) {
  if (signatureStatus?.err) return "CONFIRMED_FAILURE";
  if (chunkMatches && (expired || signatureStatus?.confirmationStatus === "finalized")) return "CONFIRMED";
  if (!signatureStatus && expired) return "UNKNOWN";
  return "UNKNOWN";
}

export async function runSequentialUpload({ chunks, policy: policyInput, persist, sign, send, confirm, readChunkMatches, sleep }) {
  const policy = normalizeRatePolicy(policyInput);
  let processed = 0;
  let sent = 0;
  const confirmedIndexes = [];
  const skippedIndexes = [];
  for (const chunk of chunks) {
    if (chunk.exactMatch) { skippedIndexes.push(chunk.index); continue; }
    if (processed >= policy.maxChunksPerWindow) return { status: "WINDOW_LIMIT", processed, sent, confirmedIndexes, skippedIndexes };
    const signed = await sign(chunk);
    if (!signed?.signature) throw new Error("signer did not return a public signature");
    await persist({ status: "SENT", index: chunk.index, signature: signed.signature });
    try { await send(signed, chunk); } catch (error) {
      if (error?.classification === "RPC_RATE_LIMITED" || /\b429\b|too many requests/i.test(String(error?.message))) {
        return { status: "RATE_LIMITED", processed, sent, confirmedIndexes, skippedIndexes };
      }
      throw error;
    }
    const reconciliation = reconcileChunk({ signatureStatus: await confirm(signed.signature, policy.confirmationTimeoutMs, signed, chunk), chunkMatches: await readChunkMatches(chunk), expired: false });
    const persistedStatus = reconciliation === "CONFIRMED_FAILURE" ? "FAILED" : reconciliation;
    await persist({ status: persistedStatus, index: chunk.index, signature: signed.signature });
    if (reconciliation === "CONFIRMED_FAILURE" || reconciliation === "UNKNOWN") return { status: reconciliation, processed, sent, confirmedIndexes, skippedIndexes };
    sent += 1; processed += 1; confirmedIndexes.push(chunk.index);
    await sleep(policy.minimumDelayMs);
  }
  return { status: "COMPLETE", processed, sent, confirmedIndexes, skippedIndexes };
}

export function createPlanFingerprint({ program, buffer, authority, allocation, binarySha256, maxPayload, chunks }) {
  if (
    typeof program !== "string" || program.length === 0 ||
    typeof buffer !== "string" || buffer.length === 0 ||
    typeof authority !== "string" || authority.length === 0 ||
    !Number.isInteger(allocation) || allocation < 1 ||
    !/^[a-f0-9]{64}$/i.test(binarySha256 ?? "") ||
    !Number.isInteger(maxPayload) || maxPayload < 1 ||
    !Array.isArray(chunks)
  ) {
    throw new Error("complete plan fingerprint binding is required");
  }
  const value = JSON.stringify({
    program,
    buffer,
    authority,
    allocation,
    binarySha256,
    maxPayload,
    chunks: chunks.map(({ index, offset, length, sha256 }) => ({ index, offset, length, sha256 })),
  });
  return createHash("sha256").update(value).digest("hex");
}

export function loadUploaderCheckpoint(statePath, expected) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    throw new Error("corrupted uploader state");
  }
  if (parsed?.schemaVersion !== 3) {
    throw new Error("uploader state schema must be v3");
  }
  const state = migrateState(parsed);
  const buffer = state.deployment?.buffer;
  if (!buffer) throw new Error("uploader buffer checkpoint is required");
  const checks = [
    [state.identities?.program, expected.program, "program ID"],
    [buffer.publicKey, expected.buffer, "buffer address"],
    [buffer.expectedAuthority, expected.authority, "buffer authority"],
    [buffer.expectedOwner, expected.owner, "buffer owner"],
    [buffer.allocatedLength, expected.allocation, "buffer allocation"],
    [buffer.localBinary?.length, expected.binaryLength, "binary length"],
    [buffer.localBinary?.sha256, expected.binarySha256, "binary hash"],
    [buffer.planFingerprint, expected.planFingerprint, "plan fingerprint"],
  ];
  for (const [actual, wanted, label] of checks) {
    if (actual !== wanted) throw new Error(`${label} mismatch`);
  }
  validateChunkRecords(buffer.chunks);
  return state;
}

export async function runPersistedSequentialUpload({
  statePath,
  checkpoint,
  chunks,
  confirmedChunkIndexes = [],
  policy,
  sign,
  send,
  confirm,
  readChunkMatches,
  sleep,
  onEvent = () => {},
}) {
  let state = loadUploaderCheckpoint(statePath, checkpoint);
  const records = state.deployment.buffer.chunks;
  if (records.length !== chunks.length) throw new Error("plan chunk count mismatch");
  if (!Array.isArray(confirmedChunkIndexes) || confirmedChunkIndexes.some((index, position) =>
    !Number.isSafeInteger(index) || index < 0 || (position > 0 && index <= confirmedChunkIndexes[position - 1]))) {
    throw new Error("confirmed snapshot indexes are invalid");
  }
  if (confirmedChunkIndexes.some((index) => index >= chunks.length)) throw new Error("confirmed snapshot index out of range");
  const confirmedSnapshotIndexes = new Set(confirmedChunkIndexes);
  const persist = async (event) => {
    const record = records[event.index];
    if (!record || record.index !== event.index) throw new Error("plan chunk index mismatch");
    assertChunkTransition(record.status, event.status);
    record.status = event.status;
    record.signature = event.signature ?? record.signature ?? null;
    validateChunkRecords(records);
    saveStateAtomic(statePath, state);
    onEvent(structuredClone(event));
  };

  const runnable = [];
  for (const chunk of chunks) {
    const record = records[chunk.index];
    if (!record || record.offset !== chunk.offset || record.length !== chunk.length || record.sha256 !== chunk.sha256) {
      throw new Error("plan chunk evidence mismatch");
    }
    if (record.status !== "CONFIRMED" && confirmedSnapshotIndexes.has(chunk.index)) {
      throw new Error("confirmed snapshot status mismatch");
    }
    if (record.status === "FAILED") {
      return { status: "CONFIRMED_FAILURE", processed: 0, sent: 0, confirmedIndexes: [], skippedIndexes: [] };
    }
    if (record.status === "SENT" || record.status === "UNKNOWN") {
      const signatureStatus = record.signature
        ? await confirm(record.signature, normalizeRatePolicy(policy).confirmationTimeoutMs, null, chunk)
        : null;
      const matches = await readChunkMatches(chunk);
      const reconciliation = reconcileChunk({ signatureStatus, chunkMatches: matches, expired: true });
      if (reconciliation === "CONFIRMED") {
        await persist({ status: "CONFIRMED", index: chunk.index, signature: record.signature });
        runnable.push({ ...chunk, exactMatch: true });
        continue;
      }
      if (reconciliation === "CONFIRMED_FAILURE") {
        await persist({ status: "FAILED", index: chunk.index, signature: record.signature });
        return { status: "CONFIRMED_FAILURE", processed: 0, sent: 0, confirmedIndexes: [], skippedIndexes: [] };
      }
      await persist({ status: "UNKNOWN", index: chunk.index, signature: record.signature });
      return { status: "UNKNOWN", processed: 0, sent: 0, confirmedIndexes: [], skippedIndexes: [] };
    }
    if (record.status === "CONFIRMED") {
      if (!confirmedSnapshotIndexes.has(chunk.index)) throw new Error("confirmed chunk snapshot evidence missing");
      runnable.push({ ...chunk, exactMatch: true });
      continue;
    }
    if (chunk.exactMatch) {
      await persist({ status: "CONFIRMED", index: chunk.index, signature: record.signature });
      runnable.push({ ...chunk, exactMatch: true });
      continue;
    }
    runnable.push({ ...chunk, exactMatch: false });
  }

  return runSequentialUpload({
    chunks: runnable,
    policy,
    persist,
    sign,
    send,
    confirm,
    readChunkMatches,
    sleep,
  });
}
