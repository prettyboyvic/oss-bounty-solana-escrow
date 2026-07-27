# Phase 2 R4N Campaign — Window (chunks 359–363)

Window 1 of a bounded ≤3-window session (operator-preferred plan of 3 windows).
Terminal-complete, reconciled, released, quiescent. No claim of full upload,
program finalization, deployment, or business flow.

## Pre-window baseline (independently verified, directly measured)

- HEAD = origin/main = remote = `741da4894cb4c32fbcefb9db02f423594ee85c55`; `0/0`; clean; no git op locks.
- state SHA `4ab9598f8384b4b7a08e52723e4c585ad1037da9111d3b5d2d498c99ceb05b55`;
  counts `359 CONFIRMED / 32 PLANNED / 0 SENT / 0 UNKNOWN`; contiguous CONFIRMED prefix 359.
- binary SHA `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`, length `395144`.
- on-chain buffer SHA `5ffc0b2a4508001a46ef4955f813ed4b7cde639adc735752f15662f5af4f1f16`,
  owner `BPFLoaderUpgradeab1e…`, allocation `395181`, status `BUFFER_WRITING`.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- fresh candidates `359,360,361,362,363`, all PLANNED, contiguous, null signatures.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed)
  `0742b3eed9d27b8d1fccfd16c3a22bfeb5a9fe54e910628e93f4a7cc7f061f3e`; max tx `1231` bytes (≤ 1232).
- authority balance `3246683680` lamports; headroom `243805920`; funding `SUFFICIENT`.
- Exact-SHA CI run `30261836366` (headSha `741da48…`) = `success` (verified via GitHub API).
- Cooldown from prior session ~46 min (≥ 900 s). Baseline devnet unit suite 379/379.
- Prior two checkpoints (349–353, 354–358) each carry 5 durable full signatures.

## The one supervised uploader invocation

- outer execution ID `5e601a92-77c9-4777-963d-36399a6870a1`;
  inner (lease) execution ID `315e0c0a-226a-47c6-bb15-061218420cdc`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, childExitCode 0,
  runtimeElapsedMs 90462.
- selected 5 / attempted 5 / sent 5 / confirmed 5; every err = null.

### Full signatures (all confirmed)

| index | signature |
|------:|-----------|
| 359 | `5MwtQu6erRC4wKJkx8P4fzzHJed3tQ5TLYG2ww2Q38LbDUgJ5KrBzy42pGyWvCigiL1e4N62X7ZYN7n4Vqbg9UwK` |
| 360 | `2pHKwPMbiYD9yddgL4wHEKR8vat7i7cgX6bwhtkba7SWJkWoa55hLhnMq7R6bBtNgGFaF7K8Ev28HSbUscY1veVN` |
| 361 | `3MCY5MmdFVB4FfDLSYcqSoRYsMm8uXcUUEMkpc34yZkNwrXH1hkukJAeVjgaSQQijERcC1gXusMaAJCtzPSVot2M` |
| 362 | `5juscZJB5PX5gWiaN9EmE88L5vVwQk8RCChqQvEk4azVmvdEQEmxMLLQyh3xQXECzNfooj8znDYoDegEjWtAWbgu` |
| 363 | `5PGkTKdeMRsJgjt3yJQrb777m4DJ96crqAQAJLSNeRtfCMUDdPcwmG3uZbGwHrD9i5zhsqD58XiwqCjpsXNeMQWf` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- request start gap 500 ms; confirmation poll 2000 ms; inter-chunk 3000 ms;
  request timeout 15000 ms; retries 0; rate-limit 0; send/confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`315e0c0a…`) → releaseReady, 0 proposed transitions,
  `onchainWrite: false`, `stateMutation: false`, evidenceHash
  `564d07b9d35a772108b8b2a3386e545f58bc3c5dfd73c4a7fafd674481d99646`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.
- durable evidence root: `.devnet/upload-window-host-results/5e601a92-77c9-4777-963d-36399a6870a1/`.

## Resulting state and buffer

- state counts `364 CONFIRMED / 27 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `ff6156a482fff7e6d6f001d0d9e3cbb20a935a4d188cbefe5581db7b9b51eb03`.
- on-chain buffer SHA `cd0d0cb908cd491ee3c55d9a8fc4f5e9a1c7e1e0c415dcba2170277a1075fca4`
  (changed from `5ffc0b2a…`); status `BUFFER_WRITING`.
- authority balance after `3246658680` lamports (Δ 25 000 = 5 × 5 000 base fee); funding `SUFFICIENT`.

## Validation

Code unchanged from CI-green baseline `741da48…` (only gitignored `.devnet` mutated;
tracked tree clean). Post-window devnet unit suite 379/379. No recurrence of the
historical `378/1` anomaly (root cause remains UNPROVEN; disposition unchanged).

## Remaining campaign

27 chunks remain `PLANNED` (364 confirmed of 391). Deploy/finalize stays a
separately authorized phase after all 391 chunks are independently proven CONFIRMED.
