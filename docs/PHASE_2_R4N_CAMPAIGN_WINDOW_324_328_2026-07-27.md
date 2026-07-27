# Phase 2 R4N Campaign — Window (chunks 324–328)

Window 2 (final) of the bounded ≤3-window campaign; planned target of 2 windows
reached. Terminal-complete, reconciled, released, quiescent. No claim of full
upload, program finalization, deployment, or business flow.

## Between-window boundary satisfied (window 1 → window 2)

- window 1 (319–323) fully closed; all finalized; reconcile `SAFE_TO_RELEASE`;
  lease released; post-window unit suite 379/379; checkpoint
  `e4c067efc9e45e10b2db936c2728f070e50225df`; exact-SHA CI `30238418842` success;
  cooldown 918 s (≥ 900); fresh preflight passed.

## Pre-window baseline (fresh)

- HEAD = origin/main = remote = `e4c067efc9e45e10b2db936c2728f070e50225df`; `0/0`; clean.
- state SHA `c6218cfbaa2788b1daf7e1c6b412043a79a3c0857b838f2e5ba538880c8a3123`;
  counts `324 CONFIRMED / 67 PLANNED / 0 SENT / 0 UNKNOWN`.
- finalized buffer SHA `6e87c90254cce2a9673d4954e069fbf23d6443decaf780b4ddb454055757eb52`,
  owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- fresh candidates `324,325,326,327,328`, all PLANNED, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed vs current state)
  `934018d8f50f330979a44f069e3ebff1d331eced03410d7a08fb415d2745de0d`; max tx `1231` bytes (≤ 1232).
- authority balance `3246858680` lamports.

## The one supervised uploader invocation

- outer execution ID `d24c647b-8df1-40b3-ad1d-b46398ced0fa`;
  inner execution ID `cd2c57bf-39cb-4bba-a0c6-0624cf4635b2`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, `WINDOW_LIMIT`.
- selected 5 / attempted 5 / sent 5 / confirmed 5 / finalized 5.

### Signatures (all `finalized`, err = null)

| index | signature |
|------:|-----------|
| 324 | `4KoXZu6pBFQ3u4ynT9ykGEYVfEfjBm9jP1twWKfMz7g1De3wBiPs98K9vwn1rQWdZiA3UrA9iE7Q8WcNi2cgRhxe` |
| 325 | `663z2CRc8q3wQHdknqGqRT4Stua9MAJ1C7qH3p5wyVsNxtcELyz3hvp3dhGuWa9rykpgWRxjhS3Kyg2wY4UomD7Q` |
| 326 | `4wHbGR49j14THjn3EK2hNGCQ4L7o44z19RrfF2X8GGa1Anpyck2h7XaZyBUvYmAwRZ99ze9yNstkxTchWHjFDnQ4` |
| 327 | `4fRPSG77ySpBLxkv9v2TvJoQBMdeo6SZwwioKL5zJHByPmvE9iUGgkYB9saE7g1cmute8JZGWabWksa1jyQ6ud68` |
| 328 | `7HxuhZEMpXWoPVWC2g3Qr1wb9RduLeapDkzAFFgGAHAk38fvisu77huB1uUzSzFwRb1qxXMrcTpxwkr1Jox3wCx` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- min RPC start gap 500 ms; confirmation poll 2000 ms; pre-sign/inter-chunk 3000 ms;
  retries 0; rate-limit 0; send errors 0; confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`cd2c57bf…`) → `SAFE_TO_RELEASE`, releaseReady,
  0 proposed transitions, `onchainWrite: false`, evidenceHash
  `e61ebf091a84dc1b722d4715ce1fa97c0f15a63d52ffe7010ac8adc314f06e28`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false, `onchainWrite: false`.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.

## Resulting state and finalized buffer

- state counts `329 CONFIRMED / 62 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `ab0d4e2390f5e91b67bedac75966e45ac56e3269640895aebadfdd495847cc6b`.
- finalized buffer SHA `a054b9e17f29b1cfcc73012375d5412efa35d847813dd12d2eae9d4a3ea42368`
  (changed from `6e87c902…`); owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- authority balance after `3246833680` lamports.

## Validation

Code unchanged from CI-green baseline `e4c067e…` (only gitignored `.devnet` mutated).
Post-window devnet unit suite 379/379. Anchor/Rust/SBF/tx-size re-verified by exact-SHA CI.

## Campaign summary (this session, two windows)

- windows: 319–323, 324–328. outer-host invocations 2; uploader invocations 2;
  transactions signed/sent 10; all finalized; `SENT = 0`, `UNKNOWN = 0` globally;
  two leases released.
- Historical `378/1` validation anomaly remained non-material (root cause
  unproven); clean baseline suite 379/379 before any live write; post-window
  suites 379/379. No third window (planned 2; ceiling 3). Historical incident
  evidence unchanged.

## Remaining campaign

62 chunks remain `PLANNED` (329 confirmed of 391) — 12 further full five-chunk
windows plus one final partial window of 2 chunks (62 = 12×5 + 2). A separately
authorized next batch may continue under the same per-window boundary.
