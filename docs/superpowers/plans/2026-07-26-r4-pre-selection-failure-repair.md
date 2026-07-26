# R4 Pre-selection Failure Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist safe terminal evidence for every post-lease failure and
provide an evidence-bound archival recovery path without changing uploader
transaction or retry semantics.

**Architecture:** Canonical telemetry timing remains in the telemetry module.
A focused terminal-evidence module owns boundary tracking, sanitization, and
durable fallback records. The existing execution command installs one
post-acquire guard, while the existing lease and CLI framework own read-only
eligibility and separately acknowledged archival recovery.

**Tech Stack:** Node.js ESM, `node:test`, synchronous durable filesystem
operations, Solana Web3 read-only RPC adapters.

## Global Constraints

- Use test-owned state, lease roots, fake RPC, fake signer, fake process and
  fake filesystem seams only.
- Do not open the real keypair or alter the real residual lease.
- Do not request a signing blockhash, sign, send, or perform a devnet write.
- Do not change transaction construction, selection, payloads, funding,
  pacing, retries, confirmation criteria, or exactly-once semantics.
- Produce one intentional commit and push it as a clean fast-forward to main.

---

### Task 1: Canonical telemetry timing and durable writes

**Files:**
- Create: `scripts/devnet/durable-json.mjs`
- Modify: `scripts/devnet/upload-execution-telemetry.mjs`
- Test: `tests/devnet/upload-execution-telemetry.test.mjs`

**Interfaces:**
- `writeCanonicalJsonAtomic(path, value, adapters = {})`
- `canonicalDurationMs(startElapsedMs, endElapsedMs)`
- Existing `createUploadTelemetryStore` and telemetry V1/V2 readers remain
  source-compatible.

- [ ] Add fractional-cancellation, equivalent-duration, inconsistent-duration,
  non-finite/negative/regression, integer compatibility, stable serialization,
  flush ordering, and rename interruption tests.
- [ ] Run the telemetry test file and record the expected failures.
- [ ] Implement elapsed-endpoint duration derivation and the finite
  representation-derived compatibility bound.
- [ ] Route telemetry persistence through temp-write, file flush, rename, and
  directory flush while retaining monotonic-extension checks.
- [ ] Re-run telemetry tests and transaction-size assertion.

### Task 2: Lifecycle guard and terminal evidence

**Files:**
- Create: `scripts/devnet/upload-terminal-evidence.mjs`
- Modify: `scripts/devnet/upload-execution-command.mjs`
- Modify: `scripts/devnet/upload-buffer-cli.mjs`
- Test: `tests/devnet/upload-terminal-evidence.test.mjs`
- Test: `tests/devnet/upload-execution-command.test.mjs`
- Test: `tests/devnet/upload-buffer-cli-safety.test.mjs`

**Interfaces:**
- `createUploadLifecycleEvidence(input)`
- `writeUploadTerminalEvidence(directory, record, adapters = {})`
- `readUploadTerminalEvidence(directory)`
- `terminalizePostLeaseFailure(context)`

- [ ] Add tests for replay request two, telemetry initialization, subscriber
  installation, normal finish, fallback write, cleanup precedence, and every
  zero-boundary counter.
- [ ] Run those tests and record failures caused by absent terminal evidence.
- [ ] Install one guard immediately after successful lease acquisition.
- [ ] Preserve the primary safe code/phase and append only whitelisted
  secondary codes.
- [ ] Persist normal telemetry where possible and durable `terminal.json`
  fallback evidence before rethrowing the original error.
- [ ] Re-run command, terminal, CLI sanitizer, happy-path, and 1,231-byte tests.

### Task 3: Evidence-bound pre-selection recovery

**Files:**
- Modify: `scripts/devnet/upload-execution-contract.mjs`
- Modify: `scripts/devnet/upload-buffer-cli.mjs`
- Modify: `scripts/devnet/upload-execution-lease.mjs`
- Test: `tests/devnet/upload-preselection-recovery.test.mjs`
- Test: `tests/devnet/upload-buffer-cli-safety.test.mjs`
- Test: `tests/devnet/upload-execution-lease.test.mjs`

**Interfaces:**
- `reconcilePreSelectionUploadLease(input, adapters = {})`
- `recoverPreSelectionUploadLease(input, adapters = {})`
- Commands `reconcile-pre-selection-upload-lease` and
  `recover-pre-selection-upload-lease`.

- [ ] Add incident-shaped eligibility plus live/ambiguous PID, hash, ID, state,
  buffer, candidate, send, unexpected-file, missing-outer-evidence,
  lease-isolation, archive ordering, atomic result, idempotency, and
  authorization-reuse tests.
- [ ] Run the new recovery tests and record expected missing-interface failures.
- [ ] Extend exact CLI parsing with all required immutable bindings and a
  separate mutation acknowledgement/recovery hash.
- [ ] Implement read-only reconciliation using existing state/on-chain
  observations and retained-process scanner results.
- [ ] Re-evaluate under the operation lock, durably write the recovery record,
  atomically archive only the bound lease, and verify archived hashes.
- [ ] Re-run recovery, existing reconciliation/release, and CLI safety tests.

### Task 4: Documentation and validation

**Files:**
- Modify: `README.md`
- Create: `docs/PHASE_2_R4N_PRE_SELECTION_FAILURE_REPAIR_2026-07-26.md`
- Modify: relevant telemetry/lease/R4N readiness documentation discovered by
  exact-path review.

- [ ] Record narrowed historical classification, probable reproducible class,
  proven observability/cleanup defects, retired IDs, untouched real lease, and
  separate future authorizations.
- [ ] Run the complete requested validation ladder sequentially.
- [ ] Verify `git diff --check`, secrets, generated/ignored files, and exact
  changed paths.
- [ ] Re-hash real incident evidence, state, binary, buffer, and lease.
- [ ] Stage exact paths, create the single authorized commit, and push main
  only when the remote is still the verified starting SHA.
- [ ] Observe GitHub Actions for the exact resulting SHA and report its URL and
  conclusion.
