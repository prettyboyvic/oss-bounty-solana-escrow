# R4G Confirmation-Duration Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve an integer monotonic confirmation duration for every future
chunk that reaches authoritative finalized success, without changing upload
safety or inventing historical R4G values.

**Architecture:** Measure elapsed time in the sequential uploader from the
existing confirmation-wait boundary immediately before `confirm()` until it
returns the finalized status used by reconciliation. Carry public
`{ chunkIndex, confirmationDurationMs }` records through the confirmed chunk,
uploader result, state upload-window record, and sanitized CLI output;
historical chunks/windows remain valid when the field is absent.

**Tech Stack:** Node.js ESM, `node:test`, injected monotonic clocks, schema-v3
JSON state, sanitized CLI contracts, Markdown checkpoint documentation.

## Global Constraints

- Source/test/publication only; no signer, blockhash-for-send, Solana write, or
  uploader invocation.
- Do not edit ignored `.devnet` state or archives.
- Do not change `MAX_UPLOAD_CHUNKS`, polling, retry, pacing, signing,
  transaction construction, reconciliation, or lease behavior.
- Historical R4G per-chunk durations remain unavailable and must never be
  estimated or synthesized.
- Preserve old upload-window records that do not contain `confirmations`.
- Publish at most one normal commit with message
  `fix(devnet): preserve per-chunk confirmation duration` after all gates pass.

---

### Task 1: Failure-first duration lifecycle

**Files:**
- Modify: `tests/devnet/throttled-uploader.test.mjs`
- Modify: `tests/devnet/state.test.mjs`
- Modify: `tests/devnet/upload-execution-command.test.mjs`
- Modify: `scripts/devnet/state.mjs`
- Modify: `scripts/devnet/throttled-uploader.mjs`
- Modify: `scripts/devnet/upload-execution-command.mjs`

**Interfaces:**
- `runSequentialUpload(input)` and `runPersistedSequentialUpload(input)` accept
  optional `monotonicNow`, defaulting to `performance.now()`.
- Results add `confirmations: Array<{ chunkIndex: number,
  confirmationDurationMs: number }>`.
- Confirmed chunk records optionally retain `confirmationDurationMs`; historical
  confirmed chunks without it remain valid.
- `executeUploadWindow()` stores the same array in the new upload-window record
  and returns it in the public result. Caught later-chunk errors retain already
  completed confirmation telemetry in their terminal window.

- [x] **Step 1: Add RED tests for successful and non-successful outcomes**

Use a fake clock that advances from 100 to 12,101 across `confirm()` and assert:

```js
assert.deepEqual(result.confirmations, [{
  chunkIndex: 0,
  confirmationDurationMs: 12001,
}]);
```

Add an immediate finalized case producing zero, a multi-poll production case
using the injected scheduler clock, and timeout/error/mismatch/rate-limit cases
that produce no finalized confirmation record while preserving current status
and one-send behavior. Add a two-chunk case proving chunk 0 telemetry remains
durable when chunk 1 throws, plus non-finite/regressing-clock rejection.

- [x] **Step 2: Run focused RED**

Run:

```text
node --test --test-name-pattern="confirmation duration|confirmation telemetry" tests/devnet/throttled-uploader.test.mjs tests/devnet/upload-execution-command.test.mjs
```

Expected: assertions fail because `confirmations` is absent.

- [x] **Step 3: Implement the minimum monotonic measurement**

Immediately before the existing `await confirm(...)`, capture
`confirmationStartedAtMs = monotonicNow()`. Capture the end after it returns,
reject a non-finite or regressing clock, and append only finalized successful
reconciliation:

```js
confirmations.push({
  chunkIndex: chunk.index,
  confirmationDurationMs: Math.ceil(confirmationFinishedAtMs - confirmationStartedAtMs),
});
```

Return `confirmations` on every terminal result and pass it unchanged through
`executeUploadWindow()` to the upload-window record and public output. Save the
optional duration on the confirmed chunk in the same atomic persistence event;
collect those events so a later caught error also retains partial evidence.

- [x] **Step 4: Run focused GREEN**

Run the RED command again, then the complete uploader/command suites. Require
all tests to pass with unchanged send count, lifecycle ordering, and policy.

### Task 2: Sanitized schema, compatibility, and publication note

**Files:**
- Modify: `tests/devnet/upload-execution-contract.test.mjs`
- Modify: `tests/devnet/upload-buffer-cli-safety.test.mjs`
- Modify: `scripts/devnet/upload-execution-contract.mjs`
- Modify: `docs/PHASE_2_R4G_CHECKPOINT_2026-07-22.md`

**Interfaces:**
- Sanitized upload results allow `confirmations` only when every record has
  exactly `chunkIndex` and non-negative integer `confirmationDurationMs`, in
  strictly increasing chunk-index order matching `confirmedIndexes`.
- Absence of `confirmations` remains readable for historical records/results.

- [x] **Step 1: Add RED sanitizer/compatibility tests**

Assert a valid future result survives `sanitizeExecutionOutput()` unchanged;
negative, fractional, duplicate, reordered, mismatched, or extra-key records
are rejected. Assert an old upload window/result without `confirmations` remains
accepted and zero milliseconds remains distinct from missing historical data.

- [x] **Step 2: Run sanitizer RED**

Run:

```text
node --test --test-name-pattern="confirmation telemetry|historical" tests/devnet/upload-execution-contract.test.mjs tests/devnet/upload-buffer-cli-safety.test.mjs
```

Expected: malformed confirmation telemetry is currently accepted or valid
telemetry is not explicitly represented by the upload-result contract.

- [x] **Step 3: Implement the closed public telemetry validator**

Extend the upload-result key contract with optional `confirmations`, validate
the exact record shape/unit/order and equality with `confirmedIndexes`, and
reject malformed confirmation data without changing generic secret scanning.

- [x] **Step 4: Add the R4G correction addendum**

Document `TELEMETRY_DEFECT_CONFIRMED`, state that R4G remains valid, historical
durations remain unavailable, the field is future-only, and no devnet
transaction was sent during correction.

- [x] **Step 5: Run focused and full verification**

Run focused uploader/contract suites, state-v3/safety/reconciliation/lease
regressions, full devnet tooling, TypeScript, Rust/rustfmt, static/YAML checks,
diff/link/secret guards, and prove `.devnet` hashes/mtimes are unchanged.

- [x] **Step 6: Independent review and publication handoff**

Review the full diff for correctness, compatibility, fail-closed behavior,
transaction/safety invariance, and live-write exposure. The first review found
one Important durability gap; the test-first correction and re-review resolved
it with zero remaining Critical, Important, or Minor findings. Publication is
limited to the four source paths, five test paths, the R4G checkpoint, and this
plan.

The commit, push, exact-SHA CI result, and final synchronized repository state
are external outcomes of this pre-commit plan. Git history, GitHub Actions, and
the final operator report are authoritative for those outcomes.
