# Phase 2 R4N Campaign — Window (chunks 369–373)

Window 3 (final) of a bounded ≤3-window session; operator-preferred plan of 3
windows reached and ceiling consumed. Terminal-complete, reconciled, released,
quiescent. No claim of full upload, program finalization, deployment, or business flow.

## Between-window boundary satisfied (window 2 → window 3)

- window 2 (364–368) fully closed; all CONFIRMED; reconcile releaseReady, 0
  transitions; lease released; post-window suite 379/379; checkpoint
  `b40b324d9e0c44f343af8813689a06c1f98e6924`; exact-SHA CI `30266309536` success;
  cooldown 915 s (≥ 900); fresh preflight passed; quiescence proven.

## Pre-window baseline (fresh, directly measured)

- HEAD = origin/main = remote = `b40b324d9e0c44f343af8813689a06c1f98e6924`; `0/0`; clean.
- state SHA `e290c2605d72b9445480cd69a4498c949a3806c7b7237e6e686377612874ca97`;
  counts `369 CONFIRMED / 22 PLANNED / 0 SENT / 0 UNKNOWN`; contiguous CONFIRMED prefix 369.
- binary SHA `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`, length `395144`.
- on-chain buffer SHA `a01f7be3dfb71c9fd4e35e62a01db6ec4da48ad76fa4fdf736ff778dd6da16a1`,
  owner `BPFLoaderUpgradeab1e…`, allocation `395181`, status `BUFFER_WRITING`.
- fresh candidates `369,370,371,372,373`, all PLANNED, contiguous, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed)
  `3f4b5ac902b97efe9912d95ba8f0100f4d4c4c7dc737d17bc22a7b06cb068af0`; max tx `1231` bytes (≤ 1232).
- authority balance `3246633680` lamports; funding `SUFFICIENT`.

## The one supervised uploader invocation

- outer execution ID `e323123e-f6db-4823-a872-114c4b47ecb5`;
  inner (lease) execution ID `92ea8c3c-dabc-45be-8267-80a2454c57c0`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, childExitCode 0,
  runtimeElapsedMs 91670.
- selected 5 / attempted 5 / sent 5 / confirmed 5; every err = null.

### Full signatures (all confirmed)

| index | signature |
|------:|-----------|
| 369 | `T32xZRcNM6TJERurAV9LL8eWH1J21NBTVpKXW3Aso975GsmAdwiDnBnQHZUctec5ohu1EJr4PeTxq5A5gEov4Rf` |
| 370 | `ZzfY882VZYGkJSobX7evZq6hSa1c8ecGsb6v2JUb1qyeEjs2zTP5NWgGEzwopp8DtdWipcfN88pQjuB4x99q1Hd` |
| 371 | `2inYhbFXb3rU8XwtXmduWEMMLNFr5gGDRLPQnoxg2fnTPxxNB6WtRoU8wMLnvDXxqq395LtX9Y5p6zk21obGsoPH` |
| 372 | `4TdBXPQ889axcPjF5ToUoZEiKWpLLcWFxMSweUVNHAZF9x54JdVf4KFyQH58ym8pR5hPffxWDeYZrjEcdbaFQHAd` |
| 373 | `3ECsowQibFKgNoLHK1h6YccSDpt8qkoCYMNdYZmWqSKAWfC8V1W1DsgkBg3wKz3ojUpNDrwjovScRKUkXdZYwJht` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- request start gap 500 ms; confirmation poll 2000 ms; inter-chunk 3000 ms;
  request timeout 15000 ms; retries 0; rate-limit 0; send/confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`92ea8c3c…`) → releaseReady, 0 proposed transitions,
  `onchainWrite: false`, evidenceHash
  `846011fadbd84e3de1819c1c3caf54524caa877c72650348a5478932d7ad81ae`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.
- durable evidence root: `.devnet/upload-window-host-results/e323123e-f6db-4823-a872-114c4b47ecb5/`.

## Resulting state and buffer

- state counts `374 CONFIRMED / 17 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `1bb777653033e3f92a66c4e64dd8bab35dcea4639c0bec70b52f1594f5290b0d`.
- on-chain buffer SHA `128c0b3eaa4fe8a79be90295f11656c9cbe04cf9d2afd6991ec55703e97a021c`
  (changed from `a01f7be3…`); status `BUFFER_WRITING`.
- authority balance after `3246608680` lamports (Δ 25 000 = 5 × 5 000 base fee); funding `SUFFICIENT`.

## Validation

Code unchanged from CI-green baseline `b40b324…` (only gitignored `.devnet` mutated;
tracked tree clean). Post-window devnet unit suite 379/379. No recurrence of the
historical `378/1` anomaly (root cause remains UNPROVEN; disposition unchanged).

## Campaign summary (this session, three windows)

- windows: 359–363, 364–368, 369–373. outer-host invocations 3; uploader invocations 3;
  transactions signed/sent/confirmed 15; all confirmed; `SENT = 0`, `UNKNOWN = 0`
  globally; three leases reconciled (0 transitions each) and released.
- Ceiling 3 windows; executed 3 (operator-preferred plan). Ceiling now consumed.

## Remaining campaign

17 chunks remain `PLANNED` (374 confirmed of 391) — 3 further full five-chunk
windows plus one final partial window of 2 chunks (17 = 3×5 + 2). Deploy/finalize
stays a separately authorized phase after all 391 chunks are independently proven CONFIRMED.
