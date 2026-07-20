import { performance } from "node:perf_hooks";

import { createRpcRequestLedger } from "./rpc-request-ledger.mjs";

const DEFAULT_REQUEST_START_GAP_MS = 500;
const DEFAULT_RETRY_BACKOFF_MS = Object.freeze([2000, 5000]);

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateDelay(value, label, { allowZero = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${label} is invalid`);
  }
}

export function createRpcRequestScheduler({
  queueCapacity = 256,
  ledgerCapacity = 256,
  minimumRequestStartGapMs = DEFAULT_REQUEST_START_GAP_MS,
  retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS,
  monotonicNow = () => performance.now(),
  sleep = defaultSleep,
  ledger,
} = {}) {
  validateDelay(queueCapacity, "RPC scheduler queue capacity");
  if (queueCapacity > 4096) throw new Error("RPC scheduler queue capacity is invalid");
  validateDelay(minimumRequestStartGapMs, "RPC scheduler request-start gap", { allowZero: true });
  if (!Array.isArray(retryBackoffMs) || retryBackoffMs.length !== 2) {
    throw new Error("RPC scheduler retry policy is invalid");
  }
  retryBackoffMs.forEach((delay) => validateDelay(delay, "RPC scheduler retry delay"));
  if (typeof monotonicNow !== "function" || typeof sleep !== "function") {
    throw new Error("RPC scheduler clock and sleeper are required");
  }

  const requestLedger = ledger ?? createRpcRequestLedger({ capacity: ledgerCapacity, monotonicNow });
  const queue = [];
  const idleWaiters = [];
  let active = 0;
  let closed = false;
  let aborted = false;
  let abortError = null;
  let lastRequestStartMs = null;
  let lastRequestCompletionMs = null;

  function readMonotonic() {
    const value = monotonicNow();
    if (!Number.isFinite(value)) throw new Error("RPC scheduler monotonic clock is invalid");
    return value;
  }

  function settleIdleWaiters() {
    if (active !== 0 || queue.length !== 0) return;
    for (const resolve of idleWaiters.splice(0)) resolve();
  }

  function waitUntilIdle() {
    if (active === 0 && queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  async function wait(ms) {
    if (ms <= 0) return;
    await sleep(ms);
  }

  async function waitForRequestStartGap() {
    if (lastRequestStartMs === null) return;
    const now = readMonotonic();
    if (now < lastRequestStartMs) throw new Error("RPC scheduler monotonic clock regression");
    await wait(Math.max(0, minimumRequestStartGapMs - (now - lastRequestStartMs)));
  }

  async function runItem(item) {
    const retryAllowed = item.metadata.mutationCapability === "read" && item.metadata.methodClass !== "SEND_RAW_TRANSACTION";
    for (let retryNumber = 0; ; retryNumber += 1) {
      if (aborted) throw abortError;
      if (item.beforeAttempt) await item.beforeAttempt(retryNumber);
      await waitForRequestStartGap();
      if (aborted) throw abortError;
      lastRequestStartMs = readMonotonic();
      try {
        const result = await requestLedger.record({ ...item.metadata, retryNumber }, item.operation);
        lastRequestCompletionMs = readMonotonic();
        return result;
      } catch (error) {
        lastRequestCompletionMs = readMonotonic();
        if (!retryAllowed || error?.classification !== "RPC_RATE_LIMITED" || retryNumber >= retryBackoffMs.length || aborted) {
          throw error;
        }
        await wait(retryBackoffMs[retryNumber]);
      }
    }
  }

  async function pump() {
    if (active !== 0 || queue.length === 0 || aborted) {
      settleIdleWaiters();
      return;
    }
    const item = queue.shift();
    active = 1;
    try {
      item.resolve(await runItem(item));
    } catch (error) {
      item.reject(error);
    } finally {
      active = 0;
      if (!aborted && queue.length > 0) {
        void pump();
      } else {
        settleIdleWaiters();
      }
    }
  }

  return Object.freeze({
    ledger: requestLedger,
    schedule(metadata, operation, { beforeAttempt } = {}) {
      if (closed || aborted) return Promise.reject(abortError ?? new Error("RPC scheduler is closed"));
      if (typeof operation !== "function") return Promise.reject(new Error("RPC scheduler operation is required"));
      if (beforeAttempt !== undefined && typeof beforeAttempt !== "function") return Promise.reject(new Error("RPC scheduler before-attempt guard is invalid"));
      if (queue.length >= queueCapacity) return Promise.reject(new Error("RPC scheduler queue capacity exceeded"));
      const promise = new Promise((resolve, reject) => queue.push({ metadata, operation, beforeAttempt, resolve, reject }));
      void pump();
      return promise;
    },
    async waitForCoolOff(minimumCoolOffMs = 3000) {
      validateDelay(minimumCoolOffMs, "RPC scheduler cool-off", { allowZero: true });
      if (active !== 0 || queue.length !== 0) throw new Error("RPC scheduler must be idle before cool-off");
      if (lastRequestCompletionMs === null) throw new Error("RPC scheduler cool-off requires a completed RPC request");
      if (aborted) throw abortError;
      const now = readMonotonic();
      if (now < lastRequestCompletionMs) throw new Error("RPC scheduler monotonic clock regression");
      await wait(Math.max(0, minimumCoolOffMs - (now - lastRequestCompletionMs)));
      if (aborted) throw abortError;
    },
    async close() {
      closed = true;
      await waitUntilIdle();
    },
    abort(error = new Error("RPC scheduler aborted")) {
      if (!aborted) {
        aborted = true;
        closed = true;
        abortError = error instanceof Error ? error : new Error("RPC scheduler aborted");
        for (const item of queue.splice(0)) item.reject(abortError);
        settleIdleWaiters();
      }
      return waitUntilIdle();
    },
    status() {
      return Object.freeze({ active, pending: queue.length, aborted, closed });
    },
    policy() {
      return Object.freeze({
        concurrency: 1,
        queueCapacity,
        ledgerCapacity,
        minimumRequestStartGapMs,
        retryBackoffMs: Object.freeze([...retryBackoffMs]),
      });
    },
  });
}
