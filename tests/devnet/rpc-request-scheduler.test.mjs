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

function scriptedTime({ now = 0, advances = [] } = {}) {
  const sleeps = [];
  return {
    now: () => now,
    sleeps,
    set(value) { now = value; },
    async sleep(requestedMs) {
      sleeps.push(requestedMs);
      now += advances.length > 0 ? advances.shift() : requestedMs;
    },
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

test("early wake at 499ms waits again before the actual invocation boundary", async () => {
  const clock = scriptedTime({ advances: [499, 1] });
  const starts = [];
  const scheduler = createRpcRequestScheduler({ monotonicNow: clock.now, sleep: clock.sleep });
  await scheduler.schedule(readMetadata(), async () => { starts.push(clock.now()); });
  await scheduler.schedule(readMetadata(), async () => { starts.push(clock.now()); });

  assert.deepEqual(starts, [0, 500]);
  assert.deepEqual(clock.sleeps, [500, 1]);
  await scheduler.close();
});

test("multiple early wakes and fractional 499.999ms cannot grant early", async () => {
  const clock = scriptedTime({ advances: [200, 200, 99.999, 0.001] });
  const starts = [];
  const scheduler = createRpcRequestScheduler({ monotonicNow: clock.now, sleep: clock.sleep });
  await scheduler.schedule(readMetadata(), async () => { starts.push(clock.now()); });
  await scheduler.schedule(readMetadata(), async () => { starts.push(clock.now()); });

  assert.deepEqual(starts, [0, 500]);
  assert.equal(clock.sleeps.length, 4);
  assert.ok(clock.sleeps.every((value) => value > 0));
  await scheduler.close();
});

test("exact 500ms is allowed without another sleep", async () => {
  const clock = scriptedTime({ advances: [500] });
  const starts = [];
  const scheduler = createRpcRequestScheduler({ monotonicNow: clock.now, sleep: clock.sleep });
  await scheduler.schedule(readMetadata(), async () => { starts.push(clock.now()); });
  await scheduler.schedule(readMetadata(), async () => { starts.push(clock.now()); });

  assert.deepEqual(starts, [0, 500]);
  assert.deepEqual(clock.sleeps, [500]);
  await scheduler.close();
});

test("ledger timestamp and sequence are assigned at actual scheduler invocation order", async () => {
  const clock = scriptedTime();
  const observed = [];
  const scheduler = createRpcRequestScheduler({ monotonicNow: clock.now, sleep: clock.sleep });
  for (let index = 0; index < 3; index += 1) {
    await scheduler.schedule(readMetadata(), async () => {}, {
      onInvocationStart: (value) => observed.push({ index, ...value }),
    });
  }

  const entries = scheduler.ledger.debugSafeEntries();
  assert.deepEqual(observed.map(({ sequence, startMonotonicMs }) => ({ sequence, startMonotonicMs })),
    entries.map(({ sequence, startMonotonicMs }) => ({ sequence, startMonotonicMs })));
  assert.deepEqual(observed.map(({ index }) => index), [0, 1, 2]);
  await scheduler.close();
});

test("variable observer work cannot shorten literal operation-start spacing", async () => {
  let now = 0;
  const starts = [];
  const observerDelays = [100, 50];
  const scheduler = createRpcRequestScheduler({
    monotonicNow: () => now,
    sleep: async (ms) => { now += ms; },
  });
  for (let index = 0; index < 2; index += 1) {
    await scheduler.schedule(readMetadata(), async () => { starts.push(now); }, {
      onInvocationStart: () => { now += observerDelays[index]; },
    });
  }

  assert.deepEqual(starts, [0, 500]);
  assert.equal(starts[1] - starts[0], 500);
  await scheduler.close();
});

test("observer failure cannot abandon an active request or grant queued work", async () => {
  const starts = [];
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const scheduler = createRpcRequestScheduler({ monotonicNow: () => 0, sleep: async () => {} });
  const first = scheduler.schedule(readMetadata(), async () => { starts.push(0); return pending; }, {
    onInvocationStart: () => { throw new Error("private observer detail"); },
  });
  const second = scheduler.schedule(readMetadata(), async () => { starts.push(0); });
  let closeSettled = false;
  const closing = scheduler.close().then(() => { closeSettled = true; });

  await Promise.resolve();
  assert.deepEqual(starts, [0]);
  assert.equal(closeSettled, false);
  const firstRejected = assert.rejects(first, /RPC scheduler invocation observer failed/);
  const secondRejected = assert.rejects(second, /RPC scheduler invocation observer failed/);
  release();
  await Promise.all([firstRejected, secondRejected]);
  await closing;
  assert.deepEqual(starts, [0]);
  assert.deepEqual(scheduler.status(), { active: 0, pending: 0, aborted: true, closed: true });
});

test("clock regression after an early sleep fails closed before invocation", async () => {
  const clock = scriptedTime({ advances: [-1] });
  let invocations = 0;
  const scheduler = createRpcRequestScheduler({ monotonicNow: clock.now, sleep: clock.sleep });
  await scheduler.schedule(readMetadata(), async () => { invocations += 1; });
  await assert.rejects(scheduler.schedule(readMetadata(), async () => { invocations += 1; }), /clock regression/);
  assert.equal(invocations, 1);
  await scheduler.close();
});

test("abort during request-start wait prevents invocation and drains without background work", async () => {
  let now = 0;
  let releaseWait;
  let waitStarted;
  const waiting = new Promise((resolve) => { waitStarted = resolve; });
  const sleeper = () => new Promise((resolve) => { releaseWait = resolve; waitStarted(); });
  const scheduler = createRpcRequestScheduler({ monotonicNow: () => now, sleep: sleeper });
  await scheduler.schedule(readMetadata(), async () => {});
  let invoked = false;
  const blocked = scheduler.schedule(readMetadata(), async () => { invoked = true; });
  await waiting;
  const aborting = scheduler.abort(new Error("terminal abort"));
  now = 500;
  releaseWait();

  await assert.rejects(blocked, /terminal abort/);
  await aborting;
  assert.equal(invoked, false);
  assert.deepEqual(scheduler.status(), { active: 0, pending: 0, aborted: true, closed: true });
});

test("retry attempts also obey literal actual invocation spacing and sequence order", async () => {
  const clock = scriptedTime({ advances: [1999, 1, 499, 1] });
  const starts = [];
  let attempts = 0;
  const scheduler = createRpcRequestScheduler({ monotonicNow: clock.now, sleep: clock.sleep });
  const value = await scheduler.schedule(readMetadata("GET_BALANCE"), async () => {
    attempts += 1;
    if (attempts < 2) throw Object.assign(new Error("rate limited"), { status: 429 });
    return 42;
  }, { onInvocationStart: (entry) => starts.push(entry) });

  assert.equal(value, 42);
  assert.ok(starts[1].startMonotonicMs - starts[0].startMonotonicMs >= 500);
  assert.deepEqual(starts.map(({ sequence }) => sequence), [1, 2]);
  await scheduler.close();
});

test("real timers never invoke sequential requests below the literal 500ms floor", { timeout: 10_000 }, async (t) => {
  const starts = [];
  const scheduler = createRpcRequestScheduler();
  for (let index = 0; index < 8; index += 1) {
    await scheduler.schedule(readMetadata(), async () => {}, {
      onInvocationStart: ({ startMonotonicMs }) => starts.push(startMonotonicMs),
    });
  }
  for (let index = 1; index < starts.length; index += 1) {
    assert.ok(starts[index] - starts[index - 1] >= 500,
      `actual gap ${starts[index] - starts[index - 1]}ms was below 500ms`);
  }
  const minimumGapMs = Math.min(...starts.slice(1).map((start, index) => start - starts[index]));
  t.diagnostic(`minimum real-timer invocation gap: ${minimumGapMs.toFixed(4)}ms`);
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
  const measurement = await scheduler.waitForCoolOff(3000);
  let blockhashStartedAt = -1;
  await scheduler.schedule(readMetadata("GET_LATEST_BLOCKHASH"), async () => {
    blockhashStartedAt = clock.now();
  });
  assert.ok(blockhashStartedAt - finalReadCompletedAt >= 3000);
  assert.deepEqual(clock.sleeps, [3000]);
  assert.deepEqual(measurement, {
    startedMonotonicMs: finalReadCompletedAt,
    finishedMonotonicMs: finalReadCompletedAt + 3000,
    elapsedMs: 3000,
  });
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
