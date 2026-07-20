# R4F Five-Chunk Paced Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute exactly one five-chunk devnet buffer upload window through the published scheduler, reconcile every attempted signature, archive only on fresh safe evidence, regress locally, and publish sanitized evidence.

**Architecture:** The existing production CLI, request scheduler, confirmation poller, immutable validation snapshot, state-v3 checkpoint, and lease reconciliation commands are the only execution authorities. Read-only gates bind the Git/state/archive baseline and fresh devnet account/funding facts before the sole signer/blockhash/send path. No source or policy changes are permitted during this phase.

**Tech Stack:** Node.js ESM, Solana Web3.js 1.98.4, production devnet CLI modules, PowerShell, Git/GitHub Actions, Rust/Anchor local verification.

## Global Constraints

- Exact RPC is `https://api.devnet.solana.com` with exact devnet genesis attestation.
- Exactly one `upload-buffer-throttled` invocation may attempt at most chunks 229-233.
- Actual RPC request-start gap is at least 500 ms; normal status polling floor is at least 2,000 ms.
- Pre-sign cool-off and inter-chunk delay are each at least 3,000 ms; scheduler concurrency is one.
- Send is single-attempt and never automatically retried, re-signed, resent, or replaced.
- Stop on terminal uncertainty, failure, mismatch, or any pre-write invariant drift.
- Reconciliation is mandatory; apply only exact proposed transitions; release only fresh `releaseReady: true` evidence.
- No second window, finalize, deploy, close, regenerate, faucet, mint, DEVTEST, or escrow flow.
- Publication is one docs-only commit with message `docs(devnet): record five-chunk paced upload window`.

---

### Task 1: Baseline, cooldown, and fresh read-only preflight

**Files:**
- Read: `.devnet/state.json`
- Read: `.devnet/history/upload-leases/**`
- Read: `target/sbf-solana-solana/release/oss_bounty_escrow.so`
- Read: `scripts/devnet/upload-execution-command.mjs`
- Read: `scripts/devnet/rpc-request-scheduler.mjs`

**Interfaces:**
- Consumes: exact R4D-E commit `92796087fc11726d72c6195f5afa82744d687f21` and CI run `29715623373`.
- Produces: immutable Gate 0 manifest and one scheduler-backed preflight result for all 229 confirmed chunks.

- [x] **Step 1: Verify exact Git/CI/state/archive/process/ignored/parked-repository baseline and at least 900 seconds of cooldown**
- [x] **Step 2: Run exactly one production `preflightUploadExecution` and one scheduler-backed finalized buffer history read**
- [x] **Step 3: Require exact genesis, absent program, canonical buffer metadata/hash, binary/plan/state hashes, no lease, and one finalized snapshot validating all 229 confirmed chunks**
- [x] **Step 4: Refresh balance, both rent values, history, conservative funding with 250,000,000 lamport reserve, and safe ledger timing**

### Task 2: Candidate and immediate pre-write gates

**Files:**
- Read: `.devnet/state.json`
- Read: ignored authority keypair (path omitted from published evidence)
- Read: `target/sbf-solana-solana/release/oss_bounty_escrow.so`

**Interfaces:**
- Consumes: the immutable plan and finalized buffer snapshot from Task 1.
- Produces: exact candidate evidence for chunks 229-233 and a fresh pre-write authorization boundary.

- [x] **Step 1: Prove chunks 229-233 are the first five full nonmatching `PLANNED` chunks at offsets 231519, 232530, 233541, 234552, and 235563**
- [x] **Step 2: Bind every candidate length/hash and exact mismatch; explicitly prove chunk 234 is excluded**
- [x] **Step 3: Recheck state hash, absent program, buffer identity/hash, funding, binary/plan fingerprint, no lease/process, and the canonical public key derived from the ignored authority file**
- [x] **Step 4: Require max chunks 5, 500/2,000/[2,000,5,000] scheduler policy, 3,000 ms cool-off/delay, concurrency one, and acknowledgement `R4_BUFFER_UPLOAD`**

### Task 3: Execute the sole bounded window

**Files:**
- Mutate through production command only: `.devnet/state.json`
- Create/archive through production lease lifecycle only: `.devnet/state.json.upload-lease`, `.devnet/history/upload-leases/**`

**Interfaces:**
- Consumes: the approved public upload contract plus the fresh Gate 3 invariants.
- Produces: one execution ID, no more than five public signatures, a bounded scheduler ledger, and terminal or preserved-uncertain state.

- [x] **Step 1: Invoke the public uploader exactly once**

```text
node scripts/devnet/upload-buffer-cli.mjs upload-buffer-throttled --url https://api.devnet.solana.com --program 6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z --buffer CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW --state .devnet/state.json --authority <ignored-keypair> --max-chunks 5 --delay-ms 3000 --acknowledge-devnet-write R4_BUFFER_UPLOAD
```

- [x] **Step 2: Never invoke again; recover the execution ID from the active lease if output is interrupted**
- [x] **Step 3: Require fresh blockhash, `PLANNED`/null-signature recheck, persist-before-send, one send, same-signature polling, finalized success, and fresh exact bytes for each attempted chunk**
- [x] **Step 4: Stop without advancing on any uncertainty/failure/mismatch and preserve the lease for reconciliation**

### Task 4: Mandatory reconciliation and acceptance evidence

**Files:**
- Mutate state only through conclusive public apply: `.devnet/state.json`
- Archive only through fresh public release: `.devnet/history/upload-leases/**`

**Interfaces:**
- Consumes: the Task 3 execution ID and fresh finalized transaction/account evidence.
- Produces: archived/released lease or preserved unresolved lease, exact transaction proof, and the R4F verdict.

- [x] **Step 1: Run public `reconcile-upload-lease` for the exact execution ID and optimized binary**
- [x] **Step 2: Apply exactly once only if fresh safe evidence proposes conclusive transitions, then reconcile again** (no apply was needed: zero proposed transitions)
- [x] **Step 3: Release/archive only after fresh `releaseReady: true` evidence; otherwise preserve the active lease**
- [x] **Step 4: Capture signatures, slots, fees, Explorer links, exact instruction/payload/buffer proof, timing/retry metrics, and state/history/balance/hash deltas**
- [x] **Step 5: Compare selected/attempted/finalized, minimum gap, status requests/rate limits, confirmation durations, fees, and send retries with R4D-E**

### Task 5: Regression and publication

**Files:**
- Create: `docs/PHASE_2_R4F_CHECKPOINT_2026-07-20.md`
- Modify: `docs/superpowers/plans/2026-07-20-r4f-five-chunk-paced-upload.md`

**Interfaces:**
- Consumes: safely reconciled Task 4 evidence and the established local verification battery.
- Produces: sanitized docs-only publication and terminal exact-SHA CI evidence.

- [x] **Step 1: Run focused scheduler/ledger/polling/uploader/reconciliation, full devnet tooling, and state-v3 suites**
- [x] **Step 2: Run both local-validator suites, 26 Anchor cases, Rust, TypeScript, both rustfmt checks, vector parity, optimized SBF/hash, IDL identity, YAML, and diff checks**
- [x] **Step 3: Verify secret/raw-RPC/key-array/path hygiene, ignored artifacts, archive immutability, parked repositories, no active process/lease, and no forbidden flow**
- [x] **Step 4: Create and self-review the sanitized checkpoint, then stage only the two Markdown documents**
- [ ] **Step 5: Commit with the exact message, push normally, and wait for terminal SUCCESS from CI on the exact commit SHA**
