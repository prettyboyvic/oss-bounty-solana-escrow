# R4J Five-Chunk Paced Upload Execution Record

**Goal:** Execute exactly one bounded devnet buffer upload for chunks 249-253,
reconcile and release only on fresh safe evidence, verify, and publish sanitized
documentation.

## Constraints

- Exactly one uploader invocation; maximum five chunks; chunk 254 excluded.
- Concurrency one; 3,000 ms pre-sign/inter-chunk delay; 500 ms RPC gap;
  2,000 ms confirmation floor; no send retry or policy/source changes.
- No finalize, deploy, close, faucet, mint, DEVTEST, or escrow flow.
- Apply only exact transitions and release only zero-transition
  `releaseReady: true` evidence.

## Baseline and preflight

- [x] Verified `main` at
  `e558dcfd226bd2be73feef5b34d40e4ec9ebaf4e`, exact remote equality,
  ahead/behind `0/0`, clean worktree, and exact-SHA CI success.
- [x] Verified HEAD README/R4I records, ignored-untracked `.devnet`, no lease,
  lock, uploader, or validator, and cooldown above 900 seconds.
- [x] Production read-only preflight used no signer/blockhash/send/mutation and
  proved state 249/142/0/0, complete prefix 0-248, identities/binary/plan,
  sufficient funding, intact history, candidates 249-253, and excluded 254.

## Sole live window

- [x] Invoked `upload-buffer-throttled` exactly once with `maxChunks=5`,
  `delayMs=3000`, and `R4_BUFFER_UPLOAD` acknowledgement.
- [x] Execution `5a28f970-9f19-4724-9c47-9da148666f6d` finalized exactly chunks
  249-253 at `WINDOW_LIMIT` with 56/56 RPC successes, five sends, 35 status
  reads, zero rate limits/errors, and persisted confirmation durations.
- [x] No second invocation occurred.

## Reconciliation and assertions

- [x] Fresh reconciliation returned `SAFE_TO_RELEASE`, `releaseReady: true`,
  and zero transitions; apply was skipped.
- [x] Local release archived exact evidence
  `bceee91246d370fe3d71d7fa8d6cc091a1cbe2f15e15855ae31cb8ac4dd2e348`.
- [x] Proved canonical transactions/bytes, state 254/137/0/0, chunk 254
  planned/null, absent program, archive count nine, no lease, and exact
  25,000-lamport fee delta.

## Verification and publication

- [x] Focused safety 114/114; devnet tooling 244/244; local-validator 1/1 plus
  1/1; integration 26/26; Rust 11/11; all remaining hygiene gates passed.
- [x] Created sanitized R4J checkpoint and README update.
- [x] Review full diff, links, Markdown, tracked scope, secrets, and diff check.
- [x] Stage only README, R4J checkpoint, and this record.

Commit/push/exact-SHA CI and final repository state are external outcomes;
Git history, GitHub Actions, and the final operator report are authoritative.
