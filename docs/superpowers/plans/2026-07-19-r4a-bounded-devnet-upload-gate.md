# R4A Bounded Devnet Upload Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a fail-closed, bounded devnet buffer-write entrypoint without executing it or migrating real runtime state during R4A.

**Architecture:** Keep the existing read-only planner and sequential core, add a separate explicit live CLI, and compose it through dependency-injected preflight, lease, migration, signing, send, and reconciliation adapters. An ignored lease directory provides atomic contention exclusion and atomic archival; schema-v3 state stores public chunk/window evidence only.

**Tech Stack:** Node.js 24 built-in test runner, `@solana/web3.js` 1.98.4, Solana/Agave 2.2.20, Anchor 0.31.1, PowerShell and Ubuntu GitHub Actions.

## Global Constraints

- R4A sends zero devnet transactions and never executes `upload-buffer-throttled` against devnet.
- Real `.devnet/state.json` remains ignored, untracked, schema v2, and byte/mtime unchanged.
- Canonical RPC, genesis, program, buffer, authority, allocation, binary hash, reserve, packet policy, and acknowledgement are exact constants.
- `maxChunks <= 5`, `delayMs >= 1000`, concurrency is one, and the first 429/failure/`UNKNOWN` stops.
- No global Solana config/wallet fallback, credentialized URL, automatic resend, buffer replacement, close, regeneration, finalize, faucet, mint, or escrow flow.
- Tests precede production code and each RED result is captured before GREEN.

---

### Task 1: Explicit live CLI contract and dry validation

**Files:**
- Create: `scripts/devnet/upload-buffer-cli.mjs`
- Create: `scripts/devnet/upload-execution-contract.mjs`
- Create: `tests/devnet/upload-execution-contract.test.mjs`
- Create: `tests/devnet/upload-buffer-cli-safety.test.mjs`

**Interfaces:**
- Produces: `parseUploadCommand(argv)`, `validateUploadRequest(input, paths)`, `sanitizeExecutionOutput(value)`, `main(argv, dependencies)`.
- Consumes: canonical identities and devnet validation from existing safety/planner modules.

- [ ] Write failing tests for every required argument, acknowledgement `R4_BUFFER_UPLOAD`, canonical URL/program/buffer/authority, credential rejection, ignored explicit paths, `maxChunks` 1..5, `delayMs >= 1000`, and no environment/global fallback.
- [ ] Run `node --test tests/devnet/upload-execution-contract.test.mjs tests/devnet/upload-buffer-cli-safety.test.mjs` and capture missing-module/export RED.
- [ ] Implement strict argument parsing with an exact-key allowlist and public command dispatch for `upload-buffer-throttled`, `inspect-state-migration`, `migrate-state-v3`, `reconcile-upload-lease`, and `release-upload-lease`.
- [ ] Add dependency-spy tests proving import and dry validation do not read a signer, fetch a blockhash, send, simulate, finalize, close, or regenerate.
- [ ] Run the focused CLI tests to GREEN.

### Task 2: State-v3 inspection and transactional fixture migration

**Files:**
- Modify: `scripts/devnet/state.mjs`
- Create: `scripts/devnet/state-migration-command.mjs`
- Modify: `tests/devnet/state.test.mjs`
- Create: `tests/devnet/state-migration-command.test.mjs`

**Interfaces:**
- Produces: `inspectStateMigration(input)`, `migrateStateV3(input, adapters)`, `validateUploadStateV3(state, expected)`, schema-v3 `uploadWindows` records.
- Consumes: atomic state save, collision-safe backup, secret-material validation, explicit ignored-path checker.

- [ ] Write failing tests for read-only schema-v2 inspection, exact sanitized diff summary, v2 direct-upload rejection, canonical binding mismatches, ignored-path failure, partial write, post-write validation failure, rollback, collision backup, and idempotent v3 replay.
- [ ] Run the two state suites and capture RED from missing migration APIs.
- [ ] Extend v2→v3 migration with `uploadWindows: []` while preserving chunks/fingerprint and historical public evidence.
- [ ] Implement migration sequence: validate source and binary; backup; atomic replace; reread; validate; rollback atomically on failure while preserving backup.
- [ ] Prove synthetic/copied fixtures only and rerun focused state tests to GREEN.

### Task 3: Atomic execution lease and evidence-gated release

**Files:**
- Create: `scripts/devnet/upload-execution-lease.mjs`
- Create: `tests/devnet/upload-execution-lease.test.mjs`

**Interfaces:**
- Produces: `acquireUploadLease(input, fsAdapter)`, `reconcileUploadLease(input, adapters)`, `releaseUploadLease(input, adapters)`, `leasePaths(statePath, executionId, evidenceHash)`.
- Result enums: `ACTIVE_PROCESS`, `UNRESOLVED_SENT_OR_UNKNOWN`, `IDENTITY_OR_ONCHAIN_MISMATCH`, `INSUFFICIENT_EVIDENCE`, `SAFE_TO_RELEASE`, and lifecycle `ARCHIVED/RELEASED`.

