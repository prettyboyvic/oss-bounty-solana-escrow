# R4D-B Validation Snapshot and RPC Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the 223 redundant pre-send buffer reads and add a bounded sanitized per-command RPC scheduler, ledger, and method-class retry policy.

**Architecture:** Preflight captures one finalized, context-bearing buffer response and creates an immutable validation snapshot. One invocation-scoped FIFO scheduler serializes every production RPC, enforces request-start pacing and pre-sign cool-off, and records each attempt through the closed-schema ledger. Read-only rate limits receive bounded method-aware retries; sends never retry and unresolved signatures remain reconciliation-required.

**Tech Stack:** Node.js ESM, `node:test`, `@solana/web3.js`, injected monotonic clocks and RPC adapters.

## Global Constraints

- R4D-B may execute the production entrypoint only against local-validator test identities and temporary state.
- At most one optional read-only devnet observation is allowed after all local gates pass.
- Never load the real authority signer, request a live signing blockhash, simulate, or send.
- Do not mutate real `.devnet/state.json` or archived leases.
- Preserve `historicalMethod: METHOD_UNKNOWN` exactly.
- Production RPC concurrency is one, request-start gap is at least 500 ms, and pre-sign cool-off is at least 3,000 ms.
- Read-only retry backoffs are exactly bounded to at least 2,000 ms then 5,000 ms; `SEND_RAW_TRANSACTION` never retries.

---

### Task 1: Reproduce the redundant read defect

**Files:**
- Modify: `tests/devnet/upload-execution-command.test.mjs`

**Interfaces:**
- Consumes: `executeUploadWindow(request, adapters)` and the existing temporary state fixture.
- Produces: a deterministic 223-confirmed/168-planned regression test based on observed adapter RPC calls.

- [x] Extend the fixture to create mixed contiguous chunk statuses and populate confirmed byte ranges in the mock buffer account.
- [x] Execute the real orchestration with a test-only signer-boundary failure and count buffer account reads.
- [x] Assert one validation-phase buffer fetch and no blockhash/send; before implementation the assertion failed with 224 observed reads.
- [x] Run `node --test --test-name-pattern="R4C-shaped" tests/devnet/upload-execution-command.test.mjs` and preserve the expected RED output.

### Task 2: Implement one immutable finalized validation snapshot

**Files:**
- Create: `scripts/devnet/upload-validation-snapshot.mjs`
- Create: `tests/devnet/upload-validation-snapshot.test.mjs`
- Modify: `scripts/devnet/upload-execution-command.mjs`
- Modify: `scripts/devnet/throttled-uploader.mjs`
- Modify: `tests/devnet/upload-execution-command.test.mjs`
- Modify: `tests/devnet/throttled-uploader.test.mjs`
- Modify: `tests/local-validator/throttled-uploader.test.mjs`

**Interfaces:**
- Produces: `createConfirmedValidationSnapshot(input)`, `validateConfirmedValidationSnapshot(input)`, and `VALIDATION_SNAPSHOT_TTL_MS`.
- Consumes: finalized account context, inspected buffer metadata, state/binary hashes, plan fingerprint, chunks, records, local bytes, and injected monotonic time.

- [x] Write failing unit tests for exact confirmed bytes, gap/overlap/out-of-bounds rejection, account-data mismatch, expiry, clock regression, and state/identity/hash drift.
- [x] Run `node --test tests/devnet/upload-validation-snapshot.test.mjs` and verify failures are caused by the missing API.
- [x] Implement the smallest immutable snapshot and validator satisfying those tests.
- [x] Change preflight to fetch the buffer once through `getAccountInfoAndContext(..., { commitment: "finalized" })`, validate all confirmed chunks from that response, and bind the snapshot.
- [x] Change the persisted scan to require prevalidated confirmed indices and keep `readChunkMatches` only for unresolved or post-send evidence.
- [x] Run the snapshot, execution-command, throttled-uploader, and local-validator uploader tests until GREEN.

### Task 3: Add the sanitized bounded request ledger

**Files:**
- Create: `scripts/devnet/rpc-request-ledger.mjs`
- Create: `tests/devnet/rpc-request-ledger.test.mjs`
- Modify: `scripts/devnet/upload-execution-command.mjs`
- Modify: `scripts/devnet/upload-buffer-cli.mjs`
- Modify: `tests/devnet/upload-buffer-cli-safety.test.mjs`

**Interfaces:**
- Produces: `createRpcRequestLedger(options)`, closed method/outcome enums, bounded debug-safe entries, aggregate summary, and safe public RPC errors.
- Consumes: injected monotonic clock and an operation callback; accepts no request or response payload fields.

- [x] Write failing tests for the closed schema, unknown method rejection, monotonic sequence/timing, capacity eviction, safe 429 classification, and absence of secret-bearing fields.
- [x] Run `node --test tests/devnet/rpc-request-ledger.test.mjs tests/devnet/upload-buffer-cli-safety.test.mjs` and verify RED.
- [x] Implement the minimal ledger with immutable returned snapshots and no background work.
- [x] Create one ledger in `createProductionUploadDependencies` and use it for preflight and production read/write adapters without adding retries.
- [x] Extend CLI error sanitization to expose only `classification`, `methodClass`, `sequence`, and `signaturePersisted` when safe ledger metadata exists.
- [x] Run focused ledger, CLI safety, import-side-effect, and execution tests until GREEN.

