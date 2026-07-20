import assert from "node:assert/strict";
import test from "node:test";

import { createRpcRequestScheduler } from "../../scripts/devnet/rpc-request-scheduler.mjs";

function fakeTime() {
  let now = 0;
  const sleeps = [];
  return {
    now: () => now,
    sleeps,
    advance(ms) { now += ms; },
    async sleep(ms) {
      sleeps.push(ms);
      now += ms;
    },
  };
}

function readMetadata(methodClass = "GET_ACCOUNT_INFO") {
  return {
    methodClass,
    mutationCapability: "read",
    signaturePersisted: false,
  };
}

test("shared scheduler is FIFO, concurrency one, and starts requests at least 500ms apart", async () => {
  const clock = fakeTime();
  const starts = [];
  let active = 0;
  let maximumActive = 0;
  const scheduler = createRpcRequestScheduler({ monotonicNow: clock.now, sleep: clock.sleep });

  const requests = [0, 1, 2].map((index) => scheduler.schedule(readMetadata(), async () => {
    starts.push({ index, at: clock.now() });
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    clock.advance(10);
    active -= 1;
    return index;
  }));

  assert.deepEqual(await Promise.all(requests), [0, 1, 2]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(starts.map(({ index }) => index), [0, 1, 2]);
  assert.ok(starts.slice(1).every((entry, index) => entry.at - starts[index].at >= 500));
  assert.deepEqual(scheduler.ledger.debugSafeEntries().map(({ sequence }) => sequence), [1, 2, 3]);
  await scheduler.close();
});

test("read-only rate limiting retries exactly twice after 2s and 5s then fails safely", async () => {
  const clock = fakeTime();
  const scheduler = createRpcRequestScheduler({ monotonicNow: clock.now, sleep: clock.sleep });
  let attempts = 0;

  await assert.rejects(scheduler.schedule(readMetadata("GET_BALANCE"), async () => {
    attempts += 1;
    throw Object.assign(new Error("rate limited"), { status: 429 });
  }), (error) => {
    assert.equal(error.classification, "RPC_RATE_LIMITED");
    assert.equal(error.methodClass, "GET_BALANCE");
    return true;
  });

  assert.equal(attempts, 3);
  assert.deepEqual(clock.sleeps, [2000, 5000]);
  assert.deepEqual(scheduler.ledger.debugSafeEntries().map(({ retryNumber, outcome }) => ({ retryNumber, outcome })), [
    { retryNumber: 0, outcome: "RPC_RATE_LIMITED" },
    { retryNumber: 1, outcome: "RPC_RATE_LIMITED" },
    { retryNumber: 2, outcome: "RPC_RATE_LIMITED" },
  ]);
  await scheduler.close();
});

test("non-rate read error and SEND_RAW_TRANSACTION are never retried", async () => {
  for (const scenario of [
    { metadata: readMetadata("GET_GENESIS_HASH"), error: new Error("invalid genesis") },
    { metadata: { methodClass: "SEND_RAW_TRANSACTION", mutationCapability: "write", signaturePersisted: true }, error: Object.assign(new Error("rate limited"), { status: 429 }) },
  ]) {
    const clock = fakeTime();
    const scheduler = createRpcRequestScheduler({ monotonicNow: clock.now, sleep: clock.sleep });
    let attempts = 0;
    await assert.rejects(scheduler.schedule(scenario.metadata, async () => {
      attempts += 1;
      throw scenario.error;
    }));
    assert.equal(attempts, 1);
    assert.deepEqual(clock.sleeps, []);
    await scheduler.close();
  }
});

test("pre-sign cool-off waits at least 3000ms after the final preflight RPC", async () => {
  const clock = fakeTime();
  const scheduler = createRpcRequestScheduler({ monotonicNow: clock.now, sleep: clock.sleep });
  await scheduler.schedule(readMetadata("GET_RENT_EXEMPTION"), async () => {
    clock.advance(25);
  });
  const finalReadCompletedAt = clock.now();
  await scheduler.waitForCoolOff(3000);
  let blockhashStartedAt = -1;
  await scheduler.schedule(readMetadata("GET_LATEST_BLOCKHASH"), async () => {
    blockhashStartedAt = clock.now();
  });
  assert.ok(blockhashStartedAt - finalReadCompletedAt >= 3000);
  assert.deepEqual(clock.sleeps, [3000]);
  await scheduler.close();
});

test("abort rejects queued work and leaves no request or timer after it settles", async () => {
  const clock = fakeTime();
  let releaseActive;
  const activeGate = new Promise((resolve) => { releaseActive = resolve; });
  const starts = [];
  const scheduler = createRpcRequestScheduler({ monotonicNow: clock.now, sleep: clock.sleep, queueCapacity: 2 });
  const active = scheduler.schedule(readMetadata(), async () => {
    starts.push("active");
    await activeGate;
  });
  const queued = scheduler.schedule(readMetadata(), async () => { starts.push("queued"); });
  await Promise.resolve();
  const aborted = scheduler.abort(new Error("terminal result"));
  releaseActive();

  await active;
  await assert.rejects(queued, /terminal result/);
  await aborted;
  assert.deepEqual(starts, ["active"]);
  assert.deepEqual(scheduler.status(), { active: 0, pending: 0, aborted: true, closed: true });
});

test("bounded queue rejects overflow without starting the rejected request", async () => {
  const clock = fakeTime();
  let releaseActive;
  const activeGate = new Promise((resolve) => { releaseActive = resolve; });
  const scheduler = createRpcRequestScheduler({ monotonicNow: clock.now, sleep: clock.sleep, queueCapacity: 1 });
  const active = scheduler.schedule(readMetadata(), () => activeGate);
  const queued = scheduler.schedule(readMetadata(), async () => {});
  await assert.rejects(scheduler.schedule(readMetadata(), async () => {}), /queue capacity/);
  releaseActive();
  await Promise.all([active, queued]);
  await scheduler.close();
});
