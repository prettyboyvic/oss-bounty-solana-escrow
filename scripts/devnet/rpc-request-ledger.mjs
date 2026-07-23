import { performance } from "node:perf_hooks";

export const RPC_METHOD_CLASSES = Object.freeze([
  "GET_GENESIS_HASH",
  "GET_ACCOUNT_INFO",
  "GET_BALANCE",
  "GET_RENT_EXEMPTION",
  "GET_SIGNATURE_HISTORY",
  "GET_LATEST_BLOCKHASH",
  "GET_FEE_FOR_MESSAGE",
  "GET_SIGNATURE_STATUSES",
  "GET_TRANSACTION",
  "SEND_RAW_TRANSACTION",
]);

export const RPC_OUTCOMES = Object.freeze(["SUCCESS", "RPC_RATE_LIMITED", "RPC_ERROR"]);

const METHOD_SET = new Set(RPC_METHOD_CLASSES);
const METADATA_KEYS = ["methodClass", "mutationCapability", "retryNumber", "signaturePersisted"];
const RATE_LIMIT_TEXT = /\b429\s+too many requests\b|\btoo many requests\b|\brate[-_ ]limit(?:ed|ing| exceeded| response)\b/i;
const RATE_LIMIT_NUMBER_KEYS = /^(?:code|status|statusCode|httpStatus)$/i;
const SAFE_ERROR_KEYS = ["message", "code", "status", "statusCode", "httpStatus", "data", "body", "response", "error", "cause"];
const SUMMARY_KEYS = ["capacity", "countsByMethod", "countsByOutcome", "dropped", "retained", "totalRecorded"];
const RECORD_OPTION_KEYS = ["invocationMonotonicNow", "onInvocationStart"];

function containsRateLimit(value, seen = new WeakSet(), key = "", depth = 0) {
  if (typeof value === "string") return RATE_LIMIT_TEXT.test(value);
  if (typeof value === "number") return value === 429 && RATE_LIMIT_NUMBER_KEYS.test(key);
  if (value === null || (typeof value !== "object" && typeof value !== "function") || depth > 8 || ArrayBuffer.isView(value) || value instanceof ArrayBuffer || seen.has(value)) {
    return false;
  }
  seen.add(value);
  for (const property of SAFE_ERROR_KEYS) {
    let item;
    try {
      item = value[property];
    } catch {
      continue;
    }
    if (containsRateLimit(item, seen, property, depth + 1)) return true;
  }
  return false;
}

function validateMetadata(metadata) {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata) || Object.keys(metadata).sort().join("\0") !== [...METADATA_KEYS].sort().join("\0")) {
    throw new Error("RPC ledger metadata schema mismatch");
  }
  if (!METHOD_SET.has(metadata.methodClass)) throw new Error("RPC ledger method class is invalid");
  if (!Number.isSafeInteger(metadata.retryNumber) || metadata.retryNumber < 0) throw new Error("RPC ledger retry number is invalid");
  if (typeof metadata.signaturePersisted !== "boolean") throw new Error("RPC ledger persisted signature flag is invalid");
  const expectedCapability = metadata.methodClass === "SEND_RAW_TRANSACTION" ? "write" : "read";
  if (metadata.mutationCapability !== expectedCapability) throw new Error("RPC ledger mutation capability mismatch");
  if (metadata.methodClass === "SEND_RAW_TRANSACTION" && !metadata.signaturePersisted) {
    throw new Error("RPC send requires a persisted signature");
  }
}

class SafeRpcRequestError extends Error {
  constructor(entry) {
    super(entry.outcome === "RPC_RATE_LIMITED" ? "RPC rate limited" : "RPC request failed");
    this.name = "SafeRpcRequestError";
    this.classification = entry.outcome;
    this.methodClass = entry.methodClass;
    this.sequence = entry.sequence;
    this.signaturePersisted = entry.signaturePersisted;
  }
}

export function isSafeRpcRequestSummary(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\0") !== [...SUMMARY_KEYS].sort().join("\0")) {
    return false;
  }
  if (!Number.isSafeInteger(value.capacity) || value.capacity < 1 || value.capacity > 4096 ||
      !Number.isSafeInteger(value.totalRecorded) || value.totalRecorded < 0 ||
      !Number.isSafeInteger(value.retained) || value.retained < 0 || value.retained > value.capacity || value.retained > value.totalRecorded ||
      !Number.isSafeInteger(value.dropped) || value.dropped < 0 || value.dropped !== value.totalRecorded - value.retained) {
    return false;
  }
  const countGroups = [
    [value.countsByOutcome, RPC_OUTCOMES],
    [value.countsByMethod, RPC_METHOD_CLASSES],
  ];
  for (const [counts, keys] of countGroups) {
    if (counts === null || typeof counts !== "object" || Array.isArray(counts) || Object.keys(counts).sort().join("\0") !== [...keys].sort().join("\0") ||
        keys.some((key) => !Number.isSafeInteger(counts[key]) || counts[key] < 0) ||
        keys.reduce((total, key) => total + counts[key], 0) !== value.totalRecorded) {
      return false;
    }
  }
  return true;
}