- [ ] Write failing tests for two-process contention, partial acquisition, active PID, stale age without proof, unresolved `SENT`/`UNKNOWN`, identity/on-chain mismatch, incomplete outcome, state-hash drift, stale reconciliation hash, explicit acknowledgement, archive rename failure, preserved active lease after failure, and idempotent matching replay.
- [ ] Run `node --test tests/devnet/upload-execution-lease.test.mjs` and capture missing-module RED.
- [ ] Implement atomic active-directory creation and public `lease.json`; never auto-remove a corrupt/partial/stale lease.
- [ ] Implement strictly read-only reconciliation and deterministic SHA-256 evidence over execution ID, full state hash, identities, plan fingerprint, terminal outcome, and on-chain observations.
- [ ] Implement release as fresh reconciliation, exact evidence-hash comparison, terminal outcome persistence, then same-filesystem active-directory rename to ignored history. On rename failure retain the active lease; matching archived replay returns idempotent success.
- [ ] Rerun lease tests to GREEN and scan outputs for secret-bearing fields.

### Task 4: Production preflight and persist-before-send orchestration

**Files:**
- Create: `scripts/devnet/upload-execution-command.mjs`
- Modify: `scripts/devnet/throttled-uploader.mjs`
- Create: `tests/devnet/upload-execution-command.test.mjs`
- Modify: `tests/devnet/throttled-uploader.test.mjs`

**Interfaces:**
- Produces: `preflightUploadExecution(input, adapters)`, `executeUploadWindow(input, adapters)`, production RPC/signer/transaction adapters.
- Consumes: planner chunks, funding calculation, schema-v3 checkpoint loader, lease acquisition, sequential uploader.

- [ ] Write failing ordering tests asserting genesis→program→buffer→binary/plan→funding→lease→uncertain reconciliation→selection, with no signer/blockhash/send before lease and successful preflight.
- [ ] Write failing funding tests for exact required balance, one lamport short, malformed/unexpected rent/fee results, and unchanged 250,000,000 reserve.
- [ ] Write failing send-path tests for fresh blockhash per selected chunk, exact one transaction, locally derived signature, atomic `SENT` persistence before send, bounded confirmation, exact full-chunk match, minimum delay, concurrency one, and five-chunk ceiling.
- [ ] Write failing terminal tests for first 429, non-429 ambiguous send error, `UNKNOWN`, confirmed failure, post-confirmation byte mismatch, and existing unresolved records preventing a new signature.
- [ ] Run command/uploader tests and capture RED.
- [ ] Implement minimal orchestration by composing the existing planner and `runPersistedSequentialUpload`; keep finalize/close/regenerate absent from the adapter surface.
- [ ] Persist a sanitized upload-window outcome and leave the lease in `RECONCILIATION_REQUIRED` for the separate reconciliation/release protocol.
- [ ] Run focused command/uploader tests to GREEN.

### Task 5: Production-entrypoint local-validator proof

**Files:**
- Create: `tests/local-validator/upload-execution-command.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the public CLI dispatcher and production execution orchestration with injected local RPC, test signer loader, and no-op clock.
- Produces: real local-loader buffer evidence for bounded execution, interruption, reconciliation, release, and resume.

- [ ] Write a failing local-validator test using only test-owned ledger, state, authority, buffer, and genesis account fixtures; never reference `.devnet`.
- [ ] Require six nonmatching chunks, execute at most five, verify concurrency one and exact first-five bytes, interrupt/reload, reconcile/release the first lease, then execute the final chunk and prove exact binary equality.
- [ ] Cover crash with active lease, read-only reconciliation, explicit release, archive preservation, and production policy `delayMs: 1000` with injected no-op sleep.
- [ ] Run the local integration and capture RED before completing the local adapter wiring.
- [ ] Wire Ubuntu CI to run the new suite as mandatory, without devnet RPC, faucet, secrets, or `continue-on-error`.
- [ ] Rerun local integration to GREEN.

### Task 6: Read-only R4A preflight, documentation, verification, and publication

**Files:**
- Modify: `README.md` only if command boundaries need a public pointer.
- Modify: `docs/PHASE_2_DEVNET_BLOCKED_2026-07-16.md`
- Track: `docs/superpowers/specs/2026-07-19-r4a-bounded-devnet-upload-gate-design.md`
- Track: `docs/superpowers/plans/2026-07-19-r4a-bounded-devnet-upload-gate.md`

**Interfaces:**
- Consumes: all completed commands/tests and the existing read-only RPC adapter.
- Produces: R4A evidence, two scoped commits, pushed final SHA, and terminal Ubuntu CI verdict.

- [ ] Run all focused suites before any live RPC. Capture real state SHA-256/mtime/schema, balance, history count, program disposition, buffer metadata/data hash, and file list.
- [ ] Run exactly one read-only preflight with explicit devnet RPC. It must report migration required, schema v2, refreshed funding/headroom, exact/remaining chunks, policy 5/1000, and `liveWriteExecuted: false`.
- [ ] Capture the same observations after preflight and require unchanged state/history/balance/buffer/program disposition except explicitly reported external read-only observation drift; stop on 429.
- [ ] Run full devnet tooling, vector byte parity, new migration/lease/CLI/uploader suites, both local-validator suites, existing 26 integration cases, Rust workspace, typecheck, root/tool rustfmt, Anchor build and IDL identity, optimized SBF hash, YAML validation, diff check, secret scan, ignored artifacts, and parked repositories.
- [ ] Commit implementation/tests/CI as `feat: add bounded devnet upload execution gate` and audit exact paths/secrets.
- [ ] Commit design/plan/checkpoint docs as `docs: define first throttled upload window` and audit exact paths/secrets.
- [ ] Push `main` normally, wait for terminal Ubuntu CI success on the exact final SHA, and verify local/origin 0/0 with tracked worktree clean.
- [ ] Report the safe R4B command sequence without executing migration, release, or upload against real state.
