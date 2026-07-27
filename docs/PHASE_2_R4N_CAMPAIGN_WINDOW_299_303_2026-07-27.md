# Phase 2 R4N Campaign — Window (chunks 299–303)

Window 2 of the bounded ≤4-window campaign (planned 3). Terminal-complete,
reconciled, released, quiescent. No claim of full upload, program finalization,
deployment, or business flow.

## Between-window boundary satisfied (window 1 → window 2)

- window 1 (294–298) fully closed; all finalized; reconcile `SAFE_TO_RELEASE`;
  lease released; checkpoint `0f947c2614d585b0e7a448921b6ac537b7f1efa7`;
  exact-SHA CI `30233521586` success; cooldown 913 s (≥ 900); fresh preflight passed.

## Pre-window baseline (fresh)

- HEAD = origin/main = remote = `0f947c2614d585b0e7a448921b6ac537b7f1efa7`; `0/0`; clean.
- state SHA `b9c10625149b3a257792c42d66d814ade2043c05174ed5b0f902457a03fac1f6`;
  counts `299 CONFIRMED / 92 PLANNED / 0 SENT / 0 UNKNOWN`.
- finalized buffer SHA `26af663e732d293df72096c9c071deb756deae4d81df8be3c1e620a7fb00cae3`,
  owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- fresh candidates `299,300,301,302,303`, all PLANNED, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed vs current state)
  `0edf3f8bde5b398a50d98e7481d5223ea490c01f0cbc4c40bb7fa8099e8068fd`; max tx `1231` bytes (≤ 1232).
- authority balance `3246983680` lamports.

## The one supervised uploader invocation

- outer execution ID `af5ede88-304b-4aee-8451-4b60f09b6b5f`;
  inner execution ID `b0caf580-057a-4a0c-8360-db6a63f2c370`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, `WINDOW_LIMIT`.
- selected 5 / attempted 5 / sent 5 / confirmed 5 / finalized 5.

### Signatures (all `finalized`, err = null)

| index | signature |
|------:|-----------|
| 299 | `U4Qc11zNhkosniRuiyMtzNgba5LVZ3UvS6jnfLyMLrRdNYhW7MEJGL9p9SD7bWxnu65J7f8D2z9XZ6FRAQRbHQh` |
| 300 | `57zZzMjkrUub9EgviJfPQeUgcvhnKs9v1hooJcT5doYepk8ZvtKRU8nRv9XeSRSt8n3ywuDeLaabDSHyysPsqrdM` |
| 301 | `2q7cthwNCjfRvfMzj1T7VzCxbHYSS3vRe3eWESggUxSBs7qpHNRH7WZej3fsWaF1oqkkDBUnZMTPJ242FC7ubMhU` |
| 302 | `4oSEtgL5SroewgqHQT4ze2JKCEoJArDkKiiBufYHrHkcjwyvfh1daYu4u6Ek6NHqXCnMJc1z1i6WAJHXetqtJ1Dt` |
| 303 | `8NpNFFe6sntk6UDeNdfahYong6nCpBFb6cTTWP1ijvUwGtX9BsDYxCuDArrxuFQyQu6FovukKvYGFVfUk7uA7sp` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- min RPC start gap 500 ms; confirmation poll 2000 ms; pre-sign/inter-chunk 3000 ms;
  retries 0; rate-limit 0; send errors 0; confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`b0caf580…`) → `SAFE_TO_RELEASE`, releaseReady,
  0 proposed transitions, `onchainWrite: false`, evidenceHash
  `96f6cce03dfdd00c2f9e8796b2d1ea3310efb573d6168f4aad1eccc645d42527`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false, `onchainWrite: false`.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.

## Resulting state and finalized buffer

- state counts `304 CONFIRMED / 87 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `d52609d2e5798713c61ddbf45cb3125c82afbcf12cee76f05fc51a0ddde133bf`.
- finalized buffer SHA `da5b40fc7857b5898cf49a5687cdb4f171d75bc22c704962260ec3b5bbe79418`
  (changed from `26af663e…`); owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.

## Validation

Code unchanged from CI-green baseline `0f947c2…` (only gitignored `.devnet` mutated).
Devnet unit suite 379/379. Anchor/Rust/SBF/tx-size re-verified by exact-SHA CI.

## Remaining campaign

87 chunks remain `PLANNED` (304 confirmed of 391). One more planned window
(304–308) may follow after this checkpoint's exact-SHA CI is green, cooldown
elapses, and a fresh preflight passes.
