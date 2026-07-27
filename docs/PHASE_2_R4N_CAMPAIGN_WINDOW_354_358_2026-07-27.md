# Phase 2 R4N Campaign — Window (chunks 354–358)

Window 2 of a bounded ≤3-window session (operator-approved expectation of 2
windows reached). Terminal-complete, reconciled, released, quiescent. No claim of
full upload, program finalization, deployment, or business flow.

## Between-window boundary satisfied (window 1 → window 2)

- window 1 (349–353) fully closed; all CONFIRMED; reconcile releaseReady, 0
  transitions; lease released; post-window suite 379/379; checkpoint
  `e6a3f471e21721057fca5766be19cfb53beab83d`; exact-SHA CI `30260741715` success;
  cooldown 915 s (≥ 900); fresh preflight passed; quiescence proven.

## Pre-window baseline (fresh, directly measured)

- HEAD = origin/main = remote = `e6a3f471e21721057fca5766be19cfb53beab83d`; `0/0`; clean.
- state SHA `5b3a4dbd38752088a1c0c093404a048f9ea01505a431c15218d2610eac18905d`;
  counts `354 CONFIRMED / 37 PLANNED / 0 SENT / 0 UNKNOWN`; contiguous CONFIRMED prefix 354.
- binary SHA `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`, length `395144`.
- on-chain buffer SHA `45f68d02f4ab9fac5710f24831c83ca6b4a0846db5c08904787e7200c9235b2d`,
  owner `BPFLoaderUpgradeab1e…`, allocation `395181`, status `BUFFER_WRITING`.
- fresh candidates `354,355,356,357,358`, all PLANNED, contiguous, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed vs current state)
  `7cf326feaca3f1eb10f6a407d8366efac4b69ddcaf8b16d4114007656a0118af`; max tx `1231` bytes (≤ 1232).
- authority balance `3246708680` lamports; funding `SUFFICIENT`.

## The one supervised uploader invocation

- outer execution ID `23b3449b-6895-48b2-b6dc-d0a5d026299c`;
  inner (lease) execution ID `9c423e38-00b9-4b29-9214-819c6ab6c831`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, childExitCode 0,
  runtimeElapsedMs 91919.
- selected 5 / attempted 5 / sent 5 / confirmed 5; every err = null.

### Full signatures (all confirmed)

| index | signature |
|------:|-----------|
| 354 | `cjUsXLJZgPVrxJATXozDBNayZ9nzGSDDs426jePXh6DgyanoSBRQMF1rR8vvAej1aM8PZjzWqRfmnXfm4TwzeVr` |
| 355 | `D3J5jp9eXmQR5kH2XuPxDTJ49Fgq7TL8n2Hn2y1RXVGxfymz9p7pdMnEG5DgpzuGcLNo5VvhNBmBySdtvxGgAW7` |
| 356 | `53MZt6fW2Qjao8vnGNio5ifGHiJzJxtc9j7Cj4QQE3JCuLZvFCSP8oqeGAZxyVcRt8UcJbsU6vxVZstYchuJgaZ1` |
| 357 | `53m2UsLMTKDLcdVquP78EzqoYDVoDKdFvngsJ15uvzKDAtQFpjnQ6uc2QbTHEADiefv5T9tEhvPq3B8YfyidvxPd` |
| 358 | `3vHuzUMYNxMBgs7mfK6W5AWxSyYr55Lo5BgpgR6rUHTrjyNZ7F1LdUBdFZbR617d1U4567qPRwUXZxztXTBPBA1U` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- request start gap 500 ms; confirmation poll 2000 ms; inter-chunk 3000 ms;
  request timeout 15000 ms; retries 0; rate-limit 0; send/confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`9c423e38…`) → releaseReady, 0 proposed transitions,
  `onchainWrite: false`, `stateMutation: false`, evidenceHash
  `16e929c8e5e7c4895bbc605c527bbf6e4e6ca2d32f1d649ee2e239049c27a13d`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false, `onchainWrite: false`.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.
- durable evidence root: `.devnet/upload-window-host-results/23b3449b-6895-48b2-b6dc-d0a5d026299c/`.

## Resulting state and buffer

- state counts `359 CONFIRMED / 32 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `4ab9598f8384b4b7a08e52723e4c585ad1037da9111d3b5d2d498c99ceb05b55`.
- on-chain buffer SHA `5ffc0b2a4508001a46ef4955f813ed4b7cde639adc735752f15662f5af4f1f16`
  (changed from `45f68d02…`); status `BUFFER_WRITING`.
- authority balance after `3246683680` lamports (Δ 25 000 = 5 × 5 000 base fee); funding `SUFFICIENT`.

## Validation

Code unchanged from CI-green baseline `e6a3f47…` (only gitignored `.devnet` mutated;
tracked tree clean). Post-window devnet unit suite 379/379. No recurrence of the
historical `378/1` anomaly (root cause remains UNPROVEN; disposition unchanged).

## Campaign summary (this session, two windows)

- windows: 349–353, 354–358. outer-host invocations 2; uploader invocations 2;
  transactions signed/sent/confirmed 10; all confirmed; `SENT = 0`, `UNKNOWN = 0`
  globally; two leases reconciled (0 transitions each) and released.
- Ceiling 3 windows; executed 2 (operator-approved expectation). A third window was
  evaluated as not warranted this session (see checkpoint discussion).

## Remaining campaign

32 chunks remain `PLANNED` (359 confirmed of 391) — 6 further full five-chunk
windows plus one final partial window of 2 chunks (32 = 6×5 + 2). Deploy/finalize
stays a separately authorized phase after all 391 chunks are independently proven CONFIRMED.
