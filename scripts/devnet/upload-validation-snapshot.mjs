import { createHash } from "node:crypto";

const SNAPSHOT_VERSION = "CONFIRMED_VALIDATION_SNAPSHOT_V1";
const BUFFER_METADATA_LENGTH = 37;
const SHA256 = /^[a-f0-9]{64}$/i;

export const VALIDATION_SNAPSHOT_TTL_MS = 30_000;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertIdentity(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is required`);
}

function assertSha256(value, label) {
  if (!SHA256.test(value ?? "")) throw new Error(`${label} must be SHA-256`);
}

export function createConfirmedValidationSnapshot({
  bufferAddress,
  owner,
  authority,
  allocation,
  lamports,
  accountData,
  finalizedSlot,
  capturedAtMonotonicMs,
  stateSha256,
  binarySha256,
  planFingerprint,
}) {
  assertIdentity(bufferAddress, "snapshot buffer address");
  assertIdentity(owner, "snapshot owner");
  assertIdentity(authority, "snapshot authority");
  assertSha256(stateSha256, "snapshot state hash");
  assertSha256(binarySha256, "snapshot binary hash");
  assertSha256(planFingerprint, "snapshot plan fingerprint");
  if (!Number.isSafeInteger(allocation) || allocation < BUFFER_METADATA_LENGTH) throw new Error("snapshot allocation is invalid");
  if (!Number.isSafeInteger(lamports) || lamports < 0) throw new Error("snapshot lamports are invalid");
  if (!Number.isSafeInteger(finalizedSlot) || finalizedSlot < 0) throw new Error("snapshot finalized slot is invalid");
  if (!Number.isFinite(capturedAtMonotonicMs) || capturedAtMonotonicMs < 0) throw new Error("snapshot capture time is invalid");
  const data = Buffer.from(accountData ?? []);
  if (data.length !== allocation) throw new Error("snapshot account data allocation mismatch");

  return Object.freeze({
    version: SNAPSHOT_VERSION,
    bufferAddress,
    owner,
    authority,
    allocation,
    lamports,
    accountDataSha256: sha256(data),
    accountDataBase64: data.toString("base64"),
    finalizedSlot,
    capturedAtMonotonicMs,
    stateSha256,
    binarySha256,
    planFingerprint,
  });
}

export function validateConfirmedValidationSnapshot({
  snapshot,
  expected,
  chunks,
  records,
  localBytes,
  nowMonotonicMs,
  ttlMs = VALIDATION_SNAPSHOT_TTL_MS,
}) {
  if (snapshot?.version !== SNAPSHOT_VERSION) throw new Error("validation snapshot version mismatch");
  const bindings = [
    ["buffer address", "bufferAddress"],
    ["owner", "owner"],
    ["authority", "authority"],
    ["allocation", "allocation"],
    ["state hash", "stateSha256"],
    ["binary hash", "binarySha256"],
    ["plan fingerprint", "planFingerprint"],
  ];
  for (const [label, property] of bindings) {
    if (snapshot[property] !== expected?.[property]) throw new Error(`snapshot ${label} mismatch`);
  }
  if (!Number.isFinite(nowMonotonicMs) || nowMonotonicMs < snapshot.capturedAtMonotonicMs) {
    throw new Error("snapshot clock regression");
  }
  if (!Number.isFinite(ttlMs) || ttlMs < 0 || nowMonotonicMs - snapshot.capturedAtMonotonicMs > ttlMs) {
    throw new Error("snapshot expired");
  }
  if (!Number.isSafeInteger(snapshot.finalizedSlot) || snapshot.finalizedSlot < 0) {
    throw new Error("snapshot finalized context mismatch");
  }

  const encoded = snapshot.accountDataBase64;
  if (typeof encoded !== "string") throw new Error("snapshot account data mismatch");
  const accountData = Buffer.from(encoded, "base64");
  if (accountData.toString("base64") !== encoded || accountData.length !== snapshot.allocation || sha256(accountData) !== snapshot.accountDataSha256) {
    throw new Error("snapshot account data mismatch");
  }
  const binary = Buffer.from(localBytes ?? []);
  if (sha256(binary) !== snapshot.binarySha256) throw new Error("snapshot binary hash mismatch");
  const payload = accountData.subarray(BUFFER_METADATA_LENGTH);
  if (payload.length !== binary.length) throw new Error("snapshot allocation mismatch");
  if (!Array.isArray(chunks) || !Array.isArray(records) || chunks.length !== records.length || chunks.length === 0) {
    throw new Error("snapshot plan records mismatch");
  }

  const confirmedIndexes = [];
  let nextOffset = 0;
  let confirmedPrefixEnded = false;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const record = records[index];
    if (!chunk || !record || chunk.index !== index || record.index !== index) throw new Error("snapshot chunk index mismatch");
    if (!Number.isSafeInteger(chunk.offset) || chunk.offset < 0 || !Number.isSafeInteger(chunk.length) || chunk.length < 1 || chunk.offset + chunk.length > binary.length) {
      throw new Error("snapshot chunk out of bounds");
    }
    if (chunk.offset !== nextOffset) throw new Error("snapshot chunk gap or overlap");
    if (record.offset !== chunk.offset || record.length !== chunk.length || record.sha256 !== chunk.sha256) {
      throw new Error("snapshot chunk evidence mismatch");
    }
    const expectedBytes = binary.subarray(chunk.offset, chunk.offset + chunk.length);
    if (sha256(expectedBytes) !== chunk.sha256) throw new Error("snapshot chunk hash mismatch");
    if (record.status === "CONFIRMED") {
      if (confirmedPrefixEnded) throw new Error("confirmed chunk gap");
      if (!payload.subarray(chunk.offset, chunk.offset + chunk.length).equals(expectedBytes)) {
        throw new Error("confirmed chunk bytes mismatch");
      }
      confirmedIndexes.push(index);
    } else {
      confirmedPrefixEnded = true;
    }
    nextOffset = chunk.offset + chunk.length;
  }
  if (nextOffset !== binary.length) throw new Error("snapshot plan coverage mismatch");

  return Object.freeze({
    confirmedIndexes: Object.freeze(confirmedIndexes),
    confirmedCount: confirmedIndexes.length,
  });
}
