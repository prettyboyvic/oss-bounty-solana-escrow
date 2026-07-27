# Phase 2 R4N Campaign — Window (chunks 284–288)

Window 2 of the bounded ≤5-window campaign (planned 3). Terminal-complete,
reconciled, released, quiescent. No claim of full upload, program finalization,
deployment, or business flow.

## Between-window boundary satisfied (window 1 → window 2)

- window 1 (279–283) fully closed; all finalized; reconcile `SAFE_TO_RELEASE`;
  lease released; checkpoint `9bd96e1c72e1433a9c0a44559d312874079e50ef`;
  exact-SHA CI `30230540285` success; cooldown 922 s (≥ 900); fresh preflight passed.

## Pre-window baseline (fresh)

- HEAD = origin/main = remote = `9bd96e1c72e1433a9c0a44559d312874079e50ef`; `0/0`; clean.
- state SHA `72c110c94c9ac55afbe6ca686bc07b87dd2d299a06f390af5efc913e22fbaf69`;
  counts `284 CONFIRMED / 107 PLANNED / 0 SENT / 0 UNKNOWN`.
- finalized buffer SHA `7f321b035ed1a7328233aec45e9f6771a1d22dfda3cc58d048418c9a8b12b172`,
  owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- fresh candidates `284,285,286,287,288`, all PLANNED, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed vs current state)
  `e3a3e3fada7c188f0f92ba419e87ee993bbfed6d4b61810a79701b84f0e9a6e4`; max
  serialized transaction size `1231` bytes (≤ 1232).
- authority balance `3247058680` lamports.

## The one supervised uploader invocation

- outer execution ID `82b4bb06-32c7-4384-862a-37faf4d53deb`;
  inner execution ID `dc3116f2-6b98-44fe-b5cc-5c99b7203afd`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, `WINDOW_LIMIT`.
- selected 5 / attempted 5 / finalized 5.

### Signatures (all `finalized`, err = null)

| index | signature |
|------:|-----------|
| 284 | `4ecoeLNNySBC9zmn69g3EZALCeg8F6v4VcoDQotyy6Dd9vYQyE614TWGznsVLQ2fpLnQWCvjTGtTrjoUbRqVxQsS` |
| 285 | `2JTxGdjr6dbVMd2esJ57bGmk6SP7FBPVgUFdi9taPYsLqdygtUGb9TKkmkQCm77FZCTQ8ZvTD1aVH2miiJkZxZ6j` |
| 286 | `497nvSogU3JTwVuNVdG4ZNWvdHg8r16qnwjxrdSSqvsVxmWzuAxuxuxCJTfU5WC4tyKBQe65PekuCfKxf9SxwPG4` |
| 287 | `4rn99yoEA4AoXfXQR6g7wFBduJQBFoH7EM4wrsxbd37EoRR7HwwMLKPa6RQANeP5iTBXtg7foc7S9wCtKQcjd9PD` |
| 288 | `2Gr473hWNb2vQZkajVudktzwu7K2JJ8jKjHoVJ88W1ApNrvi1Yx8UpNbg3JnbNaneNaP2V2SLgHwBCR9hK9QmVdd` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- min RPC start gap 500 ms; confirmation poll 2000 ms; pre-sign/inter-chunk 3000 ms;
  retries 0; rate-limit 0; send errors 0; confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`dc3116f2…`) → `SAFE_TO_RELEASE`, releaseReady,
  0 transitions, `onchainWrite: false`, evidenceHash
  `11d76933bab456f08c912fac62c919333050ad27efd89477724ef8c1e2931783`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false, `onchainWrite: false`.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.

## Resulting state and finalized buffer

- state counts `289 CONFIRMED / 102 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `f0b8cfc4d9bf7ba6b3e194d9189a43d8db58afe3e8e4c4710dca7ccb51dd8d7f`.
- finalized buffer SHA `f5129d66e4ce31507ead5ae9a2eacef5102d6323a2ee02e1703a83c8e2266467`
  (changed from `7f321b03…`); owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.

## Validation

Code unchanged from CI-green baseline `9bd96e1…` (only gitignored `.devnet` mutated).
Devnet unit suite 379/379. Anchor/Rust/SBF/tx-size re-verified by exact-SHA CI.

## Remaining campaign

102 chunks remain `PLANNED` (289 confirmed of 391). One more planned window
(289–293) may follow after this checkpoint's exact-SHA CI is green, cooldown
elapses, and a fresh preflight passes.
