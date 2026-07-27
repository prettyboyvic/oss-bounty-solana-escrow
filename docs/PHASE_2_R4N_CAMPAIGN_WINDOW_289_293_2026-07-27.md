# Phase 2 R4N Campaign — Window (chunks 289–293)

Window 3 (final) of the bounded ≤5-window campaign; planned target of 3 windows
reached. Terminal-complete, reconciled, released, quiescent. No claim of full
upload, program finalization, deployment, or business flow.

## Between-window boundary satisfied (window 2 → window 3)

- window 2 (284–288) fully closed; all finalized; reconcile `SAFE_TO_RELEASE`;
  lease released; checkpoint `d37e0399db4eefa8256a086a901487f6ec489188`;
  exact-SHA CI `30231156141` success; cooldown 914 s (≥ 900); fresh preflight passed.

## Pre-window baseline (fresh)

- HEAD = origin/main = remote = `d37e0399db4eefa8256a086a901487f6ec489188`; `0/0`; clean.
- state SHA `f0b8cfc4d9bf7ba6b3e194d9189a43d8db58afe3e8e4c4710dca7ccb51dd8d7f`;
  counts `289 CONFIRMED / 102 PLANNED / 0 SENT / 0 UNKNOWN`.
- finalized buffer SHA `f5129d66e4ce31507ead5ae9a2eacef5102d6323a2ee02e1703a83c8e2266467`,
  owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- fresh candidates `289,290,291,292,293`, all PLANNED, null signatures.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed vs current state)
  `3e2414b4f487896960e8a0a10a1695bfc9559f09ca281f2cb02882d0497f6736`; max
  serialized transaction size `1231` bytes (≤ 1232).
- authority balance `3247033680` lamports.

## The one supervised uploader invocation

- outer execution ID `76ac7dc2-3312-4d0b-84fc-efc6d8513cb4`;
  inner execution ID `7ecf5c8b-1b40-498c-b90e-06f42b5432dd`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, `WINDOW_LIMIT`.
- selected 5 / attempted 5 / finalized 5.

### Signatures (all `finalized`, err = null)

| index | signature |
|------:|-----------|
| 289 | `EEU1egsP1RcRTgDWBzdZqWsyAXmeKT8hCN2kkiMTuvKJiHyhJsMNqB26tAjpvMaT3GzaLAX2bdQRMiogQGEhQEf` |
| 290 | `QKh4exWkChuv4agS7zKjHU6hxAS8jrSv9W6DcLrM7azikmhUx1k1AUDWwSEBjsVbyQGXkiYNfCacuAUgxzGTUZN` |
| 291 | `2DNNz7JnuzqxD6PGYhLNEFh5bMAH1S1hVWK9sagvnmzbb2ruyX6nsU2J6PW9BxDMby3vc9Poo5RSykGfvzHexgJ6` |
| 292 | `4zqb8WXwbLBFebgoXkM8LXYzbt768YHM5HTQVds39JXHsfTzhoAJ2p4VZUqZzitDZqfhtTDiQsnbaK3hKM9RtMyM` |
| 293 | `7QeKnn6C263UQQWJDP1kVLFtaiza2UBjocLyBnHs1RybZpuBQwgmbrX89UNhk2p3Ba8ce7YGCJyMhdXtHULE22E` |

### Telemetry

- RPC requests 56, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 5.
- min RPC start gap 500 ms; confirmation poll 2000 ms; pre-sign/inter-chunk 3000 ms;
  retries 0; rate-limit 0; send errors 0; confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`7ecf5c8b…`) → `SAFE_TO_RELEASE`, releaseReady,
  0 transitions, `onchainWrite: false`, evidenceHash
  `36206aed09cb314967538bb1b0771dea854859168d43b0b4e5795f16b4f6a10d`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false, `onchainWrite: false`.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.

## Resulting state and finalized buffer

- state counts `294 CONFIRMED / 97 PLANNED / 0 SENT / 0 UNKNOWN`.
- state SHA `c4ea16e0d6affeb5a6d483c66f5fd2ac4459397b70189877d77f00c67334180d`.
- finalized buffer SHA `6410c4fe0ea7d73f448adbeff82e1e4466eee0b280e44105ff1f59c372f0d061`
  (changed from `f5129d66…`); owner `BPFLoaderUpgradeab1e…`, executable false, length `395181`.
- authority balance after `3247008680` lamports.

## Validation

Code unchanged from CI-green baseline `d37e0399…` (only gitignored `.devnet` mutated).
Devnet unit suite 379/379. Anchor/Rust/SBF/tx-size re-verified by exact-SHA CI.

## Campaign summary (three windows)

- outer-host invocations 3; uploader invocations 3; transactions signed/sent 15;
  all finalized; `SENT = 0`, `UNKNOWN = 0` globally; three leases released.
- windows: 279–283, 284–288, 289–293. No fourth/fifth window run (planned 3;
  ceiling 5). Historical incident evidence unchanged.

## Remaining campaign

97 chunks remain `PLANNED` (294 confirmed of 391) — ~20 further five-chunk
windows. A separately authorized next batch may continue under the same
per-window boundary.
