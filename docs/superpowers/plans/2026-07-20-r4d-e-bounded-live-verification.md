# R4D-E Bounded Live Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the corrected 500 ms RPC scheduler and 2,000 ms confirmation polling floor in exactly one three-chunk devnet upload window, then reconcile, archive, regress, and publish sanitized evidence.

**Architecture:** Use only the published production scheduler, upload entrypoint, and public reconciliation/apply/release commands. Local read-only gates bind the exact Git/state/archive baseline; one scheduler-backed preflight proves cluster, account, plan, funding, and candidate invariants before the only authorized signer/blockhash/send path can begin. Reconciliation is mandatory and is the sole authority for any local apply or lease release.

**Tech Stack:** Node.js ESM, Solana Web3.js 1.98.4, production devnet CLI modules, Git/GitHub Actions, PowerShell, Rust/Anchor local verification.

## Global Constraints

- Exact RPC: `https://api.devnet.solana.com`; exact devnet genesis required.
- Exactly one `upload-buffer-throttled` invocation and at most chunks 226–228.
- Global actual RPC start gap 500 ms; normal confirmation floor 2,000 ms; read backoffs 2,000/5,000 ms.
- Pre-sign cool-off and inter-chunk delay are each at least 3,000 ms; concurrency is one.
- Send is single-attempt and never automatically retried; unresolved evidence stops the window.
- No second window, finalize, deploy, close, regenerate, faucet, mint, DEVTEST, or escrow flow.
- Only conclusive finalized canonical instruction plus exact full bytes may be applied.
- Only fresh `releaseReady: true` evidence may archive the lease.
- Publication is one docs-only commit with message `docs(devnet): record corrected pacing live window`.

---

### Task 1: Baseline, cooldown, and read-only preflight

**Files:**
- Read: `.devnet/state.json`
- Read: `.devnet/history/upload-leases/**`
- Read: `target/sbf-solana-solana/release/oss_bounty_escrow.so`
- Read: `scripts/devnet/upload-execution-command.mjs`
- Read: `scripts/devnet/rpc-request-scheduler.mjs`

**Interfaces:**
- Consumes: exact final R4D-D SHA `cf9e57150ef26f227e95372b0157636d7c669e0a` and CI run 29714231442.
- Produces: immutable local baseline manifest and one fresh `preflightUploadExecution` result with safe ledger evidence.

- [x] **Step 1: Verify Git, CI, state, archive, process, ignored-file, parked-repository, and 900-second cooldown gates**
- [x] **Step 2: Run one scheduler-backed `preflightUploadExecution` plus one scheduler-backed buffer signature-history read**
- [x] **Step 3: Require exact genesis, absent program, canonical buffer metadata, one finalized snapshot for all 226 confirmed chunks, fresh state/binary/plan hashes, and only read ledger methods**
- [x] **Step 4: Recompute fresh funding with 250,000,000 lamport reserve and stop on insufficient funding, exhausted read retry, or any observed gap below 500 ms**

### Task 2: Candidate and immediate pre-write gates

**Files:**
- Read: `.devnet/state.json`
- Read: ignored authority keypair (path omitted from published evidence)
- Read: `target/sbf-solana-solana/release/oss_bounty_escrow.so`

**Interfaces:**
- Consumes: the immutable preflight plan and finalized buffer snapshot from Task 1.
- Produces: exact candidate evidence for indices 226, 227, and 228, plus a fresh pre-write state/identity/funding/signer/policy gate.

- [x] **Step 1: Prove the first three nonmatching PLANNED chunks are 226–228 at offsets 228486, 229497, and 230508**
- [x] **Step 2: Prove each full range mismatches and bind length/hash; explicitly exclude chunk 229**
- [x] **Step 3: Recheck state hash, program/buffer identity, balance/funding, binary/plan fingerprint, lease/process absence, and ignored authority public key `Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk`**
- [x] **Step 4: Require `maxChunks=3`, `delayMs=3000`, policy 500/2000/[2000,5000], concurrency one, 3,000 ms cool-off, and acknowledgement `R4_BUFFER_UPLOAD`**

### Task 3: Execute exactly one bounded window

**Files:**
- Mutate only through production command: `.devnet/state.json`
- Create active lease/archive only through production lease lifecycle: `.devnet/state.json.upload-lease`, `.devnet/history/upload-leases/**`

**Interfaces:**
- Consumes: the approved public command contract and the Gate 3 fresh invariants.
- Produces: one execution ID, at most three persisted public signatures, scheduler ledger aggregate, and terminal or preserved-uncertain state.

- [x] **Step 1: Invoke exactly once**

```text
node scripts/devnet/upload-buffer-cli.mjs upload-buffer-throttled --url https://api.devnet.solana.com --program 6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z --buffer CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW --state .devnet/state.json --authority <ignored-keypair> --max-chunks 3 --delay-ms 3000 --acknowledge-devnet-write R4_BUFFER_UPLOAD
```

- [x] **Step 2: Do not invoke again regardless of interruption; recover the execution ID from the active lease if necessary**
- [x] **Step 3: Require at most three send calls, retry number zero for every send, same-signature status polling, no next chunk while unresolved, finalized success, and fresh exact bytes**

### Task 4: Mandatory reconciliation and acceptance evidence

**Files:**
- Mutate local state only if conclusive apply evidence exists: `.devnet/state.json`
- Archive active lease only after fresh release evidence: `.devnet/history/upload-leases/**`

**Interfaces:**
- Consumes: execution ID from Task 3 and fresh finalized transaction/account evidence.
- Produces: archived/released lease or intentionally preserved unresolved lease and the exact R4D-E verdict.

- [x] **Step 1: Run `reconcile-upload-lease` for the execution ID with the optimized binary**
- [x] **Step 2: If and only if proposed transitions are conclusive, run one acknowledged `apply-upload-reconciliation`, then reconcile again** (no apply was needed: zero proposed transitions)
- [x] **Step 3: If and only if fresh reconciliation returns `releaseReady: true`, run acknowledged `release-upload-lease`**
- [x] **Step 4: Capture signatures, slots, fees, exact instruction/byte proof, Explorer links, request timing/retry metrics, state/history/balance/hash deltas, and archive status**

### Task 5: Regression and publication

**Files:**
- Create: `docs/PHASE_2_R4D_E_CHECKPOINT_2026-07-20.md`
- Modify: `docs/superpowers/plans/2026-07-20-r4d-e-bounded-live-verification.md`

**Interfaces:**
- Consumes: terminal reconciliation evidence and all local/CI verification results.
- Produces: one sanitized docs-only commit and terminal exact-SHA CI evidence.

- [x] **Step 1: Run focused scheduler/ledger/polling/uploader/reconciliation tests and full devnet tooling**
- [x] **Step 2: Run both local-validator suites, 26 Anchor cases, Rust, TypeScript, rustfmt, vectors, optimized SBF/hash, IDL identity, YAML, and diff checks**
- [x] **Step 3: Verify secret/raw-RPC/key-array hygiene, ignored artifacts, parked repositories, and absence of forbidden flows**
- [x] **Step 4: Create the sanitized checkpoint, self-review, and commit only documentation**
- [ ] **Step 5: Push normally and wait for exact-final-SHA Ubuntu CI SUCCESS**
