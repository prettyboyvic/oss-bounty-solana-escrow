# Phase 2 R4N Campaign — Window (chunks 364–368)

Window 2 of a bounded ≤3-window session (operator-preferred plan of 3 windows).
Terminal-complete, reconciled, released, quiescent. No claim of full upload,
program finalization, deployment, or business flow.

## Between-window boundary satisfied (window 1 → window 2)

- window 1 (359–363) fully closed; all CONFIRMED; reconcile releaseReady, 0
  transitions; lease released; post-window suite 379/379; checkpoint
  `d9897d9f49e7d612084916464d6ff2d41c1d3cbc`; exact-SHA CI `30265134179` success;
  cooldown 924 s (≥ 900); fresh preflight passed; quiescence proven.

## Pre-window baseline (fresh, directly measured)

- HEAD = origin/main = remote = `d9897d9f49e7d612084916464d6ff2d41c1d3cbc`; `0/0`; clean.
- state SHA `ff6156a482fff7e6d6f001d0d9e3cbb20a935a4d188cbefe5581db7b9b51eb03`;
  counts `364 CONFIRMED / 27 PLANNED / 0 SENT / 0 UNKNOWN`; contiguous CONFIRMED prefix 364.
- binary SHA `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`, length `395144`.
- on-chain buffer SHA `cd0d0cb908cd491ee3c55d9a8fc4f5e9a1c7e1e0c415dcba2170277a1075fca4`,
  owner `BPFLoaderUpgradeab1e…`, allocation `395181`, status `BUFFER_WRITING`.
- fresh candidates `364,365,366,367,368`, all PLANNED, contiguous, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed)
  `d8833b918da5ef9deea84d2ea62ed5f717cdc09dfe3d68828a4181e5de625e11`; max tx `1231` bytes (≤ 1232).
- authority balance `3246658680` lamports; funding `SUFFICIENT`.

## The one supervised uploader invocation

- outer execution ID `4ced9cb2-a9c5-47ab-b20a-c79ff4043c09`;
  inner (lease) execution ID `5b194ae3-a20e-4a75-8496-4f2529043803`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, childExitCode 0,
  runtimeElapsedMs 91510.
- selected 5 / attempted 5 / sent 5 / confirmed 5; every err = null.

### Full signatures (all confirmed)

| index | signature |
|------:|-----------|
| 364 | `27WbEJ3WHxKPDgKWWQs9qiMHf57oc47zsiMchpFgJhzpZH6jwFc9n8KGtt3FrUyxPYX1jEevu82SCjzqwPfNguJs` |
| 365 | `5DWRuY6yHK7GZWdmSuJAyWXbPvMdxmS2SwKx7BvC5EkJ3ajckYQrTbzBjoCAdQCvRRUxHzb8kHFBr1GcLUBwHRdT` |
| 366 | `3dAF7HQmt6Mk1GkdxAuqhqqAk1aarrZpaa8LPrdz4BQBn5atZCTdNVYXmE29zdWrZ2MnKWoc3jJFrF6T1fhPJBYQ` |
| 367 | `TBhTBG4Dqe5GA3fCkgiGophwuSoR3z1uqmLfrZ1BcGZMATNTZq9makCKu7XJfVESbxeYjo6oJNh8LdKQKzbV8gT` |
| 368 | `4YuGzGeZ5Qd9bTo5p3S86kENxoCgcQ1wyRnpWnZugvJiivBs8MCsZjGvzsUey8CxTjxHmXLjTPm5m5MQ7yCekF69` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- request start gap 500 ms; confirmation poll 2000 ms; inter-chunk 3000 ms;
  request timeout 15000 ms; retries 0; rate-limit 0; send/confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`5b194ae3…`) → releaseReady, 0 proposed transitions,
  `onchainWrite: false`, evidenceHash
  `04382c508280ef1234c02e4b96a1cc34a4b4d52620fa68c5d63d185bef73160f`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.
- durable evidence root: `.devnet/upload-window-host-results/4ced9cb2-a9c5-47ab-b20a-c79ff4043c09/`.

## Resulting state and buffer

- state counts `369 CONFIRMED / 22 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `e290c2605d72b9445480cd69a4498c949a3806c7b7237e6e686377612874ca97`.
- on-chain buffer SHA `a01f7be3dfb71c9fd4e35e62a01db6ec4da48ad76fa4fdf736ff778dd6da16a1`
  (changed from `cd0d0cb9…`); status `BUFFER_WRITING`.
- authority balance after `3246633680` lamports (Δ 25 000 = 5 × 5 000 base fee); funding `SUFFICIENT`.

## Validation

Code unchanged from CI-green baseline `d9897d9…` (only gitignored `.devnet` mutated;
tracked tree clean). Post-window devnet unit suite 379/379. No recurrence of the
historical `378/1` anomaly (root cause remains UNPROVEN; disposition unchanged).

## Remaining campaign

22 chunks remain `PLANNED` (369 confirmed of 391). Deploy/finalize stays a
separately authorized phase after all 391 chunks are independently proven CONFIRMED.
