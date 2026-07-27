# Phase 2 R4N Campaign — Window (chunks 319–323)

Window 1 of a bounded ≤3-window campaign (planned 2). Terminal-complete,
reconciled, released, quiescent. No claim of full upload, program finalization,
deployment, or business flow. The historical `378/1` validation anomaly remains
independently dispositioned non-material with root cause unknown/suspected (not
proven); this session's clean baseline suite re-ran 379/379 before any live write.

## Pre-window baseline (independently verified)

- HEAD = origin/main = remote = `caa064471e967fb359635448bcf75d9331cc5212`; `0/0`; clean.
- exact-SHA CI `30236620572`: success.
- pre-window state SHA `2cbaf8f0427469b8fb2c4e179a24d89349cd62e4cc2cb84ac01f01c8b4c04d5d`;
  counts `319 CONFIRMED / 72 PLANNED / 0 SENT / 0 UNKNOWN`.
- pre-window finalized buffer SHA `fa782667c2a21b7a4215c8761f2b948e3cc28c62263388d1319c1049f8da33d5`,
  owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- fresh candidates `319,320,321,322,323`, all PLANNED, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed vs current state)
  `14e232a5ee6422227283af2f5c967f29541b6ca44486556ca5f6a67b572f2e56`; max tx `1231` bytes (≤ 1232).
- authority balance `3246883680` lamports; cooldown 2233 s (≥ 900).

## The one supervised uploader invocation

- outer execution ID `14906ae8-d04c-4064-b7c6-e48506587f59`;
  inner execution ID `b2b51690-0120-4659-9592-254cd48a2351`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, `WINDOW_LIMIT`.
- selected 5 / attempted 5 / sent 5 / confirmed 5 / finalized 5.

### Signatures (all `finalized`, err = null)

| index | signature |
|------:|-----------|
| 319 | `4NpMLHiXPQ6ZN7KVt9CfibCA3HFVRtykjvFBVGYrd4QWkJvmaSG8czsm5GPcBiUS68kVLvRPkC5mSZXHzBUv18DZ` |
| 320 | `yzsa5B4K4Q8qt8uWfCegRQq3DW4ur3CeK5Gr1m28d6yK1xhFUvw7Kbdw3qCUH2FepiGrgTULKc6LAceekVzA8iG` |
| 321 | `2D1Q7n1EAy2yzBQU9UAcMPa4cYkEUYn56Zvif5UqM37twNCCgocNp4iRjVFmouQHPGYtvQFX1bpCB2wTZytLDVrE` |
| 322 | `5C9EmEPDN9WCs8ZBW3tc92NdNmq2phJK5pmGFuY1VhJ1Bpc4A3MLSbWz7jvgYFapYbeFKzFcXoJVFougYBeHr1Aw` |
| 323 | `5QMhPiGWwXJ6xpVF2eTNJa6Mk2N4uwndPFNTzhTTibugA6yfyHp1YRBJEz1vMjzMCNCENd3PVbvVFqrxkm89sTrW` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- min RPC start gap 500 ms; confirmation poll 2000 ms; pre-sign/inter-chunk 3000 ms;
  retries 0; rate-limit 0; send errors 0; confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`b2b51690…`) → `SAFE_TO_RELEASE`, releaseReady,
  0 proposed transitions, `onchainWrite: false`, evidenceHash
  `c7dc447cc91be996a7c410f693480f9bf62809ee3bfcd4ed905909d6acbe989a`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false, `onchainWrite: false`.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.

## Resulting state and finalized buffer

- state counts `324 CONFIRMED / 67 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `c6218cfbaa2788b1daf7e1c6b412043a79a3c0857b838f2e5ba538880c8a3123`.
- finalized buffer SHA `6e87c90254cce2a9673d4954e069fbf23d6443decaf780b4ddb454055757eb52`
  (changed from `fa782667…`); owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.

## Validation

Code unchanged from CI-green baseline `caa0644…` (only gitignored `.devnet` mutated).
Post-window devnet unit suite 379/379. Anchor/Rust/SBF/tx-size re-verified by exact-SHA CI.

## Remaining campaign

67 chunks remain `PLANNED` (324 confirmed of 391). One more planned window
(324–328) may follow after this checkpoint's exact-SHA CI is green, cooldown
elapses, a post-window local validation passes, and a fresh preflight passes.
