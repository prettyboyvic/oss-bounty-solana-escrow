import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  RPC_METHOD_CLASSES,
  RPC_OUTCOMES,
} from "./rpc-request-ledger.mjs";

const VERSION = "UPLOAD_EXECUTION_TELEMETRY_V1";
const SAFE_EXECUTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const METHOD_SET = new Set(RPC_METHOD_CLASSES);
const OUTCOME_SET = new Set(RPC_OUTCOMES);
const MUTATION_SET = new Set(["read", "write"]);
const SEND_OUTCOME_SET = new Set(["SUCCESS", "ERROR"]);
const POLICY_KEYS = [
  "confirmationPollIntervalMs",
  "globalRequestStartGapMs",
  "interChunkDelayMs",
  "preSignCooldownMs",
  "rateLimitRetryScheduleMs",
];
const LEDGER_ENTRY_KEYS = [
  "durationMs",
  "endMonotonicMs",
  "methodClass",
  "mutationCapability",
  "outcome",
  "retryNumber",
  "sequence",
  "signaturePersisted",
  "startMonotonicMs",
];
const LEDGER_START_KEYS = [
  "methodClass",
  "mutationCapability",
  "retryNumber",
  "sequence",
  "signaturePersisted",
  "startMonotonicMs",
];
const REQUEST_KEYS = [
  "durationMs",
  "endElapsedMs",
  "finishedAt",
  "mutationCapability",
  "outcome",
  "requestType",
  "retryNumber",
  "sequence",
  "signaturePersisted",
  "startElapsedMs",
  "startedAt",
];
const SEND_KEYS = [
  "chunkIndex",
  "outcome",
  "preSignCooldownFinishedAt",
  "preSignCooldownFinishedElapsedMs",
  "preSignCooldownMs",
  "preSignCooldownRequired",
  "preSignCooldownStartedAt",
  "preSignCooldownStartedElapsedMs",
  "sendDurationMs",
  "sendFinishedAt",
  "sendFinishedElapsedMs",
  "sendStartedAt",
  "sendStartedElapsedMs",
];
const POLL_KEYS = [
  "chunkIndex",
  "requestSequence",
  "startedAt",
  "startedElapsedMs",
];
const SNAPSHOT_KEYS = [
  "confirmationPolls",
  "executionId",
  "expectedChunkIndexes",
  "finishedAt",
  "minimumConfirmationPollGapMs",
  "minimumRpcRequestGapMs",
  "missing",
  "monotonicOriginMs",
  "policy",
  "requests",
  "sends",
  "startedAt",
  "verdict",
  "version",
];

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function finiteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function nullableFiniteNonnegative(value) {
  return value === null || finiteNonnegative(value);
}

function validIso(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    new Date(value).toISOString() === value;
}

function nullableIso(value) {
  return value === null || validIso(value);
}

function validIndexes(value) {
  return Array.isArray(value) && value.every((item, index) =>
    Number.isSafeInteger(item) && item >= 0 &&
    (index === 0 || item > value[index - 1]),
  );
}

function validatePolicy(policy) {
  if (!exactKeys(policy, POLICY_KEYS) ||
      !Number.isSafeInteger(policy.preSignCooldownMs) || policy.preSignCooldownMs < 0 ||
      !Number.isSafeInteger(policy.globalRequestStartGapMs) || policy.globalRequestStartGapMs < 0 ||
      !Number.isSafeInteger(policy.confirmationPollIntervalMs) || policy.confirmationPollIntervalMs < 1 ||
      !Number.isSafeInteger(policy.interChunkDelayMs) || policy.interChunkDelayMs < 1 ||
      !Array.isArray(policy.rateLimitRetryScheduleMs) ||
      policy.rateLimitRetryScheduleMs.some((item) => !Number.isSafeInteger(item) || item < 1)) {
    throw new Error("telemetry policy schema is invalid");
  }
}

