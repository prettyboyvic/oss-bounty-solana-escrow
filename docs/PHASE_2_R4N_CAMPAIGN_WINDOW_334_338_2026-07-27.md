# Phase 2 R4N Campaign — Window (chunks 334–338)

Window 2 (final) of the bounded ≤3-window campaign; planned target of 2 windows
reached. Terminal-complete, reconciled, released, quiescent. No claim of full
upload, program finalization, deployment, or business flow.

## Between-window boundary satisfied (window 1 → window 2)

- window 1 (329–333) fully closed; all finalized; reconcile `SAFE_TO_RELEASE`;
  lease released; post-window unit suite 379/379; checkpoint
  `7b3ba5c23965910c68f945bc1ea4207e811e3655`; exact-SHA CI `30240613383` success;
  cooldown 910 s (≥ 900); fresh preflight passed.

## Pre-window baseline (fresh)

- HEAD = origin/main = remote = `7b3ba5c23965910c68f945bc1ea4207e811e3655`; `0/0`; clean.
- state SHA `184c8d97a61dcffe0623acf0e48535852088a9adb6d8b06cbf132fe5dbd19023`;
  counts `334 CONFIRMED / 57 PLANNED / 0 SENT / 0 UNKNOWN`.
- finalized buffer SHA `73f14ff3dc36e30d9b26b0b2e5259c3d9a91d242e38059b79397d5a53a01b9b8`,
  owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- fresh candidates `334,335,336,337,338`, all PLANNED, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed vs current state)
  `59ed4361e7a7b95c4229135ddd8263f8094964d641efa6e18157b7c7f1c0bbb5`; max tx `1231` bytes (≤ 1232).
- authority balance `3246808680` lamports.

## The one supervised uploader invocation

- outer execution ID `cad7a9ce-e657-4f4b-9dc4-0d36298d8ae8`;
  inner execution ID `e1d59b51-b5cf-45cd-b0c0-9e8bc621aa3b`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, `WINDOW_LIMIT`.
- selected 5 / attempted 5 / sent 5 / confirmed 5 / finalized 5.

### Signatures (all `finalized`, err = null)

| index | signature |
|------:|-----------|
| 334 | `29rrYjFqdMjeZuTYSQrGSwvNfn5jDY8zr23aM7L8B9GVUSAHWMvt15VTpPVUCVUYadJwi4y8qrjqCLumszypj3cB` |
| 335 | `5VH1jNa8v8B5yF8acPcybarT6X4GZRimV8iFfjJGWobd4Ck2BkTLJUCftu6feZeYnRW851RdGBy6fCQipQf7oQ2A` |
| 336 | `2kuB1EFu9Gyr1o5azCY8ebHL9mgFT5CTnSq9B6ZY2PzegM7FLtbRcyH6t3uYryhTgTNKiZuagCd3BLvu11oNkjiB` |
| 337 | `2bqvEL3SYJUf4nRA1cKPr6NokXp5rLqmoMKJGXVGZLN3NStiDzhWXMSYVsRrCvawgRQwUdygQU9ZsBdVDhf2VE14` |
| 338 | `4g61v2qCWpcPnhCeLZbNob5ftFi4Q4wraHQN64m9yKtNXMKgVvKYbbLgjch7ReK1ZPDWzAhcjYiypetK2ohBMEim` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- min RPC start gap 500 ms; confirmation poll 2000 ms; pre-sign/inter-chunk 3000 ms;
  retries 0; rate-limit 0; send errors 0; confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`e1d59b51…`) → `SAFE_TO_RELEASE`, releaseReady,
  0 proposed transitions, `onchainWrite: false`, evidenceHash
  `bb74c218401c313e2b15f33c4de8735a15857ee9e7d8eec83167679fea69667f`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false, `onchainWrite: false`.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.

## Resulting state and finalized buffer

- state counts `339 CONFIRMED / 52 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `15b01e848537d2976596bcf31556f3d3aaed9ecd183f6047924a4bbc9a7a28c5`.
- finalized buffer SHA `52b6f3b3745a5d7248460dd5f3c7a1e31f27859732aed7668f0bfc39ae1c4ee2`
  (changed from `73f14ff3…`); owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- authority balance after `3246783680` lamports.

## Validation

Code unchanged from CI-green baseline `7b3ba5c…` (only gitignored `.devnet` mutated).
Post-window devnet unit suite 379/379. Anchor/Rust/SBF/tx-size re-verified by exact-SHA CI.

## Campaign summary (this session, two windows)

- windows: 329–333, 334–338. outer-host invocations 2; uploader invocations 2;
  transactions signed/sent 10; all finalized; `SENT = 0`, `UNKNOWN = 0` globally;
  two leases released.
- Historical `378/1` validation anomaly remained non-material (root cause
  unproven); clean baseline suite 379/379 before any live write; post-window
  suites 379/379. No third window (planned 2; ceiling 3). Historical incident
  evidence unchanged.

## Remaining campaign

52 chunks remain `PLANNED` (339 confirmed of 391) — 10 further full five-chunk
windows plus one final partial window of 2 chunks (52 = 10×5 + 2). A separately
authorized next batch may continue under the same per-window boundary.
