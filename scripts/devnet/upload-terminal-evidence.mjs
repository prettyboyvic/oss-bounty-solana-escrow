import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  canonicalJson,
  writeCanonicalJsonAtomic,
} from "./durable-json.mjs";

const VERSION = "UPLOAD_TERMINAL_EVIDENCE_V1";
const HEX_64 = /^[a-f0-9]{64}$/;
const SAFE_EXECUTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PHASES = new Set([
  "TELEMETRY_INITIALIZATION",
  "TELEMETRY_REPLAY",
  "SUBSCRIBER_SETUP",
  "SIGNER_PREPARATION",
  "UPLOAD_EXECUTION",
  "TERMINALIZATION",
]);
const CLASSIFICATIONS = new Set([
  "FAILED_PRE_SELECTION_STALE_SAFE",
  "FAILED_POST_SELECTION_RECONCILIATION_REQUIRED",
]);
const RECORD_KEYS = [
  "ambiguousWriteOutcome",
  "authority",
  "boundaries",
  "buffer",
  "classification",
  "executionId",
  "finishedAt",
  "leaseSha256",
  "primaryError",
  "program",
  "secondaryErrors",
  "startedAt",
  "stateSha256After",
  "stateSha256Before",
  "terminal",
  "version",
  "zeroSendProven",
];
const BOUNDARY_KEYS = [
  "blockhashRequestCount",
  "candidateSelectionCount",
  "keypairAccessCount",
  "sendAttemptCount",
  "signatureRecordedCount",
  "signingAttemptCount",
];
const ERROR_KEYS = ["code", "diagnostic", "phase"];
const SECONDARY_ERROR_KEYS = ["code", "phase"];
const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,95}$/;
const SAFE_PRIMARY_CLASSIFICATIONS = new Set([
  "RPC_DEADLINE_EXHAUSTED",
  "RPC_ERROR",
  "RPC_RATE_LIMITED",
  "RPC_REQUEST_TIMEOUT",
  "TELEMETRY_PERSISTENCE_FAILED",
]);
const PUBLIC_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SAFE_DIAGNOSTICS = new Set([
  "ERROR",
  "SAFE_RPC_REQUEST_ERROR",
  "TYPE_ERROR",
  "UNKNOWN_ERROR",
]);

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function validIso(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    new Date(value).toISOString() === value;
}

function safeDiagnostic(error) {
  if (error?.name === "SafeRpcRequestError") return "SAFE_RPC_REQUEST_ERROR";
  if (error?.name === "TypeError") return "TYPE_ERROR";
  if (error?.name === "Error") return "ERROR";
  return "UNKNOWN_ERROR";
}

function safePrimaryCode(phase, error) {
  if (SAFE_PRIMARY_CLASSIFICATIONS.has(error?.classification)) {
    return error.classification;
  }
  if (phase === "TELEMETRY_INITIALIZATION") return "TELEMETRY_INITIALIZATION_FAILED";
  if (phase === "TELEMETRY_REPLAY") return "TELEMETRY_REPLAY_VALIDATION_FAILED";
  if (phase === "SUBSCRIBER_SETUP") return "TELEMETRY_SUBSCRIBER_SETUP_FAILED";
  if (phase === "SIGNER_PREPARATION") return "SIGNER_PREPARATION_FAILED";
  if (phase === "TERMINALIZATION") return "TERMINALIZATION_FAILED";
  return "UPLOAD_EXECUTION_FAILED";
}

function validateBoundaries(boundaries) {
  if (!exactKeys(boundaries, BOUNDARY_KEYS) ||
      BOUNDARY_KEYS.some((key) =>
        !Number.isSafeInteger(boundaries[key]) || boundaries[key] < 0)) {
    throw new Error("terminal boundary schema is invalid");
  }
}

