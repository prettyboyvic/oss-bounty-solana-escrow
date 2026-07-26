# Phase 2 R4N First Repaired Upload Window

Status: `R4N_WINDOW_PASS`. One stale-lease recovery and one supervised R4N
uploader window completed after the repository-identity repair. Chunks 264–268
are confirmed and finalized on devnet. This does **not** mean the program is
fully uploaded, finalized, deployed, or that any business flow is proven.

## Prior stale-lease recovery (already published context)

Executed once each in the preceding authorized session, unchanged here:

- read-only reconciliations: `1`; recovery mutations: `1`; recovery on-chain
  writes: `0`.
- recovery hash: `65cf8b52484c45415a3faa5ec72129da1ddca5596b0005fa44218090e01b58b7`.
- receipt `UPLOAD_PRE_SELECTION_RECOVERY_V1` archived at
  `.devnet/history/upload-leases/c44e7175-9184-4324-8d6e-94f09374434c--65cf8b52…/`
  with live `repositorySha 87cae38…` and the incident identity bound through the
  recovery hash. The historical incident authorization/evidence
  (`8f4702c…`) was not modified. The recovery archive remains untouched.

## Post-recovery baseline (this session)

- host `THIEN16`, native Windows; RPC healthy; finalized commitment available.
- branch `main`; HEAD = origin/main = remote = `87cae38981260482331e14f1a09ea1e8ed3fe471`; `0/0`; clean.
- exact-SHA CI `30204215885`: success.
- pre-window state SHA `86096abfa50e3d5bdf54cab1f11583d06293c6d2cb912563492ceca6903e794b`;
  counts `264 CONFIRMED / 127 PLANNED / 0 SENT / 0 UNKNOWN`.
- pre-window finalized buffer SHA `79f566a6d3ec79a2afae1189097d17ca728bb0125663b13c0b7bd4a3c0861c26`,
  owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- fresh deterministic candidates `264,265,266,267,268`, all `PLANNED`, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- recomputed `R4_CANDIDATE_EVIDENCE_V1` digest
  `9b77aa9af1f5885f20eb914f5fed6fb352f1b58e68767e2ed85ee5b85ed8ad44`;
  max serialized transaction size `1231` bytes (≤ 1232 ceiling).
- authority balance `3247158680` lamports; inter-window cooldown (900 s) satisfied
  (previous window finished `2026-07-23T07:15:12Z`, > 3 days prior).

## The one supervised uploader invocation

Uploader invocations after recovery: **exactly 1**, via the outer-host pathway
`scripts/devnet/upload-window-host.mjs` (the internal uploader was never invoked
directly). Fresh single-use IDs; the earlier prepared IDs (`aaa4e1c3…`,
`4ee41c1b…` first attempt) — the `aaa4e1c3` ID was never consumed.

- outer execution ID: `4ee41c1b-5ab5-4883-856d-0b5b96e88ac9`
- inner execution ID: `3b05edfd-2941-4e4f-b27e-121faaca6aa1`
- host verdict `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false.
- inner terminal `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, status `WINDOW_LIMIT`.
- selected 5, attempted (sent) 5, finalized (confirmed) 5.

### Candidates, payloads, signatures

| index | offset | length | payloadSha256 (prefix) | signature |
|------:|-------:|-------:|------------------------|-----------|
| 264 | 266904 | 1011 | `1edc3c68cb75…` | `35EUFpQLnX8P48jqUYA6aAeeJJ2kLPWbUnaKQaU4mzzKKgsXMHFz2jM6AQo5JZ8SPX6tJGZHWCVZHjrd3Y9fQum6` |
| 265 | 267915 | 1011 | `079979405e46…` | `3Ug8TLQovDRq8L7YMbq1QDKpfBkjj3WpyZCb9Qxi2ACyTXsqWpdnWVRF9fUNHJ5BpEzNn9kfVYCdA39Miv8FANHK` |
| 266 | 268926 | 1011 | `be2158ffd120…` | `5UnWgMFBSVuTEEN8Q9fxsNpxH4VWS5czRparPGyt7ZRBgKcNWhL2r6FkF2F8C72TikyGeLmt3G64CUhqGGT44Ln1` |
| 267 | 269937 | 1011 | `091664999296…` | `5Ygqb3ZcD3g3i8QwnBbg9ovzquCJDa2xd2wijz9cbysB8uGVdHcdytD8ynMWoGmMeBxaugpVjWteXfR7tVYsjUWW` |
| 268 | 270948 | 1011 | `0f1335cb36ca…` | `3LdepyHZuHSwTkHT6WEvGRbqmxxLfbs8pkdfnumwUthQMf2sNzzAWqBL4ZiXsxG7m1bMxnqaq8T2aoSPANtumbGL` |