function validateRequest(request, previousSequence) {
  if (!exactKeys(request, REQUEST_KEYS) ||
      !Number.isSafeInteger(request.sequence) || request.sequence <= previousSequence ||
      !METHOD_SET.has(request.requestType) ||
      !finiteNonnegative(request.startElapsedMs) ||
      !nullableFiniteNonnegative(request.endElapsedMs) ||
      !nullableFiniteNonnegative(request.durationMs) ||
      !validIso(request.startedAt) || !nullableIso(request.finishedAt) ||
      (request.outcome !== null && !OUTCOME_SET.has(request.outcome)) ||
      !Number.isSafeInteger(request.retryNumber) || request.retryNumber < 0 ||
      typeof request.signaturePersisted !== "boolean" ||
      !MUTATION_SET.has(request.mutationCapability) ||
      (request.requestType === "SEND_RAW_TRANSACTION"
        ? request.mutationCapability !== "write" || request.signaturePersisted !== true
        : request.mutationCapability !== "read") ||
      (request.endElapsedMs === null) !== (request.durationMs === null) ||
      (request.endElapsedMs === null) !== (request.finishedAt === null) ||
      (request.endElapsedMs === null) !== (request.outcome === null) ||
      (request.endElapsedMs !== null &&
        (request.endElapsedMs < request.startElapsedMs ||
         request.durationMs !== request.endElapsedMs - request.startElapsedMs))) {
    throw new Error("telemetry request schema is invalid");
  }
}

function validateSend(send, previousIndex) {
  if (!exactKeys(send, SEND_KEYS) ||
      !Number.isSafeInteger(send.chunkIndex) || send.chunkIndex <= previousIndex ||
      typeof send.preSignCooldownRequired !== "boolean" ||
      !finiteNonnegative(send.preSignCooldownStartedElapsedMs) ||
      !finiteNonnegative(send.preSignCooldownFinishedElapsedMs) ||
      send.preSignCooldownFinishedElapsedMs < send.preSignCooldownStartedElapsedMs ||
      send.preSignCooldownMs !== send.preSignCooldownFinishedElapsedMs - send.preSignCooldownStartedElapsedMs ||
      !validIso(send.preSignCooldownStartedAt) || !validIso(send.preSignCooldownFinishedAt) ||
      !nullableFiniteNonnegative(send.sendStartedElapsedMs) ||
      !nullableFiniteNonnegative(send.sendFinishedElapsedMs) ||
      !nullableFiniteNonnegative(send.sendDurationMs) ||
      !nullableIso(send.sendStartedAt) || !nullableIso(send.sendFinishedAt) ||
      (send.sendStartedElapsedMs === null) !== (send.sendStartedAt === null) ||
      (send.sendFinishedElapsedMs === null) !== (send.sendFinishedAt === null) ||
      (send.sendFinishedElapsedMs === null) !== (send.sendDurationMs === null) ||
      (send.sendFinishedElapsedMs === null) !== (send.outcome === null) ||
      (send.sendStartedElapsedMs !== null && send.sendStartedElapsedMs < send.preSignCooldownFinishedElapsedMs) ||
      (send.sendFinishedElapsedMs !== null &&
        (send.sendStartedElapsedMs === null ||
         send.sendFinishedElapsedMs < send.sendStartedElapsedMs ||
         send.sendDurationMs !== send.sendFinishedElapsedMs - send.sendStartedElapsedMs ||
         !SEND_OUTCOME_SET.has(send.outcome)))) {
    throw new Error("telemetry send schema is invalid");
  }
}

function validatePoll(poll, previousSequence) {
  if (!exactKeys(poll, POLL_KEYS) ||
      !Number.isSafeInteger(poll.chunkIndex) || poll.chunkIndex < 0 ||
      !Number.isSafeInteger(poll.requestSequence) || poll.requestSequence <= previousSequence ||
      !finiteNonnegative(poll.startedElapsedMs) ||
      !validIso(poll.startedAt)) {
    throw new Error("telemetry confirmation poll schema is invalid");
  }
}

function computedMinimumGap(values) {
  if (values.length < 2) return null;
  let minimum = Infinity;
  for (let index = 1; index < values.length; index += 1) {
    minimum = Math.min(minimum, values[index] - values[index - 1]);
  }
  return minimum;
}

function computedMinimumConfirmationGap(polls) {
  const byChunk = new Map();
  for (const poll of polls) {
    const values = byChunk.get(poll.chunkIndex) ?? [];
    values.push(poll.startedElapsedMs);
    byChunk.set(poll.chunkIndex, values);
  }
  const gaps = [...byChunk.values()]
    .map(computedMinimumGap)
    .filter((value) => value !== null);
  return gaps.length === 0 ? null : Math.min(...gaps);
}

