# Phase 2 R4N Campaign — Window (chunks 309–313)

Window 1 of a bounded ≤3-window campaign (planned 2), authorized after an
independent disposition of the prior session's `378/1` local validation anomaly
(`VALIDATION_STABLE_TWO_WINDOW_APPROVED`). Terminal-complete, reconciled,
released, quiescent. No claim of full upload, program finalization, deployment,
or business flow.

## Validation-anomaly disposition (pre-campaign)

- Original failing test from the prior session: **unrecoverable** (node `--test`
  persists no output; CI passed so no artifact; no `.tap`/junit logs).
- Harness inspection: 20 test files use `mkdtempSync` isolation; no test reads
  the live `.devnet/state.json`; scheduler timing tests use injected `fakeTime()`.
- Protocol: 8 isolated serial-not-overlapping runs of `node --test tests/devnet/*.test.mjs`
  — 5 in the authoritative parallel (CI) mode, 3 with `--test-concurrency=1` —
  all `379/379`, exit 0, no `✖`; logs retained under scratchpad `valrun/`.
- Anomaly did **not** reproduce. Root cause: **suspected** transient process-spawn
  timing jitter under parallel CPU contention; **not proven**. Judged non-material
  on repeated isolated validation + green exact-SHA CI (`30234875654` and all
  prior checkpoints) + test isolation + clean environment (0 orphan processes,
  live state SHA unchanged).

## Pre-window baseline (independently verified)

- HEAD = origin/main = remote = `f4768daf801e33440bd6fd88462a99a8af62e748`; `0/0`; clean.
- exact-SHA CI `30234875654`: success.
- pre-window state SHA `5aa4e8bd725a6e089b0889cf181112c5133b50efff241af0e64f4cc2797a9376`;
  counts `309 CONFIRMED / 82 PLANNED / 0 SENT / 0 UNKNOWN`.
- pre-window finalized buffer SHA `1f0970e54b9e35aa1d804e150ff713647f7ae31386bf0bcb5088b646243a0386`,
  owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- fresh candidates `309,310,311,312,313`, all PLANNED, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed vs current state)
  `2f744f345ffc9008c8cbdcf126c0e5f2a71b47a4d9e240cba1ddcf67564da08a`; max tx `1231` bytes (≤ 1232).
- authority balance `3246933680` lamports; cooldown 1041 s (≥ 900).

## The one supervised uploader invocation

- outer execution ID `d1d1e6b9-db1d-4a9e-b22d-dbe258d438f7`;
  inner execution ID `1aacd786-3736-4ce8-b104-441cd23d1af8`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, `WINDOW_LIMIT`.
- selected 5 / attempted 5 / sent 5 / confirmed 5 / finalized 5.

### Signatures (all `finalized`, err = null)

| index | signature |
|------:|-----------|
| 309 | `331VwQds637Fv2gjqxe2B4EbshVKy5MnpaaTEFJ6GxjHR3J5FkriHA5ygyqQLeXt8eTQKzSsbofR3hPVqZNsKP9N` |
| 310 | `3eDhvwNM8vgwqJ265Wa7LoSgyBn6YXMURdKjvUbXnQqKQwPetWBx8vWQB4CByv1ue8JmMvobSHiUDuR3m321imZJ` |
| 311 | `4X6xEstPeKPZSdfYG3xoMf73n1FzP44JcZSLSoqWiphvmH2B9v9ujrDWBZQBZXn5sRqnfh6JpZjbGZuB1Cbqysw9` |
| 312 | `icMepq7iNaMmudwqy35pGFRChh4qb4jhQeasEs6WBvJjuAW3dEzLrUzGtnSnNKxucgCikUr9iPAxBucHVGAFDn4` |
| 313 | `642YBAUYXzsesJpMoygScN6uouMCB71GDAmxmVRUkQjU6gT6K5bA5EWxCa2ipAX6LZZUkMJLzF6HexMPepagMeLR` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- min RPC start gap 500 ms; confirmation poll 2000 ms; pre-sign/inter-chunk 3000 ms;
  retries 0; rate-limit 0; send errors 0; confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`1aacd786…`) → `SAFE_TO_RELEASE`, releaseReady,
  0 proposed transitions, `onchainWrite: false`, evidenceHash
  `f89d364ab7ebb7585ce447cfd02410c85eb39845c6f1a3c8500e35e96620a621`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false, `onchainWrite: false`.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.

## Resulting state and finalized buffer

- state counts `314 CONFIRMED / 77 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `7cc0c16a2bcd315d218d36c4794af48481cd079dcc66464f3190ae161cc8aed5`.
- finalized buffer SHA `d2a103fc263f94a6f12d0d9985d49a92fdc10de4014ed36c59dcb155af099cf8`
  (changed from `1f0970e5…`); owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.

## Validation

Code unchanged from CI-green baseline `f4768da…` (only gitignored `.devnet` mutated).
Post-window devnet unit suite 379/379. Anchor/Rust/SBF/tx-size re-verified by exact-SHA CI.

## Remaining campaign

77 chunks remain `PLANNED` (314 confirmed of 391). One more planned window
(314–318) may follow after this checkpoint's exact-SHA CI is green, cooldown
elapses, a post-window local validation passes, and a fresh preflight passes.
