# Phase 2 R4N Campaign — Window (chunks 279–283)

Window 1 of a bounded ≤5-window campaign (planned 3). Terminal-complete,
reconciled, released, quiescent. No claim of full upload, program finalization,
deployment, or business flow.

## Pre-window baseline (independently verified)

- host `THIEN16`, native Windows; RPC healthy; finalized commitment available.
- HEAD = origin/main = remote = `f46f10c9b48cbdb8666e4b846ff34b5c9feb3dd0`; `0/0`; clean.
- exact-SHA CI `30228992908`: success.
- pre-window state SHA `6ad765081d324a2db882a9da40a2c1d3363985d68ac5967ad9939b29b0db64a5`;
  counts `279 CONFIRMED / 112 PLANNED / 0 SENT / 0 UNKNOWN`.
- pre-window finalized buffer SHA `ab6738258bc08ab165f3a5a16f8e857f42393f09db9c91477e56d3117cc8f383`,
  owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- fresh candidates `279,280,281,282,283`, all PLANNED, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed vs current state)
  `4d9046f35188b53fc26ce30bfc769c9706827b71dbe466b7cec0c602b447bfb7`; max
  serialized transaction size `1231` bytes (≤ 1232).
- authority balance `3247083680` lamports; inter-window cooldown 2073 s (≥ 900).

## The one supervised uploader invocation

- outer execution ID `70d974c3-9319-4e09-a5da-25e6cb0504a4`;
  inner execution ID `0d4a479b-4fd4-4ba8-acc3-f1fff0c6068c`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, `WINDOW_LIMIT`.
- selected 5 / attempted 5 / finalized 5.

### Signatures (all `finalized`, err = null)

| index | signature |
|------:|-----------|
| 279 | `52np5VBrj1WoNUH1bdyPZhtPQ6jE4zCyF8CC178Cnn3q1TRJk1WacREHDzpqWKfSt9CbTZ3LFQVPYPnuMeCEE29T` |
| 280 | `38NYg2tXRxjc4Wo8Jqjo69vtWFG8uxTdjjiXwLtm2BYXh2Hc9Nb1ot3qW6Kq91Y2sXWN9t5TMoLgWGJCA2dtoRqi` |
| 281 | `3zAWjjxikX3T7wG2bkhNGybo2ZHCdrFXt7RXdkaMUDtm9QxQNcnFNvCbhKJwtdyGgX31qk8Y4igSYvtCE99JpYyF` |
| 282 | `59gfSxoNZPCD7BeLHdeCqs8hV6rjiCA3jmu3nxN4gFXj6focHzgtKKhAvXUMRJNKYmS7fsNrhLNkrcRgMKzUDR9n` |
| 283 | `3NvQBb2k5FoCDVYMpMaMaVZ3h4YK6pHct2R8E3baRoBBDNR83ibfXcDB6UfNwKrASr4vsT9LSayZWtcit28Enhwo` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- min RPC start gap 500 ms; confirmation poll 2000 ms; pre-sign/inter-chunk 3000 ms;
  retries 0; rate-limit 0; send errors 0; confirmation errors 0; inner runtime ~90.5 s.

## Reconciliation and release

- `reconcile-upload-lease` (`0d4a479b…`) → `SAFE_TO_RELEASE`, releaseReady,
  0 transitions, `onchainWrite: false`, evidenceHash
  `cbf524df38e9d6be873c6bbf3a8bcbe91a677bf9455e649716045a2cba945815`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false, `onchainWrite: false`.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.

## Resulting state and finalized buffer

- state counts `284 CONFIRMED / 107 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `72c110c94c9ac55afbe6ca686bc07b87dd2d299a06f390af5efc913e22fbaf69`.
- finalized buffer SHA `7f321b035ed1a7328233aec45e9f6771a1d22dfda3cc58d048418c9a8b12b172`
  (changed from `ab673825…`); owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.

## Validation

Code unchanged from CI-green baseline `f46f10c…` (only gitignored `.devnet` mutated).
Devnet unit suite 379/379. Anchor/Rust/SBF/tx-size re-verified by exact-SHA CI.

## Remaining campaign

107 chunks remain `PLANNED` (284 confirmed of 391). Next campaign windows
(284–288, 289–293) may follow only after this checkpoint's exact-SHA CI is green,
full inter-window cooldown elapses, and a fresh full preflight passes.
