import assert from "node:assert/strict";
import test from "node:test";

import {
  RPC_METHOD_CLASSES,
  RPC_OUTCOMES,
  createRpcRequestLedger,
  isSafeRpcRequestSummary,
} from "../../scripts/devnet/rpc-request-ledger.mjs";

const ENTRY_KEYS = [
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

function clock(values) {
  let index = 0;
  return () => values[index++];
}

test("ledger records only the closed safe schema with monotonic timing", async () => {
  const ledger = createRpcRequestLedger({ capacity: 4, monotonicNow: clock([10, 17]) });
  const value = await ledger.record({
    methodClass: "GET_ACCOUNT_INFO",
    retryNumber: 0,
    signaturePersisted: false,
    mutationCapability: "read",
  }, async () => 42);

  assert.equal(value, 42);
  assert.deepEqual(ledger.debugSafeEntries(), [{
    sequence: 1,
    methodClass: "GET_ACCOUNT_INFO",
    startMonotonicMs: 10,
    endMonotonicMs: 17,
    durationMs: 7,
    outcome: "SUCCESS",
    retryNumber: 0,
    signaturePersisted: false,
    mutationCapability: "read",
  }]);
  assert.deepEqual(Object.keys(ledger.debugSafeEntries()[0]).sort(), ENTRY_KEYS);
  assert.equal(Object.isFrozen(ledger.debugSafeEntries()[0]), true);
});

test("scheduler-supplied invocation clock assigns sequence and ledger start at operation call", async () => {
  const starts = [];
  const order = [];
  const ledger = createRpcRequestLedger({ monotonicNow: () => 75 });
  await ledger.record({
    methodClass: "GET_ACCOUNT_INFO",
    retryNumber: 0,
    signaturePersisted: false,
    mutationCapability: "read",
  }, async () => { order.push("operation"); return null; }, {
    invocationMonotonicNow: () => 50,
    onInvocationStart: (value) => { order.push("observer"); starts.push(value); },
  });

  assert.deepEqual(order, ["operation", "observer"]);
  assert.deepEqual(starts, [{ sequence: 1, startMonotonicMs: 50, retryNumber: 0 }]);
  assert.equal(ledger.debugSafeEntries()[0].startMonotonicMs, 50);
  assert.equal(ledger.debugSafeEntries()[0].endMonotonicMs, 75);
});

test("observer failure waits for the started operation and does not misclassify its ledger outcome", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const ledger = createRpcRequestLedger({ monotonicNow: () => 10 });
  let settled = false;
  const recorded = ledger.record({
    methodClass: "GET_ACCOUNT_INFO",
    retryNumber: 0,
    signaturePersisted: false,
    mutationCapability: "read",
  }, () => pending, { onInvocationStart: () => { throw new Error("private observer detail"); } });
  recorded.catch(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  release("ok");
  await assert.rejects(recorded, /RPC ledger invocation observer failed/);
  assert.equal(ledger.debugSafeEntries()[0].outcome, "SUCCESS");
});

test("method, outcome and mutation enums are closed", async () => {
  assert.deepEqual(RPC_METHOD_CLASSES, [
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
  assert.deepEqual(RPC_OUTCOMES, ["SUCCESS", "RPC_RATE_LIMITED", "RPC_ERROR"]);
  const ledger = createRpcRequestLedger();
  const valid = {
    methodClass: "GET_BALANCE",
    retryNumber: 0,
    signaturePersisted: false,
    mutationCapability: "read",
  };
  await assert.rejects(ledger.record({ ...valid, methodClass: "RAW_RPC" }, async () => 1), /method class/);
  await assert.rejects(ledger.record({ ...valid, mutationCapability: "write" }, async () => 1), /mutation capability/);
  await assert.rejects(ledger.record({ ...valid, body: "CANARY-BODY" }, async () => 1), /ledger metadata schema/);
});

test("bounded ledger evicts oldest entries and reports aggregate counts only", async () => {
  const ledger = createRpcRequestLedger({ capacity: 2, monotonicNow: clock([1, 2, 3, 4, 5, 6]) });
  for (const methodClass of ["GET_GENESIS_HASH", "GET_BALANCE", "GET_RENT_EXEMPTION"]) {
    await ledger.record({ methodClass, retryNumber: 0, signaturePersisted: false, mutationCapability: "read" }, async () => null);
  }

  assert.deepEqual(ledger.debugSafeEntries().map(({ sequence }) => sequence), [2, 3]);
  assert.deepEqual(ledger.summary(), {
    capacity: 2,
    totalRecorded: 3,
    retained: 2,
    dropped: 1,
    countsByOutcome: { SUCCESS: 3, RPC_RATE_LIMITED: 0, RPC_ERROR: 0 },
    countsByMethod: {
      GET_GENESIS_HASH: 1,
      GET_ACCOUNT_INFO: 0,
      GET_BALANCE: 1,
      GET_RENT_EXEMPTION: 1,
      GET_SIGNATURE_HISTORY: 0,
      GET_LATEST_BLOCKHASH: 0,
      GET_FEE_FOR_MESSAGE: 0,
      GET_SIGNATURE_STATUSES: 0,
      GET_TRANSACTION: 0,
      SEND_RAW_TRANSACTION: 0,
    },
  });
  assert.doesNotMatch(JSON.stringify(ledger.summary()), /start|duration|sequence|body|header|url/i);
});

test("ledger sequence follows request start order even when completion order reverses", async () => {
  const ticks = [10, 20, 21, 22];
  const ledger = createRpcRequestLedger({ monotonicNow: () => ticks.shift() });
  let finishFirst;
  let finishSecond;
  const first = ledger.record({
    methodClass: "GET_GENESIS_HASH",
    retryNumber: 0,
    signaturePersisted: false,
    mutationCapability: "read",
  }, () => new Promise((resolve) => { finishFirst = resolve; }));
  const second = ledger.record({
    methodClass: "GET_BALANCE",
    retryNumber: 0,
    signaturePersisted: false,
    mutationCapability: "read",
  }, () => new Promise((resolve) => { finishSecond = resolve; }));

  finishSecond();
  await second;
  finishFirst();
  await first;

  assert.deepEqual(ledger.debugSafeEntries().map(({ sequence, methodClass }) => ({ sequence, methodClass })), [
    { sequence: 1, methodClass: "GET_GENESIS_HASH" },
    { sequence: 2, methodClass: "GET_BALANCE" },
  ]);
});

test("rate-limit errors expose only safe ledger metadata and retain no raw error", async () => {
  const ledger = createRpcRequestLedger({ monotonicNow: clock([100, 105]) });
  let observed;
  try {
    await ledger.record({
      methodClass: "GET_ACCOUNT_INFO",
      retryNumber: 0,
      signaturePersisted: false,
      mutationCapability: "read",
    }, async () => {
      throw {
        message: "429 Too Many Requests CANARY-MESSAGE",
        response: { headers: { authorization: "CANARY-HEADER" }, body: "CANARY-BODY" },
      };
    });
  } catch (error) {
    observed = error;
  }

  assert.deepEqual({
    classification: observed.classification,
    methodClass: observed.methodClass,
    sequence: observed.sequence,
    signaturePersisted: observed.signaturePersisted,
  }, {
    classification: "RPC_RATE_LIMITED",
    methodClass: "GET_ACCOUNT_INFO",
    sequence: 1,
    signaturePersisted: false,
  });
  assert.doesNotMatch(JSON.stringify(observed), /CANARY|body|header|authorization/i);
  assert.deepEqual(ledger.debugSafeEntries()[0].outcome, "RPC_RATE_LIMITED");
});

test("send entries require write capability and a persisted signature", async () => {
  const ledger = createRpcRequestLedger();
  const base = { methodClass: "SEND_RAW_TRANSACTION", retryNumber: 0, signaturePersisted: true, mutationCapability: "write" };
  await ledger.record(base, async () => null);
  await assert.rejects(ledger.record({ ...base, signaturePersisted: false }, async () => null), /persisted signature/);
  await assert.rejects(ledger.record({ ...base, mutationCapability: "read" }, async () => null), /mutation capability/);
});

test("public aggregate summary validator rejects schema and count drift", () => {
  const summary = createRpcRequestLedger().summary();
  assert.equal(isSafeRpcRequestSummary(summary), true);
  assert.equal(isSafeRpcRequestSummary({ ...summary, rawBody: "CANARY" }), false);
  assert.equal(isSafeRpcRequestSummary({ ...summary, totalRecorded: 1 }), false);
  assert.equal(isSafeRpcRequestSummary({ ...summary, countsByOutcome: { ...summary.countsByOutcome, SUCCESS: -1 } }), false);
  assert.equal(isSafeRpcRequestSummary({ ...summary, countsByMethod: { ...summary.countsByMethod, UNKNOWN: 0 } }), false);
});
