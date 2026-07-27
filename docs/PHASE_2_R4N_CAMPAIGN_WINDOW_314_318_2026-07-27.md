# Phase 2 R4N Campaign — Window (chunks 314–318)

Window 2 (final) of the bounded ≤3-window campaign; planned target of 2 windows
reached. Terminal-complete, reconciled, released, quiescent. No claim of full
upload, program finalization, deployment, or business flow.

## Between-window boundary satisfied (window 1 → window 2)

- window 1 (309–313) fully closed; all finalized; reconcile `SAFE_TO_RELEASE`;
  lease released; post-window unit suite 379/379; checkpoint
  `b9b6edb0fb838fce86be5172744b00d2ed8bf026`; exact-SHA CI `30235931168` success;
  cooldown 918 s (≥ 900); fresh preflight passed.

## Pre-window baseline (fresh)

- HEAD = origin/main = remote = `b9b6edb0fb838fce86be5172744b00d2ed8bf026`; `0/0`; clean.
- state SHA `7cc0c16a2bcd315d218d36c4794af48481cd079dcc66464f3190ae161cc8aed5`;
  counts `314 CONFIRMED / 77 PLANNED / 0 SENT / 0 UNKNOWN`.
- finalized buffer SHA `d2a103fc263f94a6f12d0d9985d49a92fdc10de4014ed36c59dcb155af099cf8`,
  owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- fresh candidates `314,315,316,317,318`, all PLANNED, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed vs current state)
  `4c939eef1f7b41c9fe38986d0349a75e1899a5b79c995f5eacd5e940ddace63c`; max tx `1231` bytes (≤ 1232).
- authority balance `3246908680` lamports.

## The one supervised uploader invocation

- outer execution ID `9504d51c-63d6-48db-b73e-6d6f23bc20ab`;
  inner execution ID `a490df2c-bc20-4df5-ad7f-3603f4408d61`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, `WINDOW_LIMIT`.
- selected 5 / attempted 5 / sent 5 / confirmed 5 / finalized 5.

### Signatures (all `finalized`, err = null)

| index | signature |
|------:|-----------|
| 314 | `MzTCMA3jrJ2GpkLUu2MsVyZrLbvAo5mti1gTnVhbicwD7vrcyaQPnABxvg4Lyn8eeQcg2Pm7Xs1NVb1UKXDeeRc` |
| 315 | `M3m64vX5baDHbLiL3aDzz7bWo9sg33RnsRqtV9q18zodWco6xtgEeGBJFZC32iiVNUaUtNxaWfmFJEuzHMAx1J5` |
| 316 | `3HdMk54RsmRepUihjd1r5gdaUW9nxJhVHTemnzwFD6N9ZZtikUTaruKivTRQMprvRjHBC1VRtHj2WdAir3h3Lai3` |
| 317 | `51xtKJnmn8FmfWpz9PVjG41FfGPqdnATe9SCriifHBACs8f3cTB85mu7tzCDCUTzXEtY2MT27nvYHsGKnannMrV3` |
| 318 | `4GBspDPU5UNVHTk3LzKq1r9ccuMufqLE4FfRk2sHAvF9K1YkuVYqpXFczrwaAQ6fdbkhCr7bQmg16sTVxDEKeWZf` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- min RPC start gap 500 ms; confirmation poll 2000 ms; pre-sign/inter-chunk 3000 ms;
  retries 0; rate-limit 0; send errors 0; confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`a490df2c…`) → `SAFE_TO_RELEASE`, releaseReady,
  0 proposed transitions, `onchainWrite: false`, evidenceHash
  `8dae4c6d25b32317db33a0ceef561962addf30b3511fc5c6237229d3d79cc76f`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false, `onchainWrite: false`.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.

## Resulting state and finalized buffer

- state counts `319 CONFIRMED / 72 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `2cbaf8f0427469b8fb2c4e179a24d89349cd62e4cc2cb84ac01f01c8b4c04d5d`.
- finalized buffer SHA `fa782667c2a21b7a4215c8761f2b948e3cc28c62263388d1319c1049f8da33d5`
  (changed from `d2a103fc…`); owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- authority balance after `3246883680` lamports.

## Validation

Code unchanged from CI-green baseline `b9b6edb…` (only gitignored `.devnet` mutated).
Post-window devnet unit suite 379/379. Anchor/Rust/SBF/tx-size re-verified by exact-SHA CI.

## Campaign summary (this session, two windows)

- windows: 309–313, 314–318. outer-host invocations 2; uploader invocations 2;
  transactions signed/sent 10; all finalized; `SENT = 0`, `UNKNOWN = 0` globally;
  two leases released.
- Prior `378/1` validation anomaly independently dispositioned non-material
  before any live write (not reproduced across 8 isolated runs). No third window
  run (planned 2; ceiling 3). Historical incident evidence unchanged.

## Remaining campaign

72 chunks remain `PLANNED` (319 confirmed of 391) — 14 further full five-chunk
windows plus one final partial window of 2 chunks (72 = 14×5 + 2). A separately
authorized next batch may continue under the same per-window boundary.
