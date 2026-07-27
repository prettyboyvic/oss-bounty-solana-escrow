# Phase 2 R4N Pilot — Window (chunks 269–273)

Status: window terminal-complete, reconciled, released, quiescent. First window
of a bounded two-window pilot authorized after the first repaired R4N window.
No claim of full upload, program finalization, deployment, or business flow.

## Pre-window baseline (independently verified)

- host `THIEN16`, native Windows; RPC healthy; finalized commitment available.
- branch `main`; HEAD = origin/main = remote = `8dbe3f14b7eb7af6b04f5d328b873f32c89addce`; `0/0`; clean.
- exact-SHA CI `30208183930`: success.
- pre-window state SHA `da0ff8f0faf0047556cdf62b7bd43e5034cf79c756225b15e14d0ed8ee577b05`;
  counts `269 CONFIRMED / 122 PLANNED / 0 SENT / 0 UNKNOWN`.
- pre-window finalized buffer SHA `4ec74e50a216c63d16d208aa2fad33560a960c16212ead53ada0775a93904e76`,
  owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- fresh candidates `269,270,271,272,273`, all PLANNED, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- recomputed `R4_CANDIDATE_EVIDENCE_V1` digest
  `053241b918f94a46cf859daa0f113ed87162e089aa3e55b3f15f30f0b1ce4b32`; max
  serialized transaction size `1231` bytes (≤ 1232).
- authority balance `3247133680` lamports; inter-window cooldown satisfied
  (prior window finished `2026-07-26T15:14:18Z`, ~9.5 h prior).
- recovery archive and prior released lease (`3b05edfd…--1af6b9b0…`) intact.

## The one supervised uploader invocation

- outer execution ID: `da25e5db-512e-4b53-976a-cc90e34f57e3`
- inner execution ID: `6139c2bb-9067-41ac-aedc-402127446b4b`
- host verdict `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false.
- inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, `WINDOW_LIMIT`.
- selected 5 / attempted (sent) 5 / finalized (confirmed) 5.

### Signatures (all verified `finalized`, err = null)

| index | signature |
|------:|-----------|
| 269 | `2ELa3nN9g4Rujo4G6iYsH9Jjw8fT6tVbTqf8quBHVu4mBqwMxWYr3fomzKJ8ReTwWvyD3ixp9wRsst1Rob4C9xXx` |
| 270 | `2hppyq8Z4cYHrifmQchJCZ5u4EbwZfmuWqSWey8USZF8SxqjnGoVhuzstXHeh1n454HkArp4zZ358pTR2cVqU8gz` |
| 271 | `2refzRfd3953Qb7FjFuSrVEgwznxJ5dYAdWzjeZx4FxTR1xruE4Wsyau8zdBaQK6vhoGWcbtvQuVBRTPgndnQ8Bg` |
| 272 | `3vdhvctipLNqkuSkUY453fs1YKLgJMX2rm3vtUnLhpfwzG4mLZve1sSJv2WDGHCVW1Zzjm2uxKYjPFyHJW8hDJK9` |
| 273 | `4UMrSZun9vu7vXds2VqdhkzonWyLh5i4gq5aZXmC4xR867gugvr4DJoiGrhuJ8XTUaLvGYfgen8j5sK8hFhJS9Br` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error);
  `SEND_RAW_TRANSACTION` 5, `GET_SIGNATURE_STATUSES` 35, `GET_LATEST_BLOCKHASH` 5,
  `GET_ACCOUNT_INFO` 7, `GET_RENT_EXEMPTION` 2, `GET_BALANCE` 1, `GET_GENESIS_HASH` 1.
- min global RPC start gap 500 ms; confirmation poll interval 2000 ms;
  per-chunk confirmation ~12.55 s; pre-sign/inter-chunk cooldown 3000 ms.
- retries 0; rate-limit events 0; send errors 0; confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (execution `6139c2bb…`) → `SAFE_TO_RELEASE`,
  releaseReady, 0 proposed transitions, `onchainWrite: false`, evidenceHash
  `df1538de6d960b33b9c015d45623fc77b974dc1b550bb195dd3e7e05e27e06b1`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false,
  `onchainWrite: false`.
- post-release: active lease absent, operation lock absent, uploader/supervisor/
  outer-host processes absent.

## Resulting state and finalized buffer

- state counts `274 CONFIRMED / 117 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `9b9708b669821729ea70f6bf38b22a0f9ef531a34a3833e7e7fcfa8bbe0db30a`.
- finalized buffer SHA `436f64660c2e5f4eebf65a34fc0643996b372a0d3a3a12b93742c4a15b91b132`
  (changed from `4ec74e50…` because chunks 269–273 were written); owner
  `BPFLoaderUpgradeab1e…`, executable false, length `395181` unchanged.

## Validation

Code unchanged from the CI-green baseline `8dbe3f14…` (only gitignored `.devnet`
mutated). Devnet unit suite re-run separately; the Anchor/Rust/SBF/tx-size ladder
is re-verified by the exact-SHA publication CI.

## Safety accounting

- uploader invocations this window: **1**; transactions signed/sent 5; all
  finalized; `SENT = 0`, `UNKNOWN = 0` globally.
- historical incident evidence unchanged; uploader lease released.

## Remaining campaign

117 chunks remain `PLANNED` (274 confirmed of 391). A second pilot window
(274–278) may follow only after this checkpoint's exact-SHA CI is green, the full
inter-window cooldown elapses, and a fresh full preflight passes.
