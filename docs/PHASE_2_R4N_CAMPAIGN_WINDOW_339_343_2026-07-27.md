# Phase 2 R4N Campaign — Window (chunks 339–343)

Window 1 of a bounded ≤3-window session (operator-approved target of 2 windows).
Terminal-complete, reconciled, released, quiescent. No claim of full upload,
program finalization, deployment, or business flow.

## Pre-window baseline (independently verified)

- HEAD = origin/main = remote = `1664796e727c053c2138de32cc26c6a13046277a`; `0/0`; clean.
- state SHA `15b01e848537d2976596bcf31556f3d3aaed9ecd183f6047924a4bbc9a7a28c5`
  (= sha256 of on-disk canonical `state.json`); counts
  `339 CONFIRMED / 52 PLANNED / 0 SENT / 0 UNKNOWN`; contiguous CONFIRMED prefix 339.
- binary SHA `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`,
  length `395144` (state + on-disk file agree).
- on-chain buffer SHA `52b6f3b3745a5d7248460dd5f3c7a1e31f27859732aed7668f0bfc39ae1c4ee2`,
  owner `BPFLoaderUpgradeab1e…`, status `BUFFER_WRITING`.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- fresh candidates `339,340,341,342,343`, all PLANNED, null signatures.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed vs current state)
  `e87ae5f1216b806b6113c910c40e0496244e2d9c8d023c58262af4e18b1f393f`;
  max tx `1231` bytes (≤ 1232).
- authority balance `3246783680` lamports; funding `SUFFICIENT`.
- Exact-SHA CI run `30241389706` (headSha `1664796e…`) = `success` (verified via GitHub API).
- Cooldown from prior window ~3h53m (≥ 900 s). Baseline devnet unit suite 379/379.

## The one supervised uploader invocation

- outer execution ID `bf2f4b83-7b65-44fa-9802-98aa243c402d`;
  inner (lease) execution ID `49f388b1-e46f-4280-839f-0eefef21333d`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, childExitCode 0,
  runtimeElapsedMs 91592.
- selected 5 / attempted 5 / sent 5 / confirmed 5.

### Signatures (all confirmed)

| index | signature |
|------:|-----------|
| 339 | `5sqzQUvRKwE5…` |
| 340 | `gQs64X7o8TSW…` |
| 341 | `3ttLFqEpLbAf…` |
| 342 | `3rHevgPxdpDH…` |
| 343 | `4rKbSTjdvE5q…` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error);
  `SEND_RAW_TRANSACTION` 5, `GET_SIGNATURE_STATUSES` 35, `GET_LATEST_BLOCKHASH` 5.
- request start gap 500 ms; confirmation poll 2000 ms; inter-chunk 3000 ms;
  request timeout 15000 ms; retries 0; rate-limit 0; send/confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`49f388b1…`) → releaseReady, 0 proposed transitions,
  `onchainWrite: false`, `stateMutation: false`, evidenceHash
  `acfb54c8b24c095c65ac1932dbd70709e202576e8194729eac21b3fbc6dbadd0`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false, `onchainWrite: false`.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.

## Resulting state and buffer

- state counts `344 CONFIRMED / 47 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `30fad9faf0fe2687ab0287a8718febae956fcb0be74bd8c27879fa5ddcd212fd`.
- on-chain buffer SHA `9ca3013b1d9942a3046386195145b7775fef0147d73c65cd2097fb3e4237b1b5`
  (changed from `52b6f3b3…`); status `BUFFER_WRITING`.
- authority balance after `3246758680` lamports (Δ 25 000 = 5 × 5 000 base fee);
  funding `SUFFICIENT`.

## Validation

Code unchanged from CI-green baseline `1664796…` (only gitignored `.devnet` mutated;
tracked tree clean). Post-window devnet unit suite 379/379. No recurrence of the
historical `378/1` anomaly (root cause remains UNPROVEN; disposition unchanged).

## Remaining campaign

47 chunks remain `PLANNED` (344 confirmed of 391). Deploy/finalize stays a
separately authorized phase after all 391 chunks are independently proven CONFIRMED.