All five signatures independently verified `finalized` with `err = null` via
`getSignatureStatuses` (searchTransactionHistory).

### Telemetry

- RPC requests: 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error).
  By method: `SEND_RAW_TRANSACTION` 5, `GET_SIGNATURE_STATUSES` 35,
  `GET_LATEST_BLOCKHASH` 5, `GET_ACCOUNT_INFO` 7, `GET_RENT_EXEMPTION` 2,
  `GET_BALANCE` 1, `GET_GENESIS_HASH` 1.
- min global RPC start gap 500 ms; confirmation poll interval 2000 ms;
  per-chunk confirmation ~12.55 s.
- pre-sign cooldown 3000 ms (inter-chunk delay); retries 0; rate-limit events 0;
  send errors 0; confirmation errors 0.
- host monotonic duration 93669 ms; inner runtime elapsed 91605.63 ms.
- terminal telemetry: window `WINDOW_LIMIT`; `liveWriteExecuted: true`.
- outer evidence: `authorization.json`, `invocation.json`, `host-result.json`,
  `supervisor-stdout.log` (4179 bytes, sha `5e0e230c…`), `supervisor-stderr.log`
  (0 bytes).

## Reconciliation and lease release

- `reconcile-upload-lease` (execution `3b05edfd…`) → `SAFE_TO_RELEASE`,
  releaseReady, 0 proposed transitions (chunks already CONFIRMED),
  `onchainWrite: false`, evidenceHash
  `1af6b9b0731f690a88e11032c800d22620d3bc4377ba5f9e29b1f959cbf95355`.
- `release-upload-lease` with that evidence hash + `R4_RELEASE_UPLOAD_LEASE`
  → `ARCHIVED/RELEASED`, idempotent false, `onchainWrite: false`.
- post-release: active lease absent, operation lock absent, uploader/supervisor/
  outer-host processes absent, git clean.

## Resulting state and finalized buffer

- state counts: `269 CONFIRMED / 122 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA: `da0ff8f0faf0047556cdf62b7bd43e5034cf79c756225b15e14d0ed8ee577b05`.
- finalized buffer SHA: `4ec74e50a216c63d16d208aa2fad33560a960c16212ead53ada0775a93904e76`
  (changed from the pre-window `79f566a…` because chunks 264–268 were written);
  owner `BPFLoaderUpgradeab1e…`, executable false, length `395181` unchanged.

## Validation

Code unchanged from the CI-green publication commit `87cae38…` (only gitignored
`.devnet` mutated by the live window). Devnet unit suite re-run: **379/379**.
The Anchor local-validator integrations, Rust tests, optimized SBF build and
serialized-transaction-size ceiling are unaffected and are re-verified by the
exact-SHA publication CI.

## Safety accounting

- uploader invocations after recovery: **1**; a second window was not run.
- transactions signed/sent: 5; all confirmed and finalized; `SENT = 0`,
  `UNKNOWN = 0` globally.
- recovery on-chain writes: `0`.
- historical incident evidence: unchanged.
- uploader lease: released.

## Remaining campaign

122 chunks remain `PLANNED` (269 confirmed of 391). At 5 chunks per window this
is ~25 further windows. No claim of full upload, program finalization,
deployment, or business-flow proof is made. A separately authorized multi-window
campaign (full cooldown, preflight, reconciliation and release between windows)
may now begin.