function requestWithinSend(request, send) {
  return request.requestType === "SEND_RAW_TRANSACTION" &&
    send.sendStartedElapsedMs !== null &&
    request.startElapsedMs >= send.sendStartedElapsedMs &&
    (send.sendFinishedElapsedMs === null ||
      (request.endElapsedMs !== null && request.endElapsedMs <= send.sendFinishedElapsedMs));
}

function validateRecordLinks(snapshot) {
  const requestBySequence = new Map(
    snapshot.requests.map((request) => [request.sequence, request]),
  );
  for (const poll of snapshot.confirmationPolls) {
    const request = requestBySequence.get(poll.requestSequence);
    if (!request ||
        request.requestType !== "GET_SIGNATURE_STATUSES" ||
        request.startElapsedMs !== poll.startedElapsedMs ||
        request.startedAt !== poll.startedAt) {
      throw new Error("telemetry confirmation poll is not linked to its RPC request");
    }
  }
  for (const request of snapshot.requests.filter(
    ({ requestType }) => requestType === "SEND_RAW_TRANSACTION",
  )) {
    const matches = snapshot.sends.filter((send) => requestWithinSend(request, send));
    if (matches.length !== 1) {
      throw new Error("telemetry send RPC request is not linked to one send boundary");
    }
  }
}

function computeMissing(snapshot) {
  const missing = [];
  if (snapshot.finishedAt === null) return ["terminal"];
  if (snapshot.requests.length < 2 || snapshot.minimumRpcRequestGapMs === null) {
    missing.push("minimumRpcRequestGapMs");
  } else if (snapshot.minimumRpcRequestGapMs < snapshot.policy.globalRequestStartGapMs) {
    missing.push("policy.globalRequestStartGapMs");
  }
  for (const request of snapshot.requests) {
    if (request.endElapsedMs === null) missing.push(`requests.${request.sequence}`);
  }
  const sends = new Map(snapshot.sends.map((send) => [send.chunkIndex, send]));
  const expected = new Set(snapshot.expectedChunkIndexes);
  for (const send of snapshot.sends) {
    if (!expected.has(send.chunkIndex)) missing.push(`expectedChunkIndexes.${send.chunkIndex}`);
  }
  for (const chunkIndex of snapshot.expectedChunkIndexes) {
    const send = sends.get(chunkIndex);
    if (!send || send.sendFinishedElapsedMs === null || send.outcome !== "SUCCESS") {
      missing.push(`sends.${chunkIndex}`);
      continue;
    }
    const sendRequests = snapshot.requests.filter((request) => requestWithinSend(request, send));
    if (sendRequests.length !== 1 ||
        sendRequests[0].endElapsedMs === null ||
        sendRequests[0].outcome !== "SUCCESS") {
      missing.push(`sends.${chunkIndex}.rpcRequest`);
    }
    if (send.preSignCooldownRequired && send.preSignCooldownMs < snapshot.policy.preSignCooldownMs) {
      missing.push(`sends.${chunkIndex}.preSignCooldownMs`);
    }
    if (snapshot.confirmationPolls.filter((poll) => poll.chunkIndex === chunkIndex).length < 2) {
      missing.push(`confirmationPolls.${chunkIndex}`);
    }
  }
  if (snapshot.expectedChunkIndexes.length === 0) missing.push("expectedChunkIndexes");
  if (snapshot.minimumConfirmationPollGapMs === null) {
    missing.push("minimumConfirmationPollGapMs");
  } else if (snapshot.minimumConfirmationPollGapMs < snapshot.policy.confirmationPollIntervalMs) {
    missing.push("policy.confirmationPollIntervalMs");
  }
  return missing;
}

