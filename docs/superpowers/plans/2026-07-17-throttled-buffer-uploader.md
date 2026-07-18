# Sequential Throttled Buffer Uploader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement task-by-task with failure-first tests.

**Goal:** Add a locally verified, sequential, resumable upgradeable-loader buffer uploader while keeping its live execution hard-disabled.

**Architecture:** Pure modules encode loader-v3 writes, derive packet-safe chunk plans, and reconcile an ignored state file. A dependency-injected uploader processes one chunk at a time, persists only public recovery facts, and defaults to a read-only plan command. The CLI entry point rejects every live-upload request in this checkpoint.

**Tech stack:** Node.js built-in test runner, `@solana/web3.js` 1.98.4, a Rust fixture generator pinned to Agave-compatible loader-v3 interface 5.0.0, Solana CLI 2.2.20 for local validation only.

## Global constraints

- Never send a devnet write, create/close a buffer, request a faucet, deploy/finalize, or mutate real `.devnet/state.json`.
- Use only `https://api.devnet.solana.com` for the permitted read-only `plan-upload` command; no global Solana configuration.
- Preserve canonical program `6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z`, buffer `CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW`, and authority `Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk`.
- Do not log, track, or copy signer material, raw signed transactions, raw subprocess output, or private RPC credentials.
- Live uploader must be hard-disabled even with explicit-looking arguments; only planning is callable.
- Full planned-chunk equality may skip a chunk; equal byte positions are never an upload offset.

---

### Task 1: Loader-v3 instruction codec and vectors

**Files:**
- Create: `scripts/devnet/loader-v3-codec.mjs`
- Create: `tests/devnet/loader-v3-codec.test.mjs`
- Create: `tests/fixtures/loader-v3-write-vectors.json`
- Create: `tools/loader-v3-vectors/Cargo.toml`, `tools/loader-v3-vectors/src/main.rs`

1. Write tests that require canonical loader ID, exact account metas, bincode instruction bytes for offsets 0/one-chunk/large-offset, and malformed/oversize rejection.
2. Run the targeted test and observe a missing-module failure.
3. Generate fixtures with `solana-loader-v3-interface = "=5.0.0"`; implement the JS codec against those exact bytes.
4. Re-run codec tests; record fixture provenance in the JSON metadata.

### Task 2: Packet-safe planner and read-only report

**Files:**
- Create: `scripts/devnet/upload-plan.mjs`
- Create: `tests/devnet/upload-plan.test.mjs`
- Create: `scripts/devnet/plan-upload-command.mjs`
- Create: `scripts/devnet/plan-upload-cli.mjs`
- Create: `tests/devnet/plan-upload-command.test.mjs`
- Create: `tests/devnet/plan-upload-cli-safety.test.mjs`

1. Add failing tests for deterministic, non-overlapping chunk plans, packet ceiling safety, final partial chunk, complete-chunk comparison, and fee/headroom projection.
2. Run the targeted test and observe a missing export failure.
3. Derive payload size using an actual serialized `Transaction`; construct records with index, offset, length, SHA-256, and exact-match.
4. Add `plan-upload`, which only reads validated config/binary/buffer through injected readers and returns a report without saving state.
5. Make `upload-buffer-throttled` reject unconditionally with the checkpoint hard-disable message.

### Task 3: State schema v3 and sequential reconciliation core

**Files:**
- Modify: `scripts/devnet/state.mjs`
- Create: `scripts/devnet/throttled-uploader.mjs`
- Modify: `tests/devnet/state.test.mjs`
- Create: `tests/devnet/throttled-uploader.test.mjs`

1. Add failing tests for atomic v2-to-v3 migration, collision-safe backup, preserved historical windows, and secret rejection.
2. Add failing tests for rate-policy validation, one unresolved transaction, persist-before-send, confirmed failure, recovered content match, unknown stop, 429 stop, and no import side effect.
3. Implement schema v3 and a dependency-injected uploader. The uploader must not be wired to a live command in this checkpoint.
4. Re-run targeted state/uploader tests.

### Task 4: Local integration, documentation, and publication

**Files:**
- Create: `tests/local-validator/throttled-uploader.test.mjs`
- Modify: `README.md`
- Modify: `docs/PHASE_2_DEVNET_BLOCKED_2026-07-16.md`

1. Write a local-only interruption/resume test using synthetic local keys and a real local-validator upgradeable-loader buffer; prove sequential ordering and exact final bytes.
2. Run it RED, implement only the local adapter necessary for GREEN, and document any loader-version limitation.
3. Run `plan-upload` read-only against the preserved buffer, without changing real state; capture only sanitized totals/fees/headroom in documentation.
4. Run full Rust, Node, TypeScript, SBF, local-validator, identity, formatting, diff, secret, ignored-artifact, and parked-repository checks.
5. Commit the coherent feature as `feat: add sequential resumable buffer uploader`, push normally, and wait for Ubuntu CI success.
