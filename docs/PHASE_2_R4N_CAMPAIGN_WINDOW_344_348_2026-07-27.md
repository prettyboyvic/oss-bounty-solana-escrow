# Phase 2 R4N Campaign — Window (chunks 344–348)

Window 2 (final) of a bounded ≤3-window session; operator-approved target of 2
windows reached. Terminal-complete, reconciled, released, quiescent. No claim of
full upload, program finalization, deployment, or business flow.

## Between-window boundary satisfied (window 1 → window 2)

- window 1 (339–343) fully closed; all CONFIRMED; reconcile releaseReady with 0
  transitions; lease released; post-window unit suite 379/379; checkpoint
  `c7bad39efd254ce3388c922dc5f9df4a79842c1d`; exact-SHA CI `30257418855` success;
  cooldown ≥ 900 s; fresh preflight passed; quiescence proven.

## Pre-window baseline (fresh)

- HEAD = origin/main = remote = `c7bad39efd254ce3388c922dc5f9df4a79842c1d`; `0/0`; clean.
- state SHA `30fad9faf0fe2687ab0287a8718febae956fcb0be74bd8c27879fa5ddcd212fd`;
  counts `344 CONFIRMED / 47 PLANNED / 0 SENT / 0 UNKNOWN`; contiguous CONFIRMED prefix 344.
- binary SHA `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`, length `395144`.
- on-chain buffer SHA `9ca3013b1d9942a3046386195145b7775fef0147d73c65cd2097fb3e4237b1b5`,
  owner `BPFLoaderUpgradeab1e…`, status `BUFFER_WRITING`.
- fresh candidates `344,345,346,347,348`, all PLANNED, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed vs current state)
  `a118210821eb7dd37b241a18de84b2776757777f2f83eed1f5dfa4f70b767462`; max tx `1231` bytes (≤ 1232).
- authority balance `3246758680` lamports; funding `SUFFICIENT`.

## The one supervised uploader invocation

- outer execution ID `5503eabf-8e5d-48e7-a4d7-750d1e933aab`;
  inner (lease) execution ID `1be15780-9470-42ca-bb36-29c8898be529`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, childExitCode 0,
  runtimeElapsedMs 91580.
- selected 5 / attempted 5 / sent 5 / confirmed 5.

### Signatures (all confirmed)

| index | signature |
|------:|-----------|
| 344 | `4Vo1f2gryK6K…` |
| 345 | `35H6YQW6mdPG…` |
| 346 | `4kyT9vRV3NdG…` |
| 347 | `HhUwUHW3H6EU…` |
| 348 | `3xbSv5kH5wDb…` |

### Telemetry

- `SEND_RAW_TRANSACTION` 5; RPC all `SUCCESS` (0 rate-limited, 0 timeout, 0 error).
- request start gap 500 ms; confirmation poll 2000 ms; inter-chunk 3000 ms;
  request timeout 15000 ms; retries 0; rate-limit 0; send/confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`1be15780…`) → releaseReady, 0 proposed transitions,
  `onchainWrite: false`, `stateMutation: false`, evidenceHash
  `6d429da8c96d1b7c762909cb030dd159b0fc1c32388043b87a34189e60a7bb25`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false, `onchainWrite: false`.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.

## Resulting state and buffer

- state counts `349 CONFIRMED / 42 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `89c655d4e39e77a73bfc53c5bdfd413abbe30272593bfd7ecc32670dfed50c3a`.
- on-chain buffer SHA `c64f14ee1ac05d794805409fb3b2c45d69def35d708cfab6a60601cd3e51e320`
  (changed from `9ca3013b…`); status `BUFFER_WRITING`.
- authority balance after `3246733680` lamports (Δ 25 000 = 5 × 5 000 base fee);
  funding `SUFFICIENT`.

## Validation

Code unchanged from CI-green baseline `c7bad39…` (only gitignored `.devnet` mutated;
tracked tree clean). Post-window devnet unit suite 379/379. No recurrence of the
historical `378/1` anomaly (root cause remains UNPROVEN; disposition unchanged).

## Campaign summary (this session, two windows)

- windows: 339–343, 344–348. outer-host invocations 2; uploader invocations 2;
  transactions signed/sent/confirmed 10; all confirmed; `SENT = 0`, `UNKNOWN = 0`
  globally; two leases reconciled (0 transitions each) and released.
- Ceiling 3 windows; executed 2 (operator-approved target). No third window.

## Remaining campaign

42 chunks remain `PLANNED` (349 confirmed of 391) — 8 further full five-chunk
windows plus one final partial window of 2 chunks (42 = 8×5 + 2). Deploy/finalize
stays a separately authorized phase after all 391 chunks are independently proven CONFIRMED.
