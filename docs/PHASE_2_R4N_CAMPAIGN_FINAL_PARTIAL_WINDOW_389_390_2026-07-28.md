# Phase 2 R4N Campaign — Final Partial Window (chunks 389–390)

Final partial two-chunk window of the R4N buffer-upload campaign. Terminal-complete,
reconciled, released, quiescent. With this window the buffer upload reaches
**391 / 391 CONFIRMED** and the on-chain buffer payload is byte-identical to the
local binary. No program finalize, deploy, upgrade, or business flow is performed
or claimed; those remain a separately authorized phase.

## Pre-window baseline (independently verified, directly measured)

- HEAD = origin/main = remote = `8dc47d10d6aecca02bd7435978135b8131708e09`; `0/0`; clean; no git op locks.
- state SHA `1308c37115b4c2d6a13d60d100c717aa63d6d1047b6c4a529b753fd2ca989647`;
  counts `389 CONFIRMED / 2 PLANNED / 0 SENT / 0 UNKNOWN`; contiguous CONFIRMED prefix 389;
  PLANNED indexes exactly `[389, 390]`.
- binary SHA `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`, length `395144`.
- on-chain buffer SHA (account data) `d34564573c4da4838ef854884da073aa45db6546a2ea4636d159dccf07f31060`,
  owner `BPFLoaderUpgradeab1e…`, allocation `395181`, status `BUFFER_WRITING`.
- plan fingerprint `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- Exact-SHA CI run `30282496305` (headSha `8dc47d1…`) = `success` (verified via GitHub API).
- Cooldown from prior session ~4 h (≥ 900 s). Baseline devnet unit suite 379/379.
- Prior three checkpoints (374–378, 379–383, 384–388) carry 15 durable full signatures;
  committed balance accounting decreasing `3246608680 → 3246583680 → 3246558680 → 3246533680`.

## Partial-window tooling support (proven before live write)

- `--max-chunks` parses within `[1, MAX_UPLOAD_CHUNKS=5]`; value `2` is valid.
- outer-host asserts `expectedCandidates.length === inner --max-chunks value`; `2 === 2`.
- candidate-range syntax `389-390` is authoritative (`parseCandidateRange`), length 2.
- candidate-evidence digest supports `candidateCount = 2`.
- transaction size computed for the exact partial range; final short chunk 390 (854 bytes)
  yields 1074 B, chunk 389 (1011 bytes) yields 1231 B — both ≤ 1232.
- throttled uploader stops at `processed >= maxChunksPerWindow`, selecting exactly 2.
- no hardcoded five-count equality exists in host / uploader / reconciliation logic.
- no code or test modification required.

## Candidates and digest

- candidates `389, 390`, both PLANNED, contiguous, null signatures; selected count 2.
- chunk 389: offset 393279, length 1011; chunk 390: offset 394290, length 854
  (394290 + 854 = 395144 = binary length — full coverage).
- `R4_CANDIDATE_EVIDENCE_V1` digest (recomputed)
  `aa65438647b8228453b966f42df7084f507da342a73ebfda8ec4c5e3982ad675`; max tx `1231` B (≤ 1232).
- authority balance before `3246533680` lamports; headroom `243955920`; funding `SUFFICIENT`.

## The one supervised uploader invocation

- outer execution ID `f87b60bb-36b7-4776-b375-6b515b2e754e`;
  inner (lease) execution ID `4c952328-d808-4332-8e2d-84099b095e73`.
- host `HOST_CHILD_SUCCEEDED`, exit 0, childSpawnCount 1, retryOccurred false;
  inner `UPLOAD_PROCESS_EXITED`, uploaderInvocationCount 1, childExitCode 0,
  runtimeElapsedMs 40685.
- processed 2 / sent 2 / confirmed 2; every err = null.

### Full signatures (both confirmed)

| index | signature |
|------:|-----------|
| 389 | `3SXp9DmvYAUBRK5T2WyjmXirdU3NK1fSiiHmxbnJGNsAUcXY5796bGojnSSsvBD4S8YJuqjhxxuo2LVTw84VrHWm` |
| 390 | `34XzJKwN9Cc2kQ4sEpftoJFkEL6zjRo7kxqa493uto9f7MCbjcDvYAn3KWTpD6RXmtAjAPkwufgiktzUfM2KqXj7` |

### Telemetry

- RPC requests 26, all `SUCCESS` (0 rate-limited, 0 timeout, 0 error); `SEND_RAW_TRANSACTION` 2.
- request start gap 500 ms; confirmation poll 2000 ms; inter-chunk 3000 ms;
  request timeout 15000 ms; retries 0; rate-limit 0; send/confirmation errors 0.

## Reconciliation and release

- `reconcile-upload-lease` (`4c952328…`) → releaseReady, 0 proposed transitions,
  `onchainWrite: false`, evidenceHash
  `444d9bdb685ab1d5a3f43d44324caf64d5adeb6ea35fff96ac7b99358094266f`.
- `release-upload-lease` → `ARCHIVED/RELEASED`, idempotent false.
- post-release: no active lease, no operation lock, no uploader/supervisor/outer-host process.
- durable evidence root: `.devnet/upload-window-host-results/f87b60bb-36b7-4776-b375-6b515b2e754e/`.

## Resulting state, buffer and payload-to-binary comparison

- state counts `391 CONFIRMED / 0 PLANNED / 0 SENT / 0 UNKNOWN`; contiguous CONFIRMED prefix 391.
- state SHA `05a1def974277117fe3948fd980ef997f6ec37f313056628e2a875b2d83e33a9`.
- on-chain buffer status now `BUFFER_COMPLETE`; account-data SHA (incl 37-byte loader
  metadata) `7d1149b20e04376c5c150a258b16e6c66fa2f6eb35f9dc55b040d51be22f0db0`;
  owner `BPFLoaderUpgradeab1e…`, executable `false`, allocation `395181`.
- **payload-to-binary**: on-chain account data minus the 37-byte loader metadata prefix
  is `395144` bytes; its SHA-256 is
  `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`, which equals the
  local binary SHA-256 over the equivalent byte range (byte-identical, `Buffer.compare === 0`).
  The account-data SHA differs only because it additionally covers the loader metadata.
- authority balance after `3246523680` lamports (Δ 10 000 = 2 × 5 000 base fee); funding `SUFFICIENT`.

## Validation

Code unchanged from CI-green baseline `8dc47d1…` (only gitignored `.devnet` mutated;
tracked tree clean). Post-window devnet unit suite 379/379. No recurrence of the
historical `378/1` anomaly (root cause remains UNPROVEN; disposition unchanged).

## Campaign closeout

- Buffer upload complete: 391 / 391 chunks CONFIRMED; 0 PLANNED / 0 SENT / 0 UNKNOWN.
- On-chain buffer payload byte-identical to local binary over the equivalent range.
- Buffer account still `owner = loader`, `executable = false` (a buffer, not yet a
  deployed program) — finalize/deploy is a **separately authorized** phase and is not
  performed here.

## Not performed / not claimed

No buffer finalize, no program deploy/upgrade, no business flow, no bounty submission,
no tooling change, no secret-key inspection. No claim that the program is deployed or
finalized — only that the upload buffer is complete and matches the binary.
