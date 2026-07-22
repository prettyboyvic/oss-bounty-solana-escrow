# R4G Five-Chunk Paced Upload Execution Record

**Goal:** Execute exactly one conditionally authorized five-chunk devnet buffer
upload window, reconcile every attempted write, release the lease only on fresh
safe evidence, regress locally, and publish sanitized evidence.

## Global constraints

- Exactly one uploader invocation and at most chunks 234-238.
- Chunk 239 excluded.
- Maximum five chunks; no source or timing-policy changes.
- 3,000 ms pre-sign cool-off and inter-chunk delay.
- 500 ms global RPC start gap, 2,000 ms confirmation floor, 2,000/5,000 ms
  read backoffs, and concurrency one.
- No send retry, re-sign, resend, or replacement.
- No finalize, deploy, close, identity regeneration, faucet, mint, DEVTEST, or
  escrow flow.
- Apply only conclusive transitions; release only fresh zero-transition
  `releaseReady: true` evidence.
- Publication limited to sanitized documentation.

## Task 1: Baseline and preflight

- [x] Verified branch `main`, exact starting SHA
  `d62cd6b00f208fe74f1a11f06701aef82ac31244`, local/remote equality,
  ahead/behind `0/0`, clean worktree, and exact-SHA CI success.
- [x] Verified current R4F README/checkpoint/plan and ignored-untracked
  `.devnet/` state.
- [x] Proved no active lease, operation lock, or uploader process and more than
  900 seconds of cooldown.
- [x] Ran scheduler-backed read-only preflight with no signer, blockhash, send,
  or state mutation.
- [x] Proved exact devnet genesis, absent program, canonical buffer/binary/plan,
  state 234/157/0/0, and complete finalized confirmed prefix 0-233.
- [x] Refreshed balance/rents and proved 243,180,920 lamports of headroom after
  the 250,000,000-lamport reserve.
- [x] Proved exact mismatch/hash/offset/length/null-signature evidence for
  chunks 234-238 and explicitly excluded chunk 239.

## Task 2: Sole live window

- [x] Invoked the production `upload-buffer-throttled` command exactly once
  with `maxChunks=5`, `delayMs=3000`, and acknowledgement
  `R4_BUFFER_UPLOAD`.
- [x] Execution ID `638066b5-5ede-4726-b9cf-bd0a285d4a6c` ended at
  `WINDOW_LIMIT` after processing, sending, and finalizing chunks 234-238.
- [x] Observed 56/56 successful aggregate RPC attempts, five sends, 35 status
  reads, zero rate limits, and zero RPC errors.
- [x] Did not invoke a second window under any outcome.

## Task 3: Reconciliation and release

- [x] Fresh read-only reconciliation returned `SAFE_TO_RELEASE`,
  `releaseReady: true`, and zero proposed transitions.
- [x] Did not invoke apply because no transition was proposed.
- [x] Fresh acknowledged local-only release returned `ARCHIVED/RELEASED` with
  evidence hash
  `6945b45889b8f980c9fe5f7734ab15e246eb9a796fb590ba5c9d0304347e338e`.
- [x] Proved every finalized transaction contains exactly one canonical
  Loader-v3 Write and that finalized buffer bytes match each payload.
- [x] Proved state 239/152/0/0, chunk 239 still planned/null, absent program,
  no active lease, archive count six, and exact 25,000-lamport fee delta.

## Task 4: Regression and publication preparation

- [x] Focused safety/reconciliation/snapshot tests: 103/103.
- [x] Full devnet tooling: 237/237.
- [x] Both local-validator suites: 1/1 each.
- [x] Rust workspace: 11/11; TypeScript and rustfmt checks passed.
- [x] Loader-v3 raw-byte parity, optimized SBF/hash, and 26 Anchor-compatible
  integration cases passed.
- [x] Created the sanitized R4G checkpoint and updated the README current
  status without tracking `.devnet` material.

## Task 5: Publication handoff

- [x] Reviewed the full diff, link targets, Markdown/static checks,
  tracked-file scope, secret scan, and `git diff --check`.
- [x] Limited the publication to the README, sanitized R4G checkpoint, and
  this execution record.

The publication commit, push, exact-SHA CI result, and final repository state
are external outcomes of this pre-commit record. Git history, GitHub Actions,
and the final operator report are authoritative for those self-referential
facts.