export function createRpcRequestLedger({ capacity = 256, monotonicNow = () => performance.now() } = {}) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 4096) throw new Error("RPC ledger capacity is invalid");
  if (typeof monotonicNow !== "function") throw new Error("RPC ledger monotonic clock is required");

  const entries = [];
  let nextSequence = 0;
  let completed = 0;
  let dropped = 0;
  const subscribers = new Set();
  const invocationStartSubscribers = new Set();
  const countsByOutcome = Object.fromEntries(RPC_OUTCOMES.map((outcome) => [outcome, 0]));
  const countsByMethod = Object.fromEntries(RPC_METHOD_CLASSES.map((method) => [method, 0]));

  function append(requestSequence, metadata, startMonotonicMs, endMonotonicMs, outcome) {
    if (!Number.isFinite(startMonotonicMs) || !Number.isFinite(endMonotonicMs) || endMonotonicMs < startMonotonicMs) {
      throw new Error("RPC ledger monotonic clock regression");
    }
    const entry = Object.freeze({
      sequence: requestSequence,
      methodClass: metadata.methodClass,
      startMonotonicMs,
      endMonotonicMs,
      durationMs: endMonotonicMs - startMonotonicMs,
      outcome,
      retryNumber: metadata.retryNumber,
      signaturePersisted: metadata.signaturePersisted,
      mutationCapability: metadata.mutationCapability,
    });
    entries.push(entry);
    entries.sort((left, right) => left.sequence - right.sequence);
    completed += 1;
    countsByOutcome[outcome] += 1;
    countsByMethod[metadata.methodClass] += 1;
    if (entries.length > capacity) {
      entries.shift();
      dropped += 1;
    }
    for (const subscriber of subscribers) subscriber(entry);
    return entry;
  }

  return Object.freeze({
    async record(metadata, operation, options = {}) {
      validateMetadata(metadata);
      if (typeof operation !== "function") throw new Error("RPC ledger operation is required");
      if (options === null || typeof options !== "object" || Array.isArray(options) ||
          Object.keys(options).some((key) => !RECORD_OPTION_KEYS.includes(key))) {
        throw new Error("RPC ledger record options are invalid");
      }
      if (options.onInvocationStart !== undefined && typeof options.onInvocationStart !== "function") {
        throw new Error("RPC ledger invocation observer is invalid");
      }
      if (options.invocationMonotonicNow !== undefined && typeof options.invocationMonotonicNow !== "function") {
        throw new Error("RPC ledger invocation clock is invalid");
      }
      const requestSequence = nextSequence + 1;
      nextSequence = requestSequence;
      const startMonotonicMs = (options.invocationMonotonicNow ?? monotonicNow)();
      if (!Number.isFinite(startMonotonicMs)) throw new Error("RPC ledger monotonic clock is invalid");
      const boundary = Object.freeze({ sequence: requestSequence, startMonotonicMs, retryNumber: metadata.retryNumber });
      const invocationStart = Object.freeze({
        sequence: requestSequence,
        methodClass: metadata.methodClass,
        startMonotonicMs,
        retryNumber: metadata.retryNumber,
        signaturePersisted: metadata.signaturePersisted,
        mutationCapability: metadata.mutationCapability,
      });
      try {
        for (const subscriber of invocationStartSubscribers) subscriber(invocationStart);
      } catch {
        throw new Error("RPC ledger invocation-start subscriber failed");
      }
      let pending;
      let synchronousError;
      try {
        pending = operation();
      } catch (error) {
        synchronousError = error;
      }
      let observerError;
      try {
        options.onInvocationStart?.(boundary);
      } catch {
        observerError = new Error("RPC ledger invocation observer failed");
      }
      let result;
      try {
        if (synchronousError) throw synchronousError;
        result = await pending;
      } catch (error) {
        const outcome = containsRateLimit(error) ? "RPC_RATE_LIMITED" : "RPC_ERROR";
        const entry = append(requestSequence, metadata, startMonotonicMs, monotonicNow(), outcome);
        throw new SafeRpcRequestError(entry);
      }
      append(requestSequence, metadata, startMonotonicMs, monotonicNow(), "SUCCESS");
      if (observerError) throw observerError;
      return result;
    },
    debugSafeEntries() {
      return Object.freeze([...entries]);
    },
    subscribe(subscriber) {
      if (typeof subscriber !== "function") throw new Error("RPC ledger subscriber is invalid");
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    subscribeInvocationStarts(subscriber) {
      if (typeof subscriber !== "function") throw new Error("RPC ledger invocation-start subscriber is invalid");
      invocationStartSubscribers.add(subscriber);
      return () => invocationStartSubscribers.delete(subscriber);
    },
    summary() {
      return Object.freeze({
        capacity,
        totalRecorded: completed,
        retained: entries.length,
        dropped,
        countsByOutcome: Object.freeze({ ...countsByOutcome }),
        countsByMethod: Object.freeze({ ...countsByMethod }),
      });
    },
  });
}
