# R4 Outer Upload Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and publish a deterministic cross-platform outer host that verifies an immutable upload authorization manifest, invokes the existing supervisor at most once, and persists durable execution evidence.

**Architecture:** A closed Node CLI performs pre-spawn verification, consumes an execution ID atomically, streams one owned child into durable logs, enforces an independent timeout, validates the child terminal envelope, and atomically writes a normalized host result. Injected seams make every behavior testable without invoking the real uploader.

**Tech Stack:** Node.js ESM, `node:test`, Solana Web3.js, repository RPC scheduler, Git CLI, GitHub Actions.

## Global Constraints

- Do not execute R4N or invoke the real uploader.
- Do not load a signer, acquire a real upload lease, request a signing blockhash, send a write RPC, migrate state, or reconcile.
- Do not change uploader, scheduler, retry, confirmation, state-transition, funding, lease, escrow, binary, or integration-test behavior.
- Keep R4M permanently `R4M_POST_INVOCATION_BLOCKED_PRE_LEASE_NOOP`.
- Publish exactly one intentional commit only after the complete validation ladder passes.

---

### Task 1: Closed CLI and manifest verifier

**Files:**
- Create: `scripts/devnet/upload-window-host.mjs`
- Test: `tests/devnet/upload-window-host.test.mjs`

**Interfaces:**
- Produces: `parseUploadWindowHostArgs(argv)`, `verifyAuthorizationManifest(parsed, adapters)`.
- Consumes: repository state v3, canonical upload plan utilities, paced RPC scheduler.

- [x] Add failing parser tests for mandatory flags, exact-one invocation, timeout relationship, safe execution IDs, traversal/reserved names, and exact inner command boundary.
- [x] Run `node --test tests/devnet/upload-window-host.test.mjs` and record failure because the module is absent.
- [x] Implement the closed parser and immutable normalized manifest.
- [x] Add failing verifier tests for Git, state, buffer, binary, plan, candidate, lease, lock, and retained-process mismatches.
- [x] Implement production Git/filesystem checks and one paced finalized buffer read without opening the authority path.
- [x] Run the focused tests to green.

### Task 2: Single-use durable evidence

**Files:**
- Modify: `scripts/devnet/upload-window-host.mjs`
- Modify: `tests/devnet/upload-window-host.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: exclusive execution directory, `authorization.json`, `writeJsonAtomic(path, value, adapters)`.

- [x] Add failing tests for exclusive execution-ID consumption, authorization-before-spawn, reuse after failure, ignored result roots, and atomic JSON persistence.
- [x] Implement same-directory temporary write plus rename and leave consumed directories permanently.
- [x] Add the repository-conventional `.devnet/` result-root guidance without creating tracked runtime evidence.
- [x] Run focused tests to green.

### Task 3: Exactly-once child lifecycle

**Files:**
- Modify: `scripts/devnet/upload-window-host.mjs`
- Modify: `tests/devnet/upload-window-host.test.mjs`

**Interfaces:**
- Produces: `runUploadWindowHost(argv, adapters)`, owned process-tree cleanup result.

- [x] Add failing tests for one spawn, no retry on failure/timeout, independent timeout, interruption, cleanup allowance, unrelated-process isolation, and shell-free Windows arguments.
- [x] Implement one `spawn()` call with `shell: false`, POSIX process groups, Windows `taskkill /PID <pid> /T /F`, bounded cleanup, and injectable clocks/timers.
- [x] Run focused tests to green.

### Task 4: Streamed logs and terminal envelope

**Files:**
- Modify: `scripts/devnet/upload-window-host.mjs`
- Modify: `tests/devnet/upload-window-host.test.mjs`
- Create: `tests/devnet/fixtures/fake-upload-supervisor.mjs`

**Interfaces:**
- Produces: separate complete logs, bounded terminal suffix parser, normalized `host-result.json`.

- [x] Add failing tests for separate full streams, bounded memory, valid/missing/malformed terminal JSON, child exit preservation, stream-close ordering, hashes, secret redaction, and lease-telemetry independence.
- [x] Implement streaming hash/size accounting and bounded-line terminal parsing.
- [x] Implement outcome precedence and atomic durable result persistence before final stdout emission.
- [x] Run focused tests and fake-child end-to-end cases to green.

### Task 5: Documentation and full verification

**Files:**
- Modify: `docs/superpowers/plans/2026-07-23-r4n-readiness.md`
- Create: `docs/superpowers/specs/2026-07-26-r4-outer-upload-host-design.md`
- Create: `docs/superpowers/plans/2026-07-26-r4-outer-upload-host.md`

- [x] Document repository ownership, mandatory single-use execution ID, enforced outer timeout, durable evidence location, never-retry rule, and requirement for a fresh authorization manifest.
- [x] Run focused host and supervisor tests, uploader lifecycle/state/plan/identity tests, the complete devnet suite, syntax checks, TypeScript check, Rust tests/formatting, CI YAML parsing, bounded random-port harnesses, `git diff --check`, secret scan, artifact review, and exact changed-path accounting.
- [x] Recheck state/buffer/binary identities and prove no signer, lease, uploader, or write RPC occurred.
- [ ] Review the diff, create one commit `feat(devnet): add bounded upload window host`, push a clean fast-forward `main`, and verify exact-SHA GitHub Actions.

---

### Authorization-contract repair addendum

**Goal:** Repair the remaining reproducibility, request-duration, inner
cleanup, and complete-host-deadline blockers without executing R4N.

- [x] Add RED golden-vector and mutation tests for
  `R4_CANDIDATE_EVIDENCE_V1`.
- [x] Implement deterministic bytes, digest verification, strict candidate
  schema validation, and production host binding.
- [x] Mark the historical digest `LEGACY_NON_REPRODUCIBLE`.
- [x] Add RED scheduler tests for hanging reads, bounded retries, deadline
  exhaustion, distinct outcomes, and one-call ambiguous writes.
- [x] Implement finite per-attempt timeout, AbortSignal propagation,
  method-aware retry, deadline admission, duration, and telemetry timeout
  count.
- [x] Require live-uploader `--rpc-request-timeout-ms`.
- [x] Add RED inner-supervisor tests and implement explicit timer origin,
  runtime, graceful cleanup, halfway escalation, hard cleanup bound,
  child-close handling, and machine-readable timing evidence.
- [x] Add RED host tests and implement six timeout components, complete
  arithmetic, stage timings, finalization timeout, precedence, one child, and
  permanent execution-ID consumption.
- [ ] Complete the full safe validation ladder, one intentional repair commit,
  clean fast-forward push, and exact-SHA CI.

This repair does not authorize R4N.
