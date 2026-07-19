# Phase 2-R4B-R1 read-only recovery checkpoint — 2026-07-19

Verdict: `R4B_R1_READ_ONLY_RECONCILIATION_PASS`.

This checkpoint does not authorize `apply-upload-reconciliation`,
`release-upload-lease`, another uploader window, deploy, finalize, close, or any
other devnet write. The real state and active lease remain unchanged.

## Live reconciliation

Exactly one public `reconcile-upload-lease` command ran against the explicit
canonical devnet RPC. It verified the exact devnet genesis and returned:

- result/lifecycle: `SAFE_TO_RELEASE`;
- execution ID: `42334014-3823-441e-99b6-b62f17f45b45`;
- `releaseReady: false`;
- `stateMutation: false`;
- `onchainWrite: false`;
- evidence hash:
  `76f6e6e6d953751d754aae691c939139bb4ef3921ca4c0caa079eb2edc1daa3e`;
- on-chain evidence fingerprint:
  `6a32ece046350944ae13a07f9751a9826081329092544f634e34b35bb5a2b155`.

The exact proposed transition remains unapplied:

| Chunk | Local transition | Finalized slot | Fee | Full-chunk SHA-256 |
| ---: | --- | ---: | ---: | --- |
| 222 | `SENT -> CONFIRMED` | 477359223 | 5,000 | `722de60a2805e835e25459b830742562cbaa17ccb0bdbc6f90f7cc9f433165a7` |

The recorded public signature is
`3Vkuw3xGzFvM8RTVTSNkeNaPCRL6VhUhdcTx8aRBEJogeHu6QESRPRSqLPkLHEfJEK6vp5RCw1dSA3BvUwnv6tou`.
Its finalized transaction has `meta.err = null`, exactly one canonical
upgradeable-loader `Write`, the expected buffer and authority roles, offset
224442, a 1,011-byte exact payload, and exact full-chunk bytes in the preserved
buffer.

## Before/after no-mutation proof

| Evidence | Before | After | Result |
| --- | --- | --- | --- |
| State SHA-256 | `9a6b692903e681fea6fae5b498323dffa92d2bd3b34ef865d8523975def603c9` | same | unchanged |
| State mtime (ns) | `1784456699641486500` | same | unchanged |
| Lease SHA-256 | `4aea885748b4a8e6da4a02993011f9a9e0bad50d3efed07d60429e91623a68e4` | same | unchanged |
| Lease mtime (ns) | `1784456692914477700` | same | unchanged |
| Ignored checkpoint file list | 24 files / `604efcaca6ec91fe7fdbf2532a497972acdb5bf839d25141bb89b857cfbfe47a` | same | unchanged |
| Authority balance | 3,247,363,680 lamports | same | unchanged |
| Buffer history | 224 / `32ccc64c4bb0f456668bfe769e9ed19fa25d05bc3be82953e24455c08020f05c` | same | no new signature |
| Program account | absent | absent | unchanged |
| Buffer data SHA-256 | `5ead93a84d55d9eca4c33517847a20903e7a19aa9a00fa45fa0a7f8f75ce4554` | same | unchanged |
| Buffer owner | `BPFLoaderUpgradeab1e11111111111111111111111` | same | unchanged |
| Buffer authority | `Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk` | same | unchanged |
| Buffer allocation | 395,181 bytes | same | unchanged |
| Buffer lamports | 2,751,406,320 | same | unchanged |

The two finalized account snapshots were observed at slots 477375725 and
477375733. Changing observation slots are expected; all compared state and
account evidence remained exact.

## Root cause and correction

The prior collector treated a persisted `SENT`/`UNKNOWN` status as unresolved
without fetching enough finalized transaction identity evidence. R4B-R1 now
queries the recorded signature, parses the single legacy loader `Write`, and
reads program plus buffer in one finalized contextual snapshot at or after the
transaction slot. It proposes a transition only when transaction identity,
payload, full buffer bytes, binary, identities, allocation, and plan fingerprint
all match.

The read-only command never applies that proposal. The separate
`apply-upload-reconciliation` command requires
`R4_APPLY_UPLOAD_RECONCILIATION`, the exact fresh evidence hash, unchanged state
and lease hashes, a shared local operation lock, atomic state replacement, and
post-write validation. Receipt replay re-queries the finalized transaction,
reconstructs and hashes the complete pre-apply state, and rejects partial or
decoy transition sets. `release-upload-lease` remains a separate acknowledged
local-only atomic archive and requires a fresh zero-transition reconciliation.

## Failure-first and GREEN evidence

Observed RED included the missing transaction collector/API, unresolved
successful `SENT`/`UNKNOWN` cases, absent apply export/dispatch, structured 429
leaks, false-positive rate classification, ineffective cached-import coverage,
forged receipt release, move-before-receipt archive ordering, split operation
locks, separate-slot account reads, omitted legacy version rejection, a valid
decoy receipt, eager unrelated dependency access, and 20 public skipped indexes
misclassified as secret bytes.

Final local evidence:

- full devnet unit suite: 189/189;
- state-v3 focused suite: 24/24;
- state plus migration: 29/29;
- lease/apply focused suite: 22/22;
- sanitizer/CLI focused suite: 22/22;
- codec: 6/6; planner: 3/3; sequential uploader core: 10/10;
- production local-validator recovery/resume: 1/1;
- throttled local-validator interruption/resume: 1/1;
- Rust workspace: 11/11;
- TypeScript typecheck, root/tool rustfmt, optimized SBF build, workflow YAML,
  and `git diff --check`: passed;
- optimized artifact: 395,144 bytes,
  `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`;
- independent security review: `READY` after the final 44/44 focused rerun.

## Required next review

The active lease is deliberately retained and chunk 222 deliberately remains
`SENT` in real local state. A future, separately authorized turn may decide
whether to apply the exact reconciliation evidence and then obtain a new
zero-transition hash for local lease archival. No second upload window may be
opened before that review.
