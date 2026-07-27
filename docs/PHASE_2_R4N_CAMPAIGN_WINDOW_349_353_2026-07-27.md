# Phase 2 R4N Campaign — Window (chunks 349–353)

Window 1 of a bounded ≤3-window session (operator-approved expectation of 2
windows). Terminal-complete, reconciled, released, quiescent. No claim of full
upload, program finalization, deployment, or business flow.

## Pre-window baseline (independently verified, all directly measured)

- HEAD = origin/main = remote = `7c4397cb6e13a80727de7d96f39fba0dda219316`; `0/0`; clean; no git op locks.
- state SHA `89c655d4e39e77a73bfc53c5bdfd413abbe30272593bfd7ecc32670dfed50c3a`;
  counts `349 CONFIRMED / 42 PLANNED / 0 SENT / 0 UNKNOWN`; contiguous CONFIRMED prefix 349.
- binary SHA `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`, length `395144`.
- on-chain buffer SHA `c64f14ee1ac05d794805409fb3b2c45d69def35d708cfab6a60601cd3e51e320`,
  owner `BPFLoaderUpgradeab1e…`, allocation `395181`, status `BUFFER_WRITING`.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- fresh candidates `349,350,351,352,353`, all PLANNED, contiguous, null signatures.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed vs current state)
  `da0fe9134b0bc309a9a1810292daef1910e22f2356ac954392f3b4eea27de28d`; max tx `1231` bytes (≤ 1232).
- authority balance `3246733680` lamports; headroom `243755920`; funding `SUFFICIENT`.
- Exact-SHA CI run `30258517594` (headSha `7c4397c…`) = `success` (verified via GitHub API).
- Cooldown from prior session ~29 min (≥ 900 s). Baseline devnet unit suite 379/379.

## The one supervised uploader invocation

- outer execution ID `da802c6f-ca05-496f-9d1a-26226b7cbe88`;
  inner (lease) execution ID `26f7d8c6-ff57-40f2-873d-9d89c2f54ab6`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, childExitCode 0,
  runtimeElapsedMs 91690.
- selected 5 / attempted 5 / sent 5 / confirmed 5; every err = null.

### Full signatures (all confirmed)

| index | signature |
|------:|-----------|
| 349 | `3j5jRj5FAhuiozGgWKTHdnmJXNLVWd1L41bKRrk5gcxziQEr2bE5HD88gp8GVAYccqRNek3uEmuhokGq3qnQjcXk` |
| 350 | `62VN9cSDnz5HrGEwYKxQt3Pdqt173iVFz7cBwDDhQttpEYjW9ZUwwRQnXwjEnFb6iEraTBPeDJBjWHTqGtUWNLEq` |
| 351 | `3Xd4WNv9WZ7gFdeQD7JEBnDeyiovvDUqF81HvWtRNYAsp8AbSpyJPbL3pN6mpZyjxeGuX4aaqK77dzPWhvp5utJ8` |
| 352 | `3zZLxuqLJUu9qN9ZQasTxu8tousHAk5N5WZ9Mct5AAtcE3ZqRvsaJjymc3XAkb46qJihCen28X33j8M75e4mptp3` |
| 353 | `4GxMDUQvzVpTCHQQM1LE4FtHBkt9AWX11tm4DahUAeutFkCukgrv2gKaSoJrK22KMBs7oxRHeTusweDo78gmAodS` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- request start gap 500 ms; confirmation poll 2000 ms; inter-chunk 3000 ms;
  request timeout 15000 ms; retries 0; rate-limit 0; send/confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`26f7d8c6…`) → releaseReady, 0 proposed transitions,
  `onchainWrite: false`, `stateMutation: false`, evidenceHash
  `a6709e579355ce10ff924a9664851906d22a09d96432b27cfdcfed98d8463889`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false, `onchainWrite: false`.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.
- durable evidence root: `.devnet/upload-window-host-results/da802c6f-ca05-496f-9d1a-26226b7cbe88/`.

## Resulting state and buffer

- state counts `354 CONFIRMED / 37 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `5b3a4dbd38752088a1c0c093404a048f9ea01505a431c15218d2610eac18905d`.
- on-chain buffer SHA `45f68d02f4ab9fac5710f24831c83ca6b4a0846db5c08904787e7200c9235b2d`
  (changed from `c64f14ee…`); status `BUFFER_WRITING`.
- authority balance after `3246708680` lamports (Δ 25 000 = 5 × 5 000 base fee); funding `SUFFICIENT`.

## Validation

Code unchanged from CI-green baseline `7c4397c…` (only gitignored `.devnet` mutated;
tracked tree clean). Post-window devnet unit suite 379/379. No recurrence of the
historical `378/1` anomaly (root cause remains UNPROVEN; disposition unchanged).

## Remaining campaign

37 chunks remain `PLANNED` (354 confirmed of 391). Deploy/finalize stays a
separately authorized phase after all 391 chunks are independently proven CONFIRMED.
