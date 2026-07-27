# Phase 2 R4N Pilot — Window (chunks 274–278)

Status: window terminal-complete, reconciled, released, quiescent. Second and
final window of the bounded two-window pilot. No claim of full upload, program
finalization, deployment, or business flow.

## Between-window boundary satisfied (window 1 → window 2)

Before this window, all independently proven after window 1 (269–273):

- every selected chunk finalized; state/buffer consistent; reconcile
  `SAFE_TO_RELEASE`; lease released; no active lock/process.
- window-1 checkpoint published at commit
  `a4731ba49c10bf40b9b6799640f1e83f66758717`; exact-SHA CI `30228341174` success.
- full inter-window cooldown elapsed (921 s ≥ 900 s from window-1 finish
  `2026-07-27T00:44:23Z`).
- fresh full preflight passed; no classifier/evidence/RPC/Git/CI/state anomaly.

## Pre-window baseline (fresh)

- branch `main`; HEAD = origin/main = remote = `a4731ba49c10bf40b9b6799640f1e83f66758717`; `0/0`; clean.
- pre-window state SHA `9b9708b669821729ea70f6bf38b22a0f9ef531a34a3833e7e7fcfa8bbe0db30a`;
  counts `274 CONFIRMED / 117 PLANNED / 0 SENT / 0 UNKNOWN`.
- pre-window finalized buffer SHA `436f64660c2e5f4eebf65a34fc0643996b372a0d3a3a12b93742c4a15b91b132`,
  owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- fresh candidates `274,275,276,277,278`, all PLANNED, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest recomputed against the current state
  `5e20046d0da0a29bfd096941b820a0a16492c04127016afbd2021d02e8580b5a`; max
  serialized transaction size `1231` bytes (≤ 1232). (Distinct from the
  pre-window-1 274–278 value because the digest binds the current state SHA.)
- authority balance `3247108680` lamports.

## The one supervised uploader invocation

- outer execution ID: `5cfb05c8-fd68-4ff4-922b-3fa26aca3204`
- inner execution ID: `9067ab5a-0cd9-45fb-ac79-0cd4fca3bd34`
- host verdict `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false.
- inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, `WINDOW_LIMIT`.
- selected 5 / attempted (sent) 5 / finalized (confirmed) 5.

### Signatures (all verified `finalized`, err = null)

| index | signature |
|------:|-----------|
| 274 | `Kj9t5jBJNN7En2ghbrD3Y6SgqPWR7xMXCAfoBstXpN1g1oR9pN2kzaZaMFXUD3etoc7vKNATWEFPNLKEwFnraU7` |
| 275 | `3bTbiXVE3DPBy5bySwwebTkJS4dwsuTAEsgyHWfso5V2ksEC4n4ExJ2VwppoFCg7ENGCcMcUsLfgujUGfcHotqMk` |
| 276 | `3e96WqvxNCkdPxhM6oVjABkVHUoCG6tg2Ng8iTqoazHpJC9jcH825rAop6kHf8xeFGiKYV3edNqvekjNRa6rPCCZ` |
| 277 | `3LuPDoagAVRCiUoGBQhJK8mjk6a63L2wYcB6rUTJNT4C6ZYwPfheh5MUymnGZn941Skc1PxTkk9CGwMBmwoPYXs7` |
| 278 | `2x5JJSX1cp7dS8zmz9dANtYdArgDoAp5WXVNEZYg8guTQxcrNaybJafEt8bW52Y9Dq1qgWRPcVGx5RPy1L1u7rYv` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error);
  `SEND_RAW_TRANSACTION` 5, `GET_SIGNATURE_STATUSES` 35, `GET_LATEST_BLOCKHASH` 5,
  `GET_ACCOUNT_INFO` 7, `GET_RENT_EXEMPTION` 2, `GET_BALANCE` 1, `GET_GENESIS_HASH` 1.
- min global RPC start gap 500 ms; confirmation poll interval 2000 ms;
  pre-sign/inter-chunk cooldown 3000 ms; retries 0; rate-limit 0; send errors 0;
  confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (execution `9067ab5a…`) → `SAFE_TO_RELEASE`,
  releaseReady, 0 proposed transitions, `onchainWrite: false`, evidenceHash
  `f92e5678e3c8901b6bd5983783b3d0735ca39475fb5c7471222aed5580779ec1`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false,
  `onchainWrite: false`.
- post-release: active lease absent, operation lock absent, uploader/supervisor/
  outer-host processes absent.

## Resulting state and finalized buffer

- state counts `279 CONFIRMED / 112 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `6ad765081d324a2db882a9da40a2c1d3363985d68ac5967ad9939b29b0db64a5`.
- finalized buffer SHA `ab6738258bc08ab165f3a5a16f8e857f42393f09db9c91477e56d3117cc8f383`
  (changed from `436f6466…` because chunks 274–278 were written); owner
  `BPFLoaderUpgradeab1e…`, executable false, length `395181` unchanged.
- authority balance after `3247083680` lamports.

## Validation

Code unchanged from the CI-green baseline `a4731ba…` (only gitignored `.devnet`
mutated). Devnet unit suite re-run: 379/379. Anchor/Rust/SBF/tx-size ladder
re-verified by the exact-SHA publication CI.

## Pilot summary

- outer-host invocations this pilot: 2 (one per window); uploader invocations 2;
  transactions signed/sent 10; all finalized; `SENT = 0`, `UNKNOWN = 0` globally.
- both leases released; historical incident evidence unchanged.
- No third window was run.

## Remaining campaign

112 chunks remain `PLANNED` (279 confirmed of 391) — ~23 further five-chunk
windows. The two-window pilot validated the full between-window boundary
(publish → exact-SHA CI green → 900 s cooldown → fresh preflight → next window).
A separately authorized larger multi-window campaign may now be considered.
