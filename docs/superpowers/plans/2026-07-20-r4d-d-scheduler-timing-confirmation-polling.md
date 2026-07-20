# R4D-D Scheduler Timing and Confirmation Polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce literal RPC invocation-start spacing of at least 500 ms and reduce finalized-confirmation polling pressure with a separate 2,000 ms floor.

**Architecture:** The scheduler replaces its one-shot sleep with an abort-aware monotonic wait-until loop, then the ledger resamples the shared monotonic clock immediately before calling the RPC operation. Confirmation polling remains serialized through the same scheduler, with its next normal poll constrained from the latest actual status-attempt start so scheduler retries and normal polling cannot overlap or burst.

**Tech Stack:** Node.js ESM, `node:test`, injected monotonic clocks/sleepers, Solana Web3.js, local `solana-test-validator`.

## Global Constraints

- Local-only source, test, and documentation changes; never call live devnet.
- Never load the real signer or mutate real `.devnet/state.json` or lease archives.
- Production global RPC gap remains exactly 500 ms.
- Confirmation normal polling floor is exactly 2,000 ms.
- Read-only rate-limit backoffs remain exactly 2,000 ms then 5,000 ms.
- `SEND_RAW_TRANSACTION` remains one attempt with no retry.
- Preserve R4D-C facts and verdict exactly; do not claim a provider quota.
- Publish exactly two commits with the approved messages; no amend or force push.

---

### Task 1: Failure-first scheduler invocation timing

**Files:**
- Modify: `tests/devnet/rpc-request-scheduler.test.mjs`
- Modify: `tests/devnet/rpc-request-ledger.test.mjs`
- Modify: `scripts/devnet/rpc-request-scheduler.mjs`
- Modify: `scripts/devnet/rpc-request-ledger.mjs`

**Interfaces:**
- `createRpcRequestLedger().record(metadata, operation, options)` accepts an optional scheduler-supplied `invocationMonotonicNow` clock and synchronous `onInvocationStart` observer.
- `createRpcRequestScheduler().schedule(metadata, operation, options)` accepts optional `notBeforeMonotonicMs` and `onInvocationStart` test/telemetry seams.
- The invocation observer receives only `{ sequence, startMonotonicMs, retryNumber }`.

- [x] **Step 1: Add deterministic early-wake RED tests**

Add a clock whose sleeper advances 499 ms for an initial 500 ms request, then advances the requested remainder. Assert that actual invocation observer timestamps never differ by less than 500 ms. Cover repeated early wakes, exact 500 ms, 499.999 ms, clock regression, abort while waiting, FIFO/concurrency one, retry pacing, sequence order, and no post-close invocation.

```js
const starts = [];
await scheduler.schedule(readMetadata(), async () => {}, {
  onInvocationStart: ({ sequence, startMonotonicMs }) => starts.push({ sequence, startMonotonicMs }),
});
assert.ok(starts[1].startMonotonicMs - starts[0].startMonotonicMs >= 500);
```

- [x] **Step 2: Run RED and retain the expected failures**

Run:

```text
node --test tests/devnet/rpc-request-scheduler.test.mjs tests/devnet/rpc-request-ledger.test.mjs
```

Expected: early-wake spacing and shared invocation-boundary assertions fail against the one-shot scheduler/missing API.

- [x] **Step 3: Implement strict monotonic wait-until and shared boundary**

The minimal algorithm is:

```js
while (true) {
  if (aborted) throw abortError;
  const now = readMonotonic();
  if (now < previousObservedNow) throw new Error("RPC scheduler monotonic clock regression");
  if (now >= earliestStart) return now;
  await sleep(earliestStart - now);
}
```

After the wait succeeds, resample the shared monotonic clock inside the ledger immediately before invoking the operation. Use that sample as the ledger start and scheduler's previous actual start. Assign ledger sequence synchronously immediately before that sample. Notify external observers only after the operation has started, and always await the active operation before surfacing a sanitized observer failure. Apply the same wait helper to pre-sign cool-off. Every early iteration must await a positive remaining duration.

- [x] **Step 4: Run scheduler/ledger GREEN**

Run the same command and require all tests to pass with no warnings or leaked work.

- [x] **Step 5: Add a real-timer stress test**

Schedule multiple sequential no-op operations with the production 500 ms floor and `performance.now()`. Assert every actual observer delta is `>=500` without an upper-duration assertion. Keep the test Windows/Ubuntu compatible.

### Task 2: Failure-first finalized confirmation polling floor

**Files:**
- Modify: `tests/devnet/upload-execution-command.test.mjs`
- Modify: `tests/devnet/upload-buffer-cli-safety.test.mjs`
- Modify: `scripts/devnet/upload-execution-command.mjs`
- Modify: `scripts/devnet/upload-execution-contract.mjs`