function validateSnapshot(snapshot) {
  if (!exactKeys(snapshot, SNAPSHOT_KEYS) ||
      snapshot.version !== VERSION ||
      !SAFE_EXECUTION_ID.test(snapshot.executionId ?? "") ||
      !validIso(snapshot.startedAt) ||
      !nullableIso(snapshot.finishedAt) ||
      !Number.isFinite(snapshot.monotonicOriginMs) ||
      !Array.isArray(snapshot.requests) ||
      !Array.isArray(snapshot.sends) ||
      !Array.isArray(snapshot.confirmationPolls) ||
      !validIndexes(snapshot.expectedChunkIndexes) ||
      !nullableFiniteNonnegative(snapshot.minimumRpcRequestGapMs) ||
      !nullableFiniteNonnegative(snapshot.minimumConfirmationPollGapMs) ||
      !Array.isArray(snapshot.missing) ||
      snapshot.missing.some((item) => typeof item !== "string" || item.length === 0) ||
      !["COMPLETE", "INCOMPLETE"].includes(snapshot.verdict)) {
    throw new Error("telemetry snapshot schema is invalid");
  }
  validatePolicy(snapshot.policy);
  let previousSequence = 0;
  for (const request of snapshot.requests) {
    validateRequest(request, previousSequence);
    previousSequence = request.sequence;
  }
  let previousChunk = -1;
  for (const send of snapshot.sends) {
    validateSend(send, previousChunk);
    previousChunk = send.chunkIndex;
  }
  previousSequence = 0;
  for (const poll of snapshot.confirmationPolls) {
    validatePoll(poll, previousSequence);
    previousSequence = poll.requestSequence;
  }
  validateRecordLinks(snapshot);
  const requestMinimum = computedMinimumGap(snapshot.requests.map(({ startElapsedMs }) => startElapsedMs));
  const confirmationMinimum = computedMinimumConfirmationGap(snapshot.confirmationPolls);
  if (snapshot.minimumRpcRequestGapMs !== requestMinimum ||
      snapshot.minimumConfirmationPollGapMs !== confirmationMinimum) {
    throw new Error("telemetry computed minimum is invalid");
  }
  const missing = computeMissing(snapshot);
  const verdict = missing.length === 0 ? "COMPLETE" : "INCOMPLETE";
  if (snapshot.verdict !== verdict ||
      snapshot.missing.join("\0") !== missing.join("\0")) {
    throw new Error("telemetry completeness verdict is invalid");
  }
  return true;
}

function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortedValue(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(sortedValue(value));
}

export function canonicalTelemetryHash(snapshot) {
  validateSnapshot(snapshot);
  return createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}

function isoAt(startedAt, elapsedMs) {
  return new Date(new Date(startedAt).getTime() + elapsedMs).toISOString();
}

function clone(value) {
  return structuredClone(value);
}

function refreshComputed(snapshot) {
  snapshot.minimumRpcRequestGapMs = computedMinimumGap(
    snapshot.requests.map(({ startElapsedMs }) => startElapsedMs),
  );
  snapshot.minimumConfirmationPollGapMs = computedMinimumConfirmationGap(
    snapshot.confirmationPolls,
  );
  snapshot.missing = computeMissing(snapshot);
  snapshot.verdict = snapshot.missing.length === 0 ? "COMPLETE" : "INCOMPLETE";
}

function extensionValue(previous, next, path) {
  if (previous === null) return;
  if (Array.isArray(previous)) {
    if (!Array.isArray(next) || next.length < previous.length) {
      throw new Error(`telemetry regression at ${path}`);
    }
    previous.forEach((item, index) => extensionValue(item, next[index], `${path}[${index}]`));
    return;
  }
  if (previous !== null && typeof previous === "object") {
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      throw new Error(`telemetry regression at ${path}`);
    }
    for (const [key, item] of Object.entries(previous)) {
      if (key === "missing" || key === "minimumRpcRequestGapMs" ||
          key === "minimumConfirmationPollGapMs" || key === "verdict") continue;
      extensionValue(item, next[key], `${path}.${key}`);
    }
    return;
  }
  if (previous !== next) throw new Error(`telemetry regression at ${path}`);
}

function assertMonotonicExtension(previous, next) {
  extensionValue(previous, next, "telemetry");
  if (previous.verdict === "COMPLETE" && next.verdict !== "COMPLETE") {
    throw new Error("telemetry completeness regression");
  }
}

function telemetryPath(directory) {
  return join(directory, "telemetry.json");
}

