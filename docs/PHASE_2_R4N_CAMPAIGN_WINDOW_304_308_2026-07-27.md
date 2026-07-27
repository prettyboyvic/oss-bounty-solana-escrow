# Phase 2 R4N Campaign — Window (chunks 304–308)

Window 3 (final) of the bounded ≤4-window campaign; planned target of 3 windows
reached. Terminal-complete, reconciled, released, quiescent. No claim of full
upload, program finalization, deployment, or business flow.

## Between-window boundary satisfied (window 2 → window 3)

- window 2 (299–303) fully closed; all finalized; reconcile `SAFE_TO_RELEASE`;
  lease released; checkpoint `61e3152dd6ce33b0983167452be9586d34d5a3ce`;
  exact-SHA CI `30234253681` success; cooldown 919 s (≥ 900); fresh preflight passed.

## Pre-window baseline (fresh)

- HEAD = origin/main = remote = `61e3152dd6ce33b0983167452be9586d34d5a3ce`; `0/0`; clean.
- state SHA `d52609d2e5798713c61ddbf45cb3125c82afbcf12cee76f05fc51a0ddde133bf`;
  counts `304 CONFIRMED / 87 PLANNED / 0 SENT / 0 UNKNOWN`.
- finalized buffer SHA `da5b40fc7857b5898cf49a5687cdb4f171d75bc22c704962260ec3b5bbe79418`,
  owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- fresh candidates `304,305,306,307,308`, all PLANNED, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed vs current state)
  `c3b32b64163ccc72fb257b50ebc9317c3d30a622b12a157b26f09522b4fc3619`; max tx `1231` bytes (≤ 1232).
- authority balance `3246958680` lamports.

## The one supervised uploader invocation

- outer execution ID `e2cb7379-2eb1-4a87-a2d0-aa14caa48cd3`;
  inner execution ID `68d03cd2-681b-4582-b92a-9a400ae2b754`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, `WINDOW_LIMIT`.
- selected 5 / attempted 5 / sent 5 / confirmed 5 / finalized 5.

### Signatures (all `finalized`, err = null)

| index | signature |
|------:|-----------|
| 304 | `2riwXy6yY3CgXgm8i8RqfT2qrjWKFwQzrQgVLG47DLokfb2FcxQMqA7kcg647ek7tT6bjJ3H8fvrKynYi9mQAPvK` |
| 305 | `27ctQJKVo2qWw4474h5b6M5pgQ3qjQRmK7KWfcTp5R36rHgvvC9bX4XPitRkXUUZyFBSXLPe7W6MDKG9L8DMoqzk` |
| 306 | `EXrULupxpFJ8n33xCf6CbGBVefKPSzk5mfE4vw6EP46KPNaggqFE5dkfTeBu2SE3Vxe6fSTPTRgQruzVTUjuduD` |
| 307 | `5n1s4LxJk16Zt4Ss6VMotidPJxdT91wR6nVsiQKgrsQVPcyvom3rR8VVnfg25p1nAo2GKiLez3C5PoKYQ98mvGuz` |
| 308 | `2RTqtwxyFJ5i2t2kd6UGtS12epipWGzMASct68KubT3uP3Se7ZhBghPynt3J6Ns1b1H57hRzjBe1UixGZ5hGJjRS` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- min RPC start gap 500 ms; confirmation poll 2000 ms; pre-sign/inter-chunk 3000 ms;
  retries 0; rate-limit 0; send errors 0; confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`68d03cd2…`) → `SAFE_TO_RELEASE`, releaseReady,
  0 proposed transitions, `onchainWrite: false`, evidenceHash
  `0dce9f8ad0ea804a89f995f951673dfbdbafd9b89052ecf940f9296996f90df7`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false, `onchainWrite: false`.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.

## Resulting state and finalized buffer

- state counts `309 CONFIRMED / 82 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `5aa4e8bd725a6e089b0889cf181112c5133b50efff241af0e64f4cc2797a9376`.
- finalized buffer SHA `1f0970e54b9e35aa1d804e150ff713647f7ae31386bf0bcb5088b646243a0386`
  (changed from `da5b40fc…`); owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- authority balance after `3246933680` lamports.

## Validation

Code unchanged from CI-green baseline `61e3152…` (only gitignored `.devnet` mutated).
Devnet unit suite 379/379. Anchor/Rust/SBF/tx-size re-verified by exact-SHA CI.

## Campaign summary (this session, three windows)

- windows: 294–298, 299–303, 304–308. outer-host invocations 3; uploader
  invocations 3; transactions signed/sent 15; all finalized; `SENT = 0`,
  `UNKNOWN = 0` globally; three leases released.
- No fourth window run (planned 3; ceiling 4). Historical incident evidence unchanged.

## Remaining campaign

82 chunks remain `PLANNED` (309 confirmed of 391) — ~17 further five-chunk
windows (the last a partial window of the final remaining candidates). A
separately authorized next batch may continue under the same per-window boundary.
