import { createHash } from "node:crypto";

import { serializedWriteTransactionSize } from "./upload-plan.mjs";

export const CANDIDATE_EVIDENCE_SCHEMA = "R4_CANDIDATE_EVIDENCE_V1";
export const CANDIDATE_EVIDENCE_DOMAIN = "R4_CANDIDATE_EVIDENCE_V1";
export const LEGACY_CANDIDATE_DIGEST =
  "6554cbe1ad09b9e621a709dde9c4fb2f59404a8d2a8551a133552fe2ef345180";

const HEX_64 = /^[a-f0-9]{64}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{1,128}$/;
const CANDIDATE_STATES = new Set([
  "PLANNED",
  "SENT",
  "UNKNOWN",
  "CONFIRMED",
  "FAILED",
]);
const TOP_LEVEL_KEYS = [
  "schema",
  "stateSha256",
  "binarySha256",
  "planFingerprint",
  "candidateCount",
  "candidates",
];
const BUILD_KEYS = [
  "stateSha256",
  "binarySha256",
  "planFingerprint",
  "candidates",
];
const CANDIDATE_KEYS = [
  "index",
  "offset",
  "length",
  "payloadSha256",
  "serializedTransactionBytes",
  "expectedState",
  "expectedSignature",
];

function hasExactKeys(value, keys) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function assertHash(value, label) {
  if (!HEX_64.test(value ?? "")) throw new Error(`${label} must be a lowercase SHA-256`);
}

function validateCandidate(candidate) {
  if (!hasExactKeys(candidate, CANDIDATE_KEYS)) {
    throw new Error("candidate evidence candidate schema mismatch");
  }
  for (const key of ["index", "offset", "length", "serializedTransactionBytes"]) {
    if (!Number.isSafeInteger(candidate[key]) || candidate[key] < (key === "length" ? 1 : 0)) {
      throw new Error(`candidate evidence ${key} is invalid`);
    }
  }
  if (candidate.serializedTransactionBytes < 1) {
    throw new Error("candidate evidence serialized transaction size is invalid");
  }
  assertHash(candidate.payloadSha256, "candidate evidence payload hash");
  if (!CANDIDATE_STATES.has(candidate.expectedState)) {
    throw new Error("candidate evidence expected state is invalid");
  }
  if (
    candidate.expectedSignature !== null &&
    !SIGNATURE.test(candidate.expectedSignature)
  ) {
    throw new Error("candidate evidence expected signature is invalid");
  }
}

function validateEvidence(evidence) {
  if (!hasExactKeys(evidence, TOP_LEVEL_KEYS) ||
      evidence.schema !== CANDIDATE_EVIDENCE_SCHEMA) {
    throw new Error("candidate evidence schema mismatch");
  }
  assertHash(evidence.stateSha256, "candidate evidence state hash");
  assertHash(evidence.binarySha256, "candidate evidence binary hash");
  assertHash(evidence.planFingerprint, "candidate evidence plan fingerprint");
  if (!Number.isSafeInteger(evidence.candidateCount) ||
      evidence.candidateCount < 1 ||
      !Array.isArray(evidence.candidates) ||
      evidence.candidateCount !== evidence.candidates.length) {
    throw new Error("candidate evidence count is invalid");
  }
  let previousIndex = -1;
  for (const candidate of evidence.candidates) {
    validateCandidate(candidate);
    if (candidate.index <= previousIndex) {
      throw new Error(
        candidate.index === previousIndex
          ? "candidate evidence contains a duplicate index"
          : "candidate evidence candidates must be in ascending sorted order",
      );
    }
    previousIndex = candidate.index;
  }
  return evidence;
}

export function buildCandidateEvidence(input) {
  if (!hasExactKeys(input, BUILD_KEYS) || !Array.isArray(input.candidates)) {
    throw new Error("candidate evidence build input schema mismatch");
  }
  assertHash(input.stateSha256, "candidate evidence state hash");
  assertHash(input.binarySha256, "candidate evidence binary hash");
  assertHash(input.planFingerprint, "candidate evidence plan fingerprint");
  const candidates = input.candidates.map((candidate) => {
    validateCandidate(candidate);
    return Object.freeze({
      index: candidate.index,
      offset: candidate.offset,
      length: candidate.length,
      payloadSha256: candidate.payloadSha256,
      serializedTransactionBytes: candidate.serializedTransactionBytes,
      expectedState: candidate.expectedState,
      expectedSignature: candidate.expectedSignature,
    });
  }).sort((left, right) => left.index - right.index);
  for (let index = 1; index < candidates.length; index += 1) {
    if (candidates[index - 1].index === candidates[index].index) {
      throw new Error("candidate evidence contains a duplicate index");
    }
  }
  return Object.freeze({
    schema: CANDIDATE_EVIDENCE_SCHEMA,
    stateSha256: input.stateSha256,
    binarySha256: input.binarySha256,
    planFingerprint: input.planFingerprint,
    candidateCount: candidates.length,
    candidates: Object.freeze(candidates),
  });
}