function writeAtomic(path, snapshot) {
  validateSnapshot(snapshot);
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(sortedValue(snapshot), null, 2)}\n`, { flag: "wx" });
  renameSync(temporary, path);
}

export function readUploadTelemetry(directory) {
  const path = telemetryPath(directory);
  if (!existsSync(path)) {
    return {
      availability: "UNAVAILABLE",
      verdict: "UNAVAILABLE",
      publishable: false,
      sha256: null,
      snapshot: null,
    };
  }
  const snapshot = JSON.parse(readFileSync(path, "utf8"));
  validateSnapshot(snapshot);
  const sha256 = canonicalTelemetryHash(snapshot);
  return {
    availability: "AVAILABLE",
    verdict: snapshot.verdict,
    publishable: false,
    sha256,
    snapshot: clone(snapshot),
  };
}

export function evaluateUploadTelemetryPublication({
  directory,
  expectedSha256,
  terminalOutcome,
}) {
  if (!HEX_64.test(expectedSha256 ?? "")) throw new Error("expected telemetry hash is invalid");
  const evidence = readUploadTelemetry(directory);
  if (evidence.availability === "UNAVAILABLE") {
    return { verdict: "UNAVAILABLE", publishable: false, sha256: null };
  }
  const terminalMatches = terminalOutcome !== null && typeof terminalOutcome === "object" &&
    terminalOutcome.executionId === evidence.snapshot.executionId &&
    terminalOutcome.startedAt === evidence.snapshot.startedAt &&
    terminalOutcome.finishedAt === evidence.snapshot.finishedAt &&
    terminalOutcome.terminal === true &&
    ["COMPLETE", "WINDOW_LIMIT"].includes(terminalOutcome.status) &&
    Number.isSafeInteger(terminalOutcome.processed) &&
    Number.isSafeInteger(terminalOutcome.sent) &&
    terminalOutcome.processed === terminalOutcome.sent &&
    terminalOutcome.sent === evidence.snapshot.expectedChunkIndexes.length &&
    Array.isArray(terminalOutcome.confirmedIndexes) &&
    terminalOutcome.confirmedIndexes.join("\0") === evidence.snapshot.expectedChunkIndexes.join("\0") &&
    terminalOutcome.telemetryEvidence?.verdict === evidence.verdict &&
    terminalOutcome.telemetryEvidence?.sha256 === evidence.sha256;
  const publishable = evidence.verdict === "COMPLETE" &&
    evidence.sha256 === expectedSha256 &&
    terminalMatches;
  return {
    verdict: publishable ? "COMPLETE" : "INCOMPLETE",
    publishable,
    sha256: evidence.sha256,
  };
}

export function createUploadTelemetryStore({
  directory,
  executionId,
  startedAt,
  startMonotonicMs,
  policy,
}) {
  if (typeof directory !== "string" || directory.length === 0 ||
      !SAFE_EXECUTION_ID.test(executionId ?? "") ||
      !validIso(startedAt) ||
      !Number.isFinite(startMonotonicMs)) {
    throw new Error("complete telemetry store identity is required");
  }
  validatePolicy(policy);
  const path = telemetryPath(directory);
  let snapshot;
  if (existsSync(path)) {
    const existing = readUploadTelemetry(directory);
    snapshot = existing.snapshot;
    if (snapshot.executionId !== executionId || snapshot.startedAt !== startedAt ||
        snapshot.monotonicOriginMs !== startMonotonicMs ||
        canonicalJson(snapshot.policy) !== canonicalJson(policy)) {
      throw new Error("existing telemetry identity mismatch");
    }
  } else {
    snapshot = {
      version: VERSION,
      executionId,
      startedAt,
      finishedAt: null,
      monotonicOriginMs: startMonotonicMs,
      policy: clone(policy),
      requests: [],
      sends: [],
      confirmationPolls: [],
      minimumRpcRequestGapMs: null,
      minimumConfirmationPollGapMs: null,
      expectedChunkIndexes: [],
      verdict: "INCOMPLETE",
      missing: ["terminal"],
    };
    writeAtomic(path, snapshot);
  }

  function elapsed(monotonicMs) {
    if (!Number.isFinite(monotonicMs) || monotonicMs < startMonotonicMs) {
      throw new Error("telemetry monotonic clock regression");
    }
    return monotonicMs - startMonotonicMs;
  }

  function persist(next) {
    refreshComputed(next);
    validateSnapshot(next);
    assertMonotonicExtension(snapshot, next);
    writeAtomic(path, next);
    snapshot = next;
    return evidence();
  }

  function evidence() {
    return {
      verdict: snapshot.verdict,
      sha256: canonicalTelemetryHash(snapshot),
      snapshot: clone(snapshot),
    };
  }

  function sendIndex(chunkIndex) {
    return snapshot.sends.findIndex((send) => send.chunkIndex === chunkIndex);
  }

  return Object.freeze({
    recordRpcStart(value, { confirmationChunkIndex = null } = {}) {
      if (!exactKeys(value, LEDGER_START_KEYS)) {
        throw new Error("telemetry ledger start schema violates whitelist");
      }
      const request = {
        sequence: value.sequence,
        requestType: value.methodClass,
        startElapsedMs: elapsed(value.startMonotonicMs),
        endElapsedMs: null,
        durationMs: null,
        startedAt: isoAt(startedAt, elapsed(value.startMonotonicMs)),
        finishedAt: null,
        outcome: null,
        retryNumber: value.retryNumber,
        signaturePersisted: value.signaturePersisted,
        mutationCapability: value.mutationCapability,
      };
      validateRequest(request, 0);
      const next = clone(snapshot);
      if (next.requests.some(({ sequence }) => sequence === request.sequence) ||
          (next.requests.length > 0 && request.sequence <= next.requests.at(-1).sequence)) {
        throw new Error("telemetry request sequence conflicts with existing evidence");
      }
      next.requests.push(request);
      if (confirmationChunkIndex !== null) {
        if (!Number.isSafeInteger(confirmationChunkIndex) || confirmationChunkIndex < 0 ||
            request.requestType !== "GET_SIGNATURE_STATUSES") {
          throw new Error("telemetry confirmation poll context is invalid");
        }
        next.confirmationPolls.push({
          chunkIndex: confirmationChunkIndex,
          requestSequence: request.sequence,
          startedElapsedMs: request.startElapsedMs,
          startedAt: request.startedAt,
        });
      }
      return persist(next);
    },
    recordRpcEntry(value, { confirmationChunkIndex = null } = {}) {
      if (!exactKeys(value, LEDGER_ENTRY_KEYS)) {
        throw new Error("telemetry ledger entry schema violates whitelist");
      }
      validateRequest({
        sequence: value.sequence,
        requestType: value.methodClass,
        startElapsedMs: elapsed(value.startMonotonicMs),
        endElapsedMs: elapsed(value.endMonotonicMs),
        durationMs: value.durationMs,
        startedAt: isoAt(startedAt, elapsed(value.startMonotonicMs)),
        finishedAt: isoAt(startedAt, elapsed(value.endMonotonicMs)),
        outcome: value.outcome,
        retryNumber: value.retryNumber,
        signaturePersisted: value.signaturePersisted,
        mutationCapability: value.mutationCapability,
      }, 0);
      const next = clone(snapshot);
      const request = {
        sequence: value.sequence,
        requestType: value.methodClass,
        startElapsedMs: elapsed(value.startMonotonicMs),
        endElapsedMs: elapsed(value.endMonotonicMs),
        durationMs: value.durationMs,
        startedAt: isoAt(startedAt, elapsed(value.startMonotonicMs)),
        finishedAt: isoAt(startedAt, elapsed(value.endMonotonicMs)),
        outcome: value.outcome,
        retryNumber: value.retryNumber,
        signaturePersisted: value.signaturePersisted,
        mutationCapability: value.mutationCapability,
      };
      const existing = next.requests.find(({ sequence }) => sequence === request.sequence);
      if (existing) {
        const sameStart = existing.requestType === request.requestType &&
          existing.startElapsedMs === request.startElapsedMs &&
          existing.startedAt === request.startedAt &&
          existing.retryNumber === request.retryNumber &&
          existing.signaturePersisted === request.signaturePersisted &&
          existing.mutationCapability === request.mutationCapability;
        if (!sameStart || existing.endElapsedMs !== null) {
          throw new Error("telemetry request sequence conflicts with existing evidence");
        }
        Object.assign(existing, {
          endElapsedMs: request.endElapsedMs,
          durationMs: request.durationMs,
          finishedAt: request.finishedAt,
          outcome: request.outcome,
        });
        return persist(next);
      }
      if (next.requests.length > 0 && request.sequence <= next.requests.at(-1).sequence) {
        throw new Error("telemetry request sequence regression");
      }
      next.requests.push(request);
      if (confirmationChunkIndex !== null) {
        if (!Number.isSafeInteger(confirmationChunkIndex) || confirmationChunkIndex < 0 ||
            request.requestType !== "GET_SIGNATURE_STATUSES") {
          throw new Error("telemetry confirmation poll context is invalid");
        }
        next.confirmationPolls.push({
          chunkIndex: confirmationChunkIndex,
          requestSequence: request.sequence,
          startedElapsedMs: request.startElapsedMs,
          startedAt: request.startedAt,
        });
      }
      return persist(next);
    },
    recordPreSignCooldown({
      chunkIndex,
      required,
      startedMonotonicMs,
      finishedMonotonicMs,
    }) {
      if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || typeof required !== "boolean") {
        throw new Error("telemetry pre-sign cooldown context is invalid");
      }
      const startedElapsedMs = elapsed(startedMonotonicMs);
      const finishedElapsedMs = elapsed(finishedMonotonicMs);
      if (finishedElapsedMs < startedElapsedMs) throw new Error("telemetry monotonic clock regression");
      const next = clone(snapshot);
      if (sendIndex(chunkIndex) !== -1) throw new Error("telemetry send evidence already exists");
      if (next.sends.length > 0 && chunkIndex <= next.sends.at(-1).chunkIndex) {
        throw new Error("telemetry chunk sequence regression");
      }
      next.sends.push({
        chunkIndex,
        preSignCooldownRequired: required,
        preSignCooldownStartedElapsedMs: startedElapsedMs,
        preSignCooldownFinishedElapsedMs: finishedElapsedMs,
        preSignCooldownMs: finishedElapsedMs - startedElapsedMs,
        preSignCooldownStartedAt: isoAt(startedAt, startedElapsedMs),
        preSignCooldownFinishedAt: isoAt(startedAt, finishedElapsedMs),
        sendStartedElapsedMs: null,
        sendFinishedElapsedMs: null,
        sendDurationMs: null,
        sendStartedAt: null,
        sendFinishedAt: null,
        outcome: null,
      });
      return persist(next);
    },
    recordSendStart({ chunkIndex, monotonicMs }) {
      const next = clone(snapshot);
      const index = sendIndex(chunkIndex);
      if (index === -1 || next.sends[index].sendStartedElapsedMs !== null) {
        throw new Error("telemetry send start boundary is invalid");
      }
      const value = elapsed(monotonicMs);
      next.sends[index].sendStartedElapsedMs = value;
      next.sends[index].sendStartedAt = isoAt(startedAt, value);
      return persist(next);
    },
    recordSendFinish({ chunkIndex, monotonicMs, outcome }) {
      if (!SEND_OUTCOME_SET.has(outcome)) throw new Error("telemetry send outcome is invalid");
      const next = clone(snapshot);
      const index = sendIndex(chunkIndex);
      const send = next.sends[index];
      if (!send || send.sendStartedElapsedMs === null || send.sendFinishedElapsedMs !== null) {
        throw new Error("telemetry send finish boundary is invalid");
      }
      const value = elapsed(monotonicMs);
      if (value < send.sendStartedElapsedMs) throw new Error("telemetry monotonic clock regression");
      send.sendFinishedElapsedMs = value;
      send.sendFinishedAt = isoAt(startedAt, value);
      send.sendDurationMs = value - send.sendStartedElapsedMs;
      send.outcome = outcome;
      return persist(next);
    },
    finish({ finishedAt, finishedMonotonicMs, expectedChunkIndexes }) {
      if (!validIso(finishedAt) || !validIndexes(expectedChunkIndexes)) {
        throw new Error("telemetry terminal boundary is invalid");
      }
      elapsed(finishedMonotonicMs);
      const next = clone(snapshot);
      if (next.finishedAt !== null && next.finishedAt !== finishedAt) {
        throw new Error("telemetry terminal boundary regression");
      }
      if (next.expectedChunkIndexes.length > 0 &&
          next.expectedChunkIndexes.join("\0") !== expectedChunkIndexes.join("\0")) {
        throw new Error("telemetry expected chunks regression");
      }
      next.finishedAt = finishedAt;
      next.expectedChunkIndexes = [...expectedChunkIndexes];
      return persist(next);
    },
    evidence,
  });
}
