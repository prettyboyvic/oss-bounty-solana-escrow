# Phase 2 R4N Campaign — Window (chunks 384–388)

Window 3 (final full window) of a bounded ≤3-window session; operator-preferred
plan of 3 full windows reached and ceiling consumed. Terminal-complete,
reconciled, released, quiescent. No claim of full upload, program finalization,
deployment, or business flow. Only the final partial window `389–390` now remains,
reserved for a separately authorized campaign.

## Between-window boundary satisfied (window 2 → window 3)

- window 2 (379–383) fully closed; all CONFIRMED; reconcile releaseReady, 0
  transitions; lease released; post-window suite 379/379; checkpoint
  `589485be95f738c7abe01dfd0ebc6e0d61467287`; exact-SHA CI `30281139809` success;
  cooldown 920 s (≥ 900); fresh preflight passed; quiescence proven.

## Pre-window baseline (fresh, directly measured)

- HEAD = origin/main = remote = `589485be95f738c7abe01dfd0ebc6e0d61467287`; `0/0`; clean.
- state SHA `46128df35da278f62f44b4d0700ba59be9eeed311ab8368ddfa4e963d4b1afdb`;
  counts `384 CONFIRMED / 7 PLANNED / 0 SENT / 0 UNKNOWN`; contiguous CONFIRMED prefix 384.
- binary SHA `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`, length `395144`.
- on-chain buffer SHA `8f7e65584b9394fc9ae3f9613e26dfe6725d9d90f16b06ce433dd230fcfd7b68`,
  owner `BPFLoaderUpgradeab1e…`, allocation `395181`, status `BUFFER_WRITING`.
- fresh candidates `384,385,386,387,388`, all PLANNED, contiguous, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed)
  `dd08835041de6548338d04396146c285f879a478f946fda1e61857d1e6477abe`; max tx `1231` bytes (≤ 1232).
- authority balance `3246558680` lamports; funding `SUFFICIENT`.

## The one supervised uploader invocation

- outer execution ID `c7f6b8bf-1c48-44a2-91fc-abc13b6a7da8`;
  inner (lease) execution ID `176494b9-8eda-4356-b24e-8ba384eceef5`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, childExitCode 0,
  runtimeElapsedMs 91132.
- selected 5 / attempted 5 / sent 5 / confirmed 5; every err = null.

### Full signatures (all confirmed)

| index | signature |
|------:|-----------|
| 384 | `4WHXVQZiEu3jSqtYY2VWbEj2KQLquKEmBk8xHCbb4qCbKghvG1S33Sts1AJ6iG9eBqiHB6CaG3VoG98PWNy6kaRd` |
| 385 | `3ULCMnAgD6XgnQAZDiyMPRs1LZwAWfX6JGfKhnbQrvAsZgaZP5sZzXm6W1Cv3DdFTT15iU7R8LymNZQymPYCmPis` |
| 386 | `247i4wrQenqS2JHgR1DkqnmzvF4Rkk67YKP4FwMPuSa64hedRX8q7QRyaCMYvzAtAiA3ozZho2WmurHYsT9zBWiD` |
| 387 | `29azA6ARk6kNuqbDMEJ2godTPaBmLjzAs6sBXzrjFGCdDcfkzuma6t2BjZdD7q7sX2jwt3sKJDEGmLfNA7x588iE` |
| 388 | `3M9exHTp6HTi8fzoZjiYqM8sEjYPKxaAyAoh4EMy1krBJwg8FZU6NMQCdDAPWdLyy87CT5cNV9tpRb3iW9Z1g26k` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- request start gap 500 ms; confirmation poll 2000 ms; inter-chunk 3000 ms;
  request timeout 15000 ms; retries 0; rate-limit 0; send/confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`176494b9…`) → releaseReady, 0 proposed transitions,
  `onchainWrite: false`, evidenceHash
  `d5fc765266daf773b7037d3d2459e9bb83e9949654ba5dfb1a3fb8c499882e2f`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.
- durable evidence root: `.devnet/upload-window-host-results/c7f6b8bf-1c48-44a2-91fc-abc13b6a7da8/`.

## Resulting state and buffer

- state counts `389 CONFIRMED / 2 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `1308c37115b4c2d6a13d60d100c717aa63d6d1047b6c4a529b753fd2ca989647`.
- on-chain buffer SHA `d34564573c4da4838ef854884da073aa45db6546a2ea4636d159dccf07f31060`
  (changed from `8f7e6558…`); status `BUFFER_WRITING`.
- authority balance after `3246533680` lamports (Δ 25 000 = 5 × 5 000 base fee); funding `SUFFICIENT`.

## Validation

Code unchanged from CI-green baseline `589485be…` (only gitignored `.devnet` mutated;
tracked tree clean). Post-window devnet unit suite 379/379. No recurrence of the
historical `378/1` anomaly (root cause remains UNPROVEN; disposition unchanged).

## Campaign summary (this session, three full windows)

- windows: 374–378, 379–383, 384–388. outer-host invocations 3; uploader invocations 3;
  transactions signed/sent/confirmed 15; all confirmed; `SENT = 0`, `UNKNOWN = 0`
  globally; three leases reconciled (0 transitions each) and released.
- Ceiling 3 windows; executed 3 (operator-preferred plan). Ceiling now consumed.
- Chunk 378 uploaded in window 1; the historical `378/1` anomaly did not recur.

## Remaining campaign

2 chunks remain `PLANNED` (389 confirmed of 391) — the final partial window
`389–390`, reserved for a separately authorized campaign. Deploy/finalize stays a
separately authorized phase after all 391 chunks are independently proven CONFIRMED.
