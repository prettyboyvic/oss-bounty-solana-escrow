# Phase 2 R4N Campaign — Window (chunks 329–333)

Window 1 of a bounded ≤3-window campaign (planned 2). Terminal-complete,
reconciled, released, quiescent. No claim of full upload, program finalization,
deployment, or business flow. The historical `378/1` validation anomaly remains
non-material with root cause unknown/suspected (not proven); this session's
clean baseline suite re-ran 379/379 before any live write.

## Pre-window baseline (independently verified)

- HEAD = origin/main = remote = `a1d5d5212d2d1557abd3607e2a843b94291b6ebf`; `0/0`; clean.
- exact-SHA CI `30239160847`: success.
- pre-window state SHA `ab0d4e2390f5e91b67bedac75966e45ac56e3269640895aebadfdd495847cc6b`;
  counts `329 CONFIRMED / 62 PLANNED / 0 SENT / 0 UNKNOWN`.
- pre-window finalized buffer SHA `a054b9e17f29b1cfcc73012375d5412efa35d847813dd12d2eae9d4a3ea42368`,
  owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- fresh candidates `329,330,331,332,333`, all PLANNED, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed vs current state)
  `122138a7541c410c4385cd7f9c63803301c8c7d5e21a5ed590bf6d65e3d80b43`; max tx `1231` bytes (≤ 1232).
- authority balance `3246833680` lamports; cooldown 1623 s (≥ 900).

## The one supervised uploader invocation

- outer execution ID `09147142-0a56-4a0e-a5d2-137c9619bb26`;
  inner execution ID `888dab83-a22d-4b94-87d1-9a410c5dfb9d`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, `WINDOW_LIMIT`.
- selected 5 / attempted 5 / sent 5 / confirmed 5 / finalized 5.

### Signatures (all `finalized`, err = null)

| index | signature |
|------:|-----------|
| 329 | `4UKLELhHRiNKQkh2Liwm5B2LHgJeq74W43FU9XgVPHg2jBS92udKkQeZACojUyTpSAyczySbysCji8gvieWJnp7T` |
| 330 | `62nnsf8Ed8boGLJLFWCgU89p2n6xcygH5LhTPSw2A6M2vzztRww7V2NEccFHmpnyKM9pT1SS4C1jVx4fpULeAXm6` |
| 331 | `3XB83E19zSAHNEThmrStV7kjq8aXySF4cwPUJwyycLoBMFn9je5cyBjJ9HJvJxZisw3WjffgqjJdUneXmfmK6oRu` |
| 332 | `39k71Py11xTmE1AfV47efxV8upDZy3aUtRkhmDUEfQ9NYuAwWPsYcjFuZ3UGbQvNrKk9zZGajw6dcuuzQiMdh6Gr` |
| 333 | `zvjmnFxemJr7XhrtoHXxwN4ZV5c9MQXoUpkfkek3HZaTAiV7ELWiT6t9uCJFTdEpY84SKXhhxwDrEn17WfJEL27` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- min RPC start gap 500 ms; confirmation poll 2000 ms; pre-sign/inter-chunk 3000 ms;
  retries 0; rate-limit 0; send errors 0; confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`888dab83…`) → `SAFE_TO_RELEASE`, releaseReady,
  0 proposed transitions, `onchainWrite: false`, evidenceHash
  `dbb2b4b06f493f6631a9644211f426ec7c4c4b450fe9ac81c6b39b448249564e`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false, `onchainWrite: false`.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.

## Resulting state and finalized buffer

- state counts `334 CONFIRMED / 57 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `184c8d97a61dcffe0623acf0e48535852088a9adb6d8b06cbf132fe5dbd19023`.
- finalized buffer SHA `73f14ff3dc36e30d9b26b0b2e5259c3d9a91d242e38059b79397d5a53a01b9b8`
  (changed from `a054b9e1…`); owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.

## Validation

Code unchanged from CI-green baseline `a1d5d52…` (only gitignored `.devnet` mutated).
Post-window devnet unit suite 379/379. Anchor/Rust/SBF/tx-size re-verified by exact-SHA CI.

## Remaining campaign

57 chunks remain `PLANNED` (334 confirmed of 391). One more planned window
(334–338) may follow after this checkpoint's exact-SHA CI is green, cooldown
elapses, a post-window local validation passes, and a fresh preflight passes.