**Interfaces:**
- Production confirmation remains `confirmSignature(signature, timeoutMs)`.
- Sanitized result adds `rpcRequestPolicy` with exact keys `globalRequestStartGapMs`, `confirmationPollIntervalMs`, and `rateLimitRetryScheduleMs`.
- Production policy values are `500`, `2000`, and `[2000, 5000]`.

- [x] **Step 1: Add polling-pressure RED tests**

Use an injected monotonic clock and status fixture that finalizes after about 13 seconds. Assert normal status invocation starts are at least 2,000 ms apart, three confirmations use materially fewer than 46 status attempts, all attempts keep the same signature, and sanitized configuration exposes the three approved values.

```js
assert.deepEqual(runtime.dependencies.rpcRequestPolicy, {
  globalRequestStartGapMs: 500,
  confirmationPollIntervalMs: 2000,
  rateLimitRetryScheduleMs: [2000, 5000],
});
```

- [x] **Step 2: Add retry/normal-timer exclusion RED test**

Make the first status attempt return 429, the bounded retry return nonterminal, and the next normal poll finalize. Assert the next normal start is at least 2,000 ms after the retry's actual start, with no overlap, burst, resend, or signature change.

- [x] **Step 3: Run RED**

Run:

```text
node --test --test-name-pattern="confirmation|policy" tests/devnet/upload-execution-command.test.mjs tests/devnet/upload-buffer-cli-safety.test.mjs
```

Expected: the current 250 ms polling behavior and absent public policy fail.

- [x] **Step 4: Implement minimal polling floor**

Track the latest actual `GET_SIGNATURE_STATUSES` attempt start through the scheduler observer, including retries. Pass `notBeforeMonotonicMs = lastStatusAttemptStart + 2000` only to the next normal schedule call. Require `finalized` or an error as terminal status; do not resend/re-sign or advance to another chunk before terminal evidence. Post-send byte reads remain fresh scheduler calls.

- [x] **Step 5: Run focused GREEN**

Run the focused command plus complete upload execution/CLI suites and require all tests to pass.

### Task 3: Production-path local-validator coverage

**Files:**
- Modify: `tests/local-validator/upload-execution-command.test.mjs`

**Interfaces:**
- Reuse `createProductionUploadDependencies` with generated identities and temporary state/keypairs only.
- Capture invocation starts through the scheduler seam; never inspect request bodies or signed bytes.

- [x] **Step 1: Extend the three-chunk scenario**

Assert global actual-start gaps `>=500`, confirmation normal starts `>=2000`, finalized statuses, exact buffer bytes, exactly three sends, and clean reconciliation/archive.

- [x] **Step 2: Add injected early wake, status 429, abort-wait, and confirmation interruption assertions**

Each scenario must prove one send maximum for its chunk, the same public signature, no next-chunk advancement on uncertainty, and no timer/request after scheduler close/abort.

- [x] **Step 3: Run local-validator GREEN**

Run:

```text
node --test tests/local-validator/throttled-uploader.test.mjs
node --test tests/local-validator/upload-execution-command.test.mjs
```

Require both suites to pass and leave no validator process.

### Task 4: Full verification and no-mutation proof

**Files:**
- Modify only files already listed if a scoped regression is found.

**Interfaces:**
- Compare real state/archive SHA-256 and mtimes against Gate 0.
- Produce sanitized test counts and hygiene evidence; make no live RPC call.

- [x] **Step 1: Run focused and full JavaScript suites**
- [x] **Step 2: Run local-validator and 26-case Anchor-compatible integration**
- [x] **Step 3: Run Rust, TypeScript, rustfmt, vectors, optimized SBF, IDL identity, YAML, and `git diff --check`**
- [x] **Step 4: Run focused secret/raw-RPC/key-array scans**
- [x] **Step 5: Re-hash state and all three archives; verify every hash/mtime is unchanged**
- [x] **Step 6: Verify ignored artifacts, no relevant process, and five parked repositories unchanged**

### Task 5: Independent review and publication

**Files:**
- Create: `docs/PHASE_2_R4D_D_CHECKPOINT_2026-07-20.md`
- Include plan/test/source files in the implementation commit.

**Interfaces:**
- Review must explicitly certify literal actual-boundary pacing, no epsilon workaround, polling/retry separation, no timer leak, and unchanged send/reconciliation rules.

- [x] **Step 1: Perform an independent diff/contract review**
- [x] **Step 2: Commit implementation/tests/plan**

```text
git commit -m "fix(devnet): enforce literal RPC pacing intervals"
```

- [ ] **Step 3: Write the sanitized checkpoint and self-review it**
- [ ] **Step 4: Commit documentation only**

```text
git commit -m "docs(devnet): record R4D scheduler timing review"
```

- [ ] **Step 5: Push normally and wait for exact-final-SHA Ubuntu CI SUCCESS**

Do not amend, force push, run a live observation, or open another upload window.
