# R4B-R1 Reconciliation Recovery Implementation Plan

> **For agentic workers:** Use failure-first TDD and verification-before-completion for every implementation task.

**Goal:** Conclusively reconcile the finalized R4B `SENT` record using strictly
read-only devnet evidence, provide a separately acknowledged local-only apply
command, and prevent raw RPC failures from escaping the CLI.

**Architecture:** Normalize read-only signature, transaction, instruction, and
buffer evidence in the production collector. Keep deterministic policy and
evidence hashing in the lease module. Apply only exact proposed transitions
through an atomic local state replacement; retain lease archival as a separate
freshly gated command.

## Fixed constraints

- Never invoke `upload-buffer-throttled` or send/simulate any devnet transaction.
- Never load the real signer or mutate/archive/release the real active lease.
- Never mutate real `.devnet/state.json`; apply/release tests use fixtures only.
- Read-only live reconciliation is allowed only after focused tests are green.
- RED tests must be observed before production implementation.

### Task 1: Transaction-proof reconciliation

**Files:** `scripts/devnet/upload-execution-command.mjs`,
`scripts/devnet/upload-execution-lease.mjs`, and their focused tests.

- [x] Add RED cases for successful `SENT`/`UNKNOWN`, wrong or ambiguous
  transaction identity, failed/not-found/not-finalized signatures, byte
  mismatch, deterministic complete evidence binding, and no mutation.
- [x] Collect only normalized public evidence from finalized read RPC methods.
- [x] Validate the complete stored plan and produce exact proposed transitions,
  verified transaction summaries, and deterministic hashes.
- [x] Keep every ambiguous branch fail-closed.

### Task 2: Explicit local reconciliation apply

**Files:** `scripts/devnet/upload-execution-contract.mjs`,
`scripts/devnet/upload-buffer-cli.mjs`, `scripts/devnet/upload-execution-lease.mjs`,
and focused contract/CLI/lease tests.

- [x] Add parser and dispatch RED tests for `apply-upload-reconciliation` and
  acknowledgement `R4_APPLY_UPLOAD_RECONCILIATION`.
- [x] Add stale state, stale lease, hash mismatch, idempotent replay, atomic
  write, post-validation rollback, and import/no-onchain-write RED tests.
- [x] Implement fresh evidence recomputation and exact atomic
  `SENT/UNKNOWN -> CONFIRMED` transitions with sanitized window outcome.
- [x] Make release reject pre-apply evidence and accept only a new
  zero-transition reconciliation hash.

### Task 3: Stable CLI error sanitizer

**Files:** `scripts/devnet/upload-buffer-cli.mjs` and
`tests/devnet/upload-buffer-cli-safety.test.mjs`.

- [x] Add RED cases for structured/nested 429, response bodies, headers/request
  IDs, credentialized query strings, raw transactions, key arrays, and
  mnemonic-like text.
- [x] Emit only stable structured classifications, including
  `RPC_RATE_LIMITED`, without copying any raw error field.
- [x] Prove imports have no RPC, filesystem-mutation, signer, blockhash, send,
  or simulation side effects.

### Task 4: Verification and read-only checkpoint

- [x] Run focused unit suites, state-v3 24/24, local-validator reconciliation
  and interruption/resume suites, full devnet unit tests, integration tests,
  typecheck/build/format checks, `git diff --check`, and focused secret scans.
- [x] Snapshot real state/lease hash+mtime and public on-chain invariants; run
  exactly one public read-only reconciliation; snapshot again and prove no
  state, lease, balance, history, program, or buffer mutation.
- [x] Update the blocked checkpoint with the sanitized R4B-R1 result without
  applying or releasing the real lease.
- [ ] Commit scoped implementation and documentation, push normally, and wait
  for terminal CI success on the exact SHA.