export function buildCandidateEvidenceFromUploadInputs({
  stateBytes,
  binaryBytes,
  candidateIndexes,
  buffer,
  authority,
}) {
  const stateBuffer = Buffer.from(stateBytes);
  const binaryBuffer = Buffer.from(binaryBytes);
  let state;
  try {
    state = JSON.parse(stateBuffer.toString("utf8"));
  } catch {
    throw new Error("candidate evidence state JSON is invalid");
  }
  const records = state?.deployment?.buffer?.chunks;
  const planFingerprint = state?.deployment?.buffer?.planFingerprint;
  if (
    state?.schemaVersion !== 3 ||
    !Array.isArray(records) ||
    !HEX_64.test(planFingerprint ?? "") ||
    !Array.isArray(candidateIndexes) ||
    candidateIndexes.length === 0 ||
    candidateIndexes.some((value, index) =>
      !Number.isSafeInteger(value) ||
      value < 0 ||
      (index > 0 && value <= candidateIndexes[index - 1]))
  ) {
    throw new Error("candidate evidence canonical upload inputs are invalid");
  }
  const candidates = candidateIndexes.map((index) => {
    const record = records[index];
    if (
      record?.index !== index ||
      !Number.isSafeInteger(record.offset) ||
      record.offset < 0 ||
      !Number.isSafeInteger(record.length) ||
      record.length < 1 ||
      record.offset + record.length > binaryBuffer.length
    ) {
      throw new Error("candidate evidence state candidate is invalid");
    }
    const bytes = binaryBuffer.subarray(
      record.offset,
      record.offset + record.length,
    );
    const payloadSha256 = createHash("sha256").update(bytes).digest("hex");
    if (payloadSha256 !== record.sha256) {
      throw new Error("candidate evidence payload hash mismatch");
    }
    return {
      index: record.index,
      offset: record.offset,
      length: record.length,
      payloadSha256,
      serializedTransactionBytes: serializedWriteTransactionSize({
        buffer,
        authority,
        offset: record.offset,
        bytes,
      }),
      expectedState: record.status,
      expectedSignature: record.signature,
    };
  });
  return buildCandidateEvidence({
    stateSha256: createHash("sha256").update(stateBuffer).digest("hex"),
    binarySha256: createHash("sha256").update(binaryBuffer).digest("hex"),
    planFingerprint,
    candidates,
  });
}

function canonicalJson(evidence) {
  validateEvidence(evidence);
  const candidates = evidence.candidates.map((candidate) =>
    `{"index":${candidate.index},"offset":${candidate.offset},"length":${candidate.length},` +
    `"payloadSha256":${JSON.stringify(candidate.payloadSha256)},` +
    `"serializedTransactionBytes":${candidate.serializedTransactionBytes},` +
    `"expectedState":${JSON.stringify(candidate.expectedState)},` +
    `"expectedSignature":${JSON.stringify(candidate.expectedSignature)}}`
  ).join(",");
  return `{"schema":${JSON.stringify(evidence.schema)},` +
    `"stateSha256":${JSON.stringify(evidence.stateSha256)},` +
    `"binarySha256":${JSON.stringify(evidence.binarySha256)},` +
    `"planFingerprint":${JSON.stringify(evidence.planFingerprint)},` +
    `"candidateCount":${evidence.candidateCount},"candidates":[${candidates}]}`;
}

export function canonicalCandidateEvidenceBytes(evidence) {
  return Buffer.from(
    `${CANDIDATE_EVIDENCE_DOMAIN}\0${canonicalJson(evidence)}`,
    "utf8",
  );
}

export function candidateEvidenceSha256(evidence) {
  return createHash("sha256")
    .update(canonicalCandidateEvidenceBytes(evidence))
    .digest("hex");
}

export function verifyCandidateEvidenceDigest(evidence, expectedSha256) {
  assertHash(expectedSha256, "expected candidate evidence hash");
  return candidateEvidenceSha256(evidence) === expectedSha256;
}
