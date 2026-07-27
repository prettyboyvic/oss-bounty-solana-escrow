# Phase 2 R4N Campaign — Window (chunks 374–378)

Window 1 of a bounded ≤3-window session (operator-preferred plan of 3 full
windows). Terminal-complete, reconciled, released, quiescent. No claim of full
upload, program finalization, deployment, or business flow.

## Pre-window baseline (independently verified, directly measured)

- HEAD = origin/main = remote = `f948c7d07336f84ea725e47aa95d61d2674c26b9`; `0/0`; clean; no git op locks.
- state SHA `1bb777653033e3f92a66c4e64dd8bab35dcea4639c0bec70b52f1594f5290b0d`;
  counts `374 CONFIRMED / 17 PLANNED / 0 SENT / 0 UNKNOWN`; contiguous CONFIRMED prefix 374.
- binary SHA `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`, length `395144`.
- on-chain buffer SHA `128c0b3eaa4fe8a79be90295f11656c9cbe04cf9d2afd6991ec55703e97a021c`,
  owner `BPFLoaderUpgradeab1e…`, allocation `395181`, status `BUFFER_WRITING`.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- fresh candidates `374,375,376,377,378`, all PLANNED, contiguous, null signatures.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed)
  `47e1ece08ae4bd86a55811ae0291a5f2923e97f1681604676a01d567099f1139`; max tx `1231` bytes (≤ 1232).
- authority balance `3246608680` lamports; headroom `243880920`; funding `SUFFICIENT`.
- Exact-SHA CI run `30267507464` (headSha `f948c7d…`) = `success` (verified via GitHub API).
- Cooldown from prior session ~2.5 h (≥ 900 s). Baseline devnet unit suite 379/379.
- Prior three checkpoints (359–363, 364–368, 369–373) each carry 5 durable full signatures (15 total).

## The one supervised uploader invocation

- outer execution ID `9cca77d8-133c-4fe2-8204-0197a3ca6ecf`;
  inner (lease) execution ID `3c44ea9d-c486-4290-b216-8f85e9951a44`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, childExitCode 0,
  runtimeElapsedMs 91024.
- selected 5 / attempted 5 / sent 5 / confirmed 5; every err = null.

### Full signatures (all confirmed)

| index | signature |
|------:|-----------|
| 374 | `2szqwj6s9CPv6nfKF2KkDoTHWqM9ChS6wFMr51PHpJaePqMg2e3MBFJj63UMrJzF15y4MoZEBPNwnuXWxiNWMLt6` |
| 375 | `5mdTUY3KG1BM9ezsgsTxjwz586p5F3JTdEzzMRnc818GfT8ounfFxahMaq9nYC36z7Wk8HYKyGiauNb78UC1WLWX` |
| 376 | `sWSiqyzmKhb6p9M1dTDfYhhanRYzKz4xsaMpw9Xy44ZoTqQDHELy5XH2dLeMr6aVf5bNA3efHQ1tz3K8oUQ7Kn7` |
| 377 | `2CJsQ3CrLB86CpWoDYShiWWG3WBGZu83TefMJudtqjinvmrgYryD7VmuBTJe8Q3Juh8a3dotJJRhdeV4W6oTeaZv` |
| 378 | `2zwZpD8veGb6eiAw19X9wXcZPo22YDxWj7b8saQ3wk18681RPA83k2SGSkF79vnXWqx3A3dqjBDgH4yz6QwYmYHw` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- request start gap 500 ms; confirmation poll 2000 ms; inter-chunk 3000 ms;
  request timeout 15000 ms; retries 0; rate-limit 0; send/confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`3c44ea9d…`) → releaseReady, 0 proposed transitions,
  `onchainWrite: false`, evidenceHash
  `afeb089a74c382f1f0a1efaef7f3c08f9d819e04666a3a141a6f16c5a6e716c6`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.
- durable evidence root: `.devnet/upload-window-host-results/9cca77d8-133c-4fe2-8204-0197a3ca6ecf/`.

## Resulting state and buffer

- state counts `379 CONFIRMED / 12 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `b19f3a252f14029149eaa0e822f9e6b4227a7ba8035c629e21650324a0e28124`.
- on-chain buffer SHA `9a0d1fc2371cc4de21941c2399bded73e6d5514f7b1807700b14f95687a5d63f`
  (changed from `128c0b3e…`); status `BUFFER_WRITING`.
- authority balance after `3246583680` lamports (Δ 25 000 = 5 × 5 000 base fee); funding `SUFFICIENT`.

## Validation

Code unchanged from CI-green baseline `f948c7d…` (only gitignored `.devnet` mutated;
tracked tree clean). Post-window devnet unit suite 379/379. Chunk 378 was uploaded
in this window; the historical `378/1` accounting anomaly did **not** recur
(suite remained 379/379). Root cause of that historical anomaly remains UNPROVEN;
disposition unchanged.

## Remaining campaign

12 chunks remain `PLANNED` (379 confirmed of 391). Deploy/finalize stays a
separately authorized phase after all 391 chunks are independently proven CONFIRMED.