function validateTerminalRecord(record) {
  if (!exactKeys(record, RECORD_KEYS) ||
      record.version !== VERSION ||
      !SAFE_EXECUTION_ID.test(record.executionId ?? "") ||
      !HEX_64.test(record.leaseSha256 ?? "") ||
      !HEX_64.test(record.stateSha256Before ?? "") ||
      !HEX_64.test(record.stateSha256After ?? "") ||
      !PUBLIC_KEY.test(record.program ?? "") ||
      !PUBLIC_KEY.test(record.buffer ?? "") ||
      !PUBLIC_KEY.test(record.authority ?? "") ||
      !validIso(record.startedAt) ||
      !validIso(record.finishedAt) ||
      record.terminal !== true ||
      typeof record.zeroSendProven !== "boolean" ||
      typeof record.ambiguousWriteOutcome !== "boolean" ||
      !CLASSIFICATIONS.has(record.classification) ||
      !exactKeys(record.primaryError, ERROR_KEYS) ||
      !SAFE_CODE.test(record.primaryError.code ?? "") ||
      !PHASES.has(record.primaryError.phase) ||
      !SAFE_DIAGNOSTICS.has(record.primaryError.diagnostic) ||
      !Array.isArray(record.secondaryErrors) ||
      record.secondaryErrors.some((item) =>
        !exactKeys(item, SECONDARY_ERROR_KEYS) ||
        !SAFE_CODE.test(item.code ?? "") ||
        !PHASES.has(item.phase))) {
    throw new Error("terminal evidence schema violates whitelist");
  }
  validateBoundaries(record.boundaries);
  const allZero = BOUNDARY_KEYS.every((key) => record.boundaries[key] === 0);
  const zeroSendProven =
    record.boundaries.sendAttemptCount === 0 &&
    record.boundaries.signatureRecordedCount === 0;
  const staleSafe = allZero &&
    record.stateSha256Before === record.stateSha256After &&
    record.zeroSendProven &&
    !record.ambiguousWriteOutcome;
  if ((record.classification === "FAILED_PRE_SELECTION_STALE_SAFE") !== staleSafe ||
      record.zeroSendProven !== zeroSendProven ||
      record.ambiguousWriteOutcome !==
        (record.boundaries.sendAttemptCount > 0 ||
         record.boundaries.signatureRecordedCount > 0)) {
    throw new Error("terminal evidence classification is invalid");
  }
}

export function createUploadLifecycleTracker() {
  let phase = "TELEMETRY_INITIALIZATION";
  const boundaries = Object.fromEntries(BOUNDARY_KEYS.map((key) => [key, 0]));
  return Object.freeze({
    enterPhase(value) {
      if (!PHASES.has(value)) throw new Error("terminal lifecycle phase is invalid");
      phase = value;
    },
    recordCandidateSelection() { boundaries.candidateSelectionCount += 1; },
    recordKeypairAccess() { boundaries.keypairAccessCount += 1; },
    recordBlockhashRequest() { boundaries.blockhashRequestCount += 1; },
    recordSigningAttempt() { boundaries.signingAttemptCount += 1; },
    recordSendAttempt() { boundaries.sendAttemptCount += 1; },
    recordSignature() { boundaries.signatureRecordedCount += 1; },
    snapshot() {
      return { phase, boundaries: structuredClone(boundaries) };
    },
  });
}

export function buildUploadTerminalRecord({
  executionId,
  leaseSha256,
  stateSha256Before,
  stateSha256After,
  program,
  buffer,
  authority,
  startedAt,
  finishedAt,
  primaryError,
  tracker,
  secondaryErrors,
}) {
  const snapshot = tracker?.snapshot?.();
  if (!snapshot || !PHASES.has(snapshot.phase)) {
    throw new Error("terminal lifecycle tracker is required");
  }
  validateBoundaries(snapshot.boundaries);
  const allZero = BOUNDARY_KEYS.every((key) => snapshot.boundaries[key] === 0);
  const zeroSendProven =
    snapshot.boundaries.sendAttemptCount === 0 &&
    snapshot.boundaries.signatureRecordedCount === 0;
  const ambiguousWriteOutcome =
    snapshot.boundaries.sendAttemptCount > 0 ||
    snapshot.boundaries.signatureRecordedCount > 0;
  const classification = allZero &&
      stateSha256Before === stateSha256After &&
      !ambiguousWriteOutcome
    ? "FAILED_PRE_SELECTION_STALE_SAFE"
    : "FAILED_POST_SELECTION_RECONCILIATION_REQUIRED";
  const record = {
    version: VERSION,
    executionId,
    leaseSha256,
    stateSha256Before,
    stateSha256After,
    program,
    buffer,
    authority,
    startedAt,
    finishedAt,
    primaryError: {
      code: safePrimaryCode(snapshot.phase, primaryError),
      diagnostic: safeDiagnostic(primaryError),
      phase: snapshot.phase,
    },
    secondaryErrors: structuredClone(secondaryErrors),
    boundaries: snapshot.boundaries,
    zeroSendProven,
    ambiguousWriteOutcome,
    classification,
    terminal: true,
  };
  validateTerminalRecord(record);
  return record;
}

function evidence(record) {
  validateTerminalRecord(record);
  return {
    availability: "AVAILABLE",
    sha256: createHash("sha256").update(canonicalJson(record)).digest("hex"),
    record: structuredClone(record),
  };
}

export function readUploadTerminalEvidence(directory) {
  const path = join(directory, "terminal.json");
  if (!existsSync(path)) {
    return { availability: "UNAVAILABLE", sha256: null, record: null };
  }
  return evidence(JSON.parse(readFileSync(path, "utf8")));
}

export function writeUploadTerminalEvidence(directory, record, adapters = {}) {
  const path = join(directory, "terminal.json");
  const next = evidence(record);
  if (existsSync(path)) {
    const previous = readUploadTerminalEvidence(directory);
    if (previous.sha256 === next.sha256) return previous;
    throw new Error("existing terminal evidence regression");
  }
  writeCanonicalJsonAtomic(path, record, adapters);
  return next;
}
