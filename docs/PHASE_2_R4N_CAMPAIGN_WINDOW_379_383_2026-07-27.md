# Phase 2 R4N Campaign — Window (chunks 379–383)

Window 2 of a bounded ≤3-window session (operator-preferred plan of 3 full
windows). Terminal-complete, reconciled, released, quiescent. No claim of full
upload, program finalization, deployment, or business flow.

## Between-window boundary satisfied (window 1 → window 2)

- window 1 (374–378) fully closed; all CONFIRMED; reconcile releaseReady, 0
  transitions; lease released; post-window suite 379/379; checkpoint
  `a03b9038ef9869757aa77bc2a8a033008d5d2e2e`; exact-SHA CI `30279765567` success;
  cooldown 922 s (≥ 900); fresh preflight passed; quiescence proven.

## Pre-window baseline (fresh, directly measured)

- HEAD = origin/main = remote = `a03b9038ef9869757aa77bc2a8a033008d5d2e2e`; `0/0`; clean.
- state SHA `b19f3a252f14029149eaa0e822f9e6b4227a7ba8035c629e21650324a0e28124`;
  counts `379 CONFIRMED / 12 PLANNED / 0 SENT / 0 UNKNOWN`; contiguous CONFIRMED prefix 379.
- binary SHA `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`, length `395144`.
- on-chain buffer SHA `9a0d1fc2371cc4de21941c2399bded73e6d5514f7b1807700b14f95687a5d63f`,
  owner `BPFLoaderUpgradeab1e…`, allocation `395181`, status `BUFFER_WRITING`.
- fresh candidates `379,380,381,382,383`, all PLANNED, contiguous, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed)
  `200fb7d9f31a971c5d12222a1f1ced892270fbd88bbd5f30a7351a9bc464d87c`; max tx `1231` bytes (≤ 1232).
- authority balance `3246583680` lamports; funding `SUFFICIENT`.

## The one supervised uploader invocation

- outer execution ID `f2b58796-f3d2-4ffe-a5c9-7d90fc2afc31`;
  inner (lease) execution ID `d6a3ee6a-7758-458f-b7fa-9787b81cf249`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, childExitCode 0,
  runtimeElapsedMs 91401.
- selected 5 / attempted 5 / sent 5 / confirmed 5; every err = null.

### Full signatures (all confirmed)

| index | signature |
|------:|-----------|
| 379 | `1orrggW87Gzcus4JJQCF8ZQJmt21P5jZpE5nmzURUsksn3i1YKFob6jq7RpBSjGgLVndtADkfkbn8bnWhxE8SHQ` |
| 380 | `4GQYySMNoJHtdW4UaZw73uPZkN8Vdd7grRTieNPWw4hJWJ1ko2CqHuFWEsjhDznNRaS575iAcjCggDphDsqsEZyi` |
| 381 | `4ciEzQ5CC3qe6XvmoTq9gnnyUxXHog4qdvetKiUfHgNmx1tFewyssoqf5iTYpAJUZCc81xMQzsW1PHf5B4YhrSAv` |
| 382 | `2kUKiswGNekm3eUZ9UJHgbQ4kpoxHiFYt6nTjBDhvK8wH3N1q8BEiFNexMaJUVNhHegHQSjNiULhrWq1Am15auNH` |
| 383 | `3o7TrUSJz74Ye3UeBRxXu19TKw8oYFTJuT9hz62ZJ9nEAaauA7yEgmuewojU9fLJ55tcZir3oisiFPD2FUWEwoeG` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- request start gap 500 ms; confirmation poll 2000 ms; inter-chunk 3000 ms;
  request timeout 15000 ms; retries 0; rate-limit 0; send/confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`d6a3ee6a…`) → releaseReady, 0 proposed transitions,
  `onchainWrite: false`, evidenceHash
  `d8ad6d3597e83dfca5dacea4add0480370077eb514f470cfb5a3d3303cced691`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.
- durable evidence root: `.devnet/upload-window-host-results/f2b58796-f3d2-4ffe-a5c9-7d90fc2afc31/`.

## Resulting state and buffer

- state counts `384 CONFIRMED / 7 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `46128df35da278f62f44b4d0700ba59be9eeed311ab8368ddfa4e963d4b1afdb`.
- on-chain buffer SHA `8f7e65584b9394fc9ae3f9613e26dfe6725d9d90f16b06ce433dd230fcfd7b68`
  (changed from `9a0d1fc2…`); status `BUFFER_WRITING`.
- authority balance after `3246558680` lamports (Δ 25 000 = 5 × 5 000 base fee); funding `SUFFICIENT`.

## Validation

Code unchanged from CI-green baseline `a03b9038…` (only gitignored `.devnet` mutated;
tracked tree clean). Post-window devnet unit suite 379/379. No recurrence of the
historical `378/1` anomaly (root cause remains UNPROVEN; disposition unchanged).

## Remaining campaign

7 chunks remain `PLANNED` (384 confirmed of 391). Deploy/finalize stays a
separately authorized phase after all 391 chunks are independently proven CONFIRMED.