### Task 4: Verify no mutation and regression safety

**Files:**
- Modify only files already listed if verification identifies an R4D-B regression.

**Interfaces:**
- Consumes: the repository test commands and the captured real state/archive metadata.
- Produces: focused test counts, diff/secret hygiene results, and before/after no-mutation evidence.

- [x] Run focused snapshot, ledger, execution, uploader, state, lease, reconciliation, and CLI safety suites.
- [x] Run the full devnet unit suite and authorized local-validator uploader suites without live RPC.
- [x] Run `git diff --check` and focused scans for raw RPC bodies, URL credentials, mnemonic text, and private-key arrays.
- [x] Re-hash real state and R4B/R4C archive files and verify hashes and mtimes match Gate 0.
- [x] Report exact changed files and keep uploader execution disabled; the later read-only observation was separately authorized.

### Task 5: Add the shared RPC scheduler

**Files:**
- Create: `scripts/devnet/rpc-request-scheduler.mjs`
- Create: `tests/devnet/rpc-request-scheduler.test.mjs`
- Modify: `scripts/devnet/upload-execution-command.mjs`
- Modify: `scripts/devnet/upload-buffer-cli.mjs`

**Interfaces:**
- Produces: an invocation-scoped `schedule(metadata, operation, options)`, `waitForCoolOff(ms)`, `abort()`, `close()`, `status()`, and sanitized `policy()` summary.
- Consumes: the existing request ledger, an injected monotonic clock/sleeper, FIFO capacity 256, and minimum request-start gap 500 ms.

- [x] Write deterministic RED tests for concurrency, FIFO start order, 500 ms gaps, bounded queue, abort, close, and zero background work.
- [x] Implement the minimal scheduler and keep import construction side-effect free.
- [x] Wire the same instance through preflight, blockhash, send, confirmation, and reconciliation RPCs.
- [x] Add a 3,000 ms cool-off immediately before the first blockhash request.

### Task 6: Add method-class bounded retries

**Files:**
- Modify: `scripts/devnet/rpc-request-scheduler.mjs`
- Modify: `tests/devnet/rpc-request-scheduler.test.mjs`
- Modify: `scripts/devnet/upload-execution-command.mjs`
- Modify: `tests/devnet/upload-execution-command.test.mjs`
- Modify: `scripts/devnet/throttled-uploader.mjs`
- Modify: `tests/devnet/throttled-uploader.test.mjs`

**Interfaces:**
- Read retry: initial attempt plus retry numbers 1 and 2 after 2,000 ms and 5,000 ms.
- Send policy: one attempt only after signature persistence.
- Confirmation policy: retry reads for the same signature without re-sign/resend/next-chunk progress.

- [x] Write RED tests for exact retry counts/backoffs, third failure, blockhash exhaustion, send non-retry, and confirmation same-signature behavior.
- [x] Implement only safe rate-limit retry; all other classifications remain terminal.
- [x] Verify each ledger attempt has the correct method class, sequence, retry number, and signature flag.

### Task 7: Production-path local-validator integration

**Files:**
- Modify: `tests/local-validator/upload-execution-command.test.mjs`
- Modify: `tests/local-validator/throttled-uploader.test.mjs`
- Create only a focused local-validator helper if shared deterministic fault injection cannot remain readable inline.

**Interfaces:**
- Consumes: production CLI/entrypoint, temporary state/keypairs, local validator, and injected scheduler clock/sleeper/fault transport.
- Produces: normal three-chunk, account-read retry, blockhash exhaustion, send uncertainty, confirmation retry, and interruption/resume evidence.

- [x] Run every scenario with test identities and prove one RPC in flight, pacing, cool-off, persist-before-send, and exact bytes.
- [x] Prove no duplicate transaction and no lingering validator/test process.

### Task 8: Full verification, observation, and publication

**Files:**
- Modify: `.github/workflows/ci.yml` only if current jobs do not execute the new mandatory suites.
- Create: `docs/PHASE_2_R4D_B_CHECKPOINT_2026-07-20.md`

**Interfaces:**
- Produces: Gate 9 verification evidence, optional Gate 10 read-only observation, two requested commits, pushed final SHA, and terminal Ubuntu CI result.

- [x] Run all Gate 9 unit, local-validator, Windows canonical integration, Rust, TypeScript, rustfmt, vector, SBF, identity, YAML, diff, secret, ignored-artifact, and parked-repository checks. Ubuntu Anchor build/test remains the mandatory CI gate.
- [x] Recheck real state/archive hashes and mtimes.
- [x] Run exactly one scheduler-backed read-only devnet observation with no lease/signer/blockhash/simulation/send.
- [x] Review the complete diff and ensure CI runs every mandatory suite without optional/continue-on-error treatment.
- [ ] Commit implementation/tests/CI as `fix(devnet): pace and consolidate public RPC reads`.
- [ ] Commit documentation as `docs(devnet): record R4C rate-limit diagnosis`.
- [ ] Push normally and wait for terminal CI success on the exact final SHA.
