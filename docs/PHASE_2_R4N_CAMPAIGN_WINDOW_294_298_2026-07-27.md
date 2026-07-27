# Phase 2 R4N Campaign — Window (chunks 294–298)

Window 1 of a bounded ≤4-window campaign (planned 3). Terminal-complete,
reconciled, released, quiescent. No claim of full upload, program finalization,
deployment, or business flow.

## Pre-window baseline (independently verified)

- HEAD = origin/main = remote = `99d2e6850e66285640ac1d2cd9e5d935c844d268`; `0/0`; clean.
- exact-SHA CI `30231871212`: success.
- pre-window state SHA `c4ea16e0d6affeb5a6d483c66f5fd2ac4459397b70189877d77f00c67334180d`;
  counts `294 CONFIRMED / 97 PLANNED / 0 SENT / 0 UNKNOWN`.
- pre-window finalized buffer SHA `6410c4fe0ea7d73f448adbeff82e1e4466eee0b280e44105ff1f59c372f0d061`,
  owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- fresh candidates `294,295,296,297,298`, all PLANNED, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed vs current state)
  `4c8beeefb43cdfef2e3bca26a50049f4a6ffc2dad5928d3d5120d57cf6a45ca5`; max tx `1231` bytes (≤ 1232).
- authority balance `3247008680` lamports; cooldown 2246 s (≥ 900).

## The one supervised uploader invocation

- outer execution ID `902e41e9-8d2f-442a-9374-36990ee73284`;
  inner execution ID `14aba367-b40b-4ab9-981f-be5ed26659c2`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, `WINDOW_LIMIT`.
- selected 5 / attempted 5 / sent 5 / confirmed 5 / finalized 5.

### Signatures (all `finalized`, err = null)

| index | signature |
|------:|-----------|
| 294 | `J7hRzpBgCzYxtU7rzNVTtiGYPNUZUiFLpQQainpvX8YbGwsN4PrayDQKScUPoikiDCxpuLsYhNkSsLCHU1R82Gh` |
| 295 | `4gGtC1KAbHgtD6BfnmNu7N98Gst1bmu9nPZWL9jp6ifgusSS1nGwbzyeEkxmdwy6UcAtxpc9LCyq4HR6z5E4n6B` |
| 296 | `LbTGQi6s82QSCF6E4ZqnKmPaUnERqXYHyYiU2HqnmpePBJHCpisB1gZF6GicaMjwMpCp4jsXEgiTGBbmsRJdJeH` |
| 297 | `2P8WXEQcf5XXLTPe3BnJ4f7NLNWbbJN26rSrELkdZV5zTCTR3KazdHPTyU2h85WXHLdKj9621mLxyN1NnEBfnBFJ` |
| 298 | `21QTM1kqfC2AjbujsJmB7bDiFR4ApCm69L57RHRiF7sfrkoaXkKLzXdaQroMbFU75dthrXCdvJjAueATyeCksKyv` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- min RPC start gap 500 ms; confirmation poll 2000 ms; pre-sign/inter-chunk 3000 ms;
  retries 0; rate-limit 0; send errors 0; confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`14aba367…`) → `SAFE_TO_RELEASE`, releaseReady,
  0 proposed transitions, `onchainWrite: false`, evidenceHash
  `b55d9b9e1afe21d448e63a739736d9c005e79a12ce096532c69135157835b146`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false, `onchainWrite: false`.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.

## Resulting state and finalized buffer

- state counts `299 CONFIRMED / 92 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `b9c10625149b3a257792c42d66d814ade2043c05174ed5b0f902457a03fac1f6`.
- finalized buffer SHA `26af663e732d293df72096c9c071deb756deae4d81df8be3c1e620a7fb00cae3`
  (changed from `6410c4fe…`); owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.

## Validation

Code unchanged from CI-green baseline `99d2e68…` (only gitignored `.devnet` mutated).
Devnet unit suite 379/379. Anchor/Rust/SBF/tx-size re-verified by exact-SHA CI.

## Remaining campaign

92 chunks remain `PLANNED` (299 confirmed of 391). Planned windows 299–303 and
304–308 may follow, each only after this checkpoint's exact-SHA CI is green,
cooldown elapses, and a fresh preflight passes.
