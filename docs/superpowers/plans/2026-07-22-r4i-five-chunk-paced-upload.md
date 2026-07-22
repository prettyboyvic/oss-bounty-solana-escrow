# R4I Five-Chunk Paced Upload Execution Record

**Goal:** Execute exactly one conditionally authorized five-chunk devnet buffer
upload window for chunks 244-248, preserve telemetry, reconcile, release only
on fresh safe evidence, verify locally, and publish sanitized evidence.

## Global constraints

- Exactly one uploader invocation; chunk 249 excluded.
- Maximum five chunks, concurrency one, no source or policy changes.
- 3,000 ms pre-sign cool-off and inter-chunk delay.
- 500 ms RPC start gap and 2,000 ms confirmation-poll floor.
- No send retry, re-sign, resend, replacement, finalize, deploy, close, faucet,
  mint, DEVTEST, or escrow flow.
- Apply only conclusive transitions; release only fresh zero-transition
  `releaseReady: true` evidence.
- Publication limited to sanitized documentation.

## Task 1: Baseline and preflight

- [x] Verified `main` at
  `2c4c37b2bd4ae20d5a99edc988fa9d3f316d2bcc`, local/remote equality,
  ahead/behind `0/0`, clean worktree, and exact-SHA CI success.
- [x] Verified current R4H README/checkpoint/record and ignored-untracked
  `.devnet/` state.
- [x] Proved no active lease, lock, uploader, or validator and cooldown above
  900 seconds.
- [x] Ran production read-only preflight with no signer, blockhash, send, or
  state mutation.
- [x] Proved devnet identity, absent program, canonical buffer/binary/plan,
  state 244/147/0/0, and complete confirmed prefix 0-243.
- [x] Proved 243,230,920 lamports of headroom after the established reserve.
- [x] Proved exact candidates 244-248, excluded chunk 249, unchanged policy,
  intact R4H telemetry, and production confirmation-duration wiring.

## Task 2: Sole live window

- [x] Invoked production `upload-buffer-throttled` exactly once with
  `maxChunks=5`, `delayMs=3000`, and `R4_BUFFER_UPLOAD` acknowledgement.
- [x] Execution `3f303c05-a4d0-4b35-988a-be097c4829ec` ended at
  `WINDOW_LIMIT` after processing, sending, and finalizing chunks 244-248.
- [x] Observed 56/56 successful RPC attempts, five sends, 35 status reads,
  zero rate limits, and zero RPC errors.
- [x] Persisted non-negative integer `confirmationDurationMs` for every new
  finalized chunk and did not invoke a second window.

## Task 3: Reconciliation and release

- [x] Fresh reconciliation returned `SAFE_TO_RELEASE`, `releaseReady: true`,
  and zero transitions; apply was not invoked.
- [x] Fresh local-only release returned `ARCHIVED/RELEASED` with evidence hash
  `193b2e1c22cb267100a2725f5c031601d6ff8581ee2b5a73c5bf758b488c94b6`.
- [x] Proved all five canonical finalized Loader-v3 Writes and exact buffer
  bytes.
- [x] Proved state 249/142/0/0, chunk 249 planned/null, absent program, no
  active lease, archive count eight, and exact 25,000-lamport fee delta.

## Task 4: Verification and publication preparation

- [x] Focused safety tests: 114/114; full devnet tooling: 244/244.
- [x] Both local-validator suites: 1/1 each; integration: 26/26.
- [x] Rust: 11/11; TypeScript, formatting, vector parity, artifact hash, and
  YAML checks passed.
- [x] Created the sanitized R4I checkpoint and updated README without tracking
  `.devnet` material.

## Task 5: Publication handoff

- [x] Review complete diff, links, Markdown, tracked scope, secrets, and
  `git diff --check`.
- [x] Stage only README, R4I checkpoint, and this execution record.

The publication commit, push, exact-SHA CI result, and final repository state
are external outcomes. Git history, GitHub Actions, and the final operator
report are authoritative for those self-referential facts.
