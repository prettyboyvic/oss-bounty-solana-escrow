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

## R4B-R2 local reconciliation recovery — 2026-07-19

This section appends the approved recovery evidence without rewriting the
historical blocked checkpoint above. The local lease condition moved from
`BLOCKED_WITH_ACTIVE_OR_UNRESOLVED_LEASE` to recovered local consistency, but
Phase 2 is still not PASS and this checkpoint does not authorize R4C, another
upload window, or any devnet transaction.

Checkpoint verdict: `R4B_RECOVERY_PASS`.

### Verified reconciliation apply

The fresh pre-apply read-only reconciliation returned `SAFE_TO_RELEASE` with
`releaseReady: false`, exactly one proposed transition, and no mutation:

- pre-apply evidence hash:
  `76f6e6e6d953751d754aae691c939139bb4ef3921ca4c0caa079eb2edc1daa3e`;
- on-chain evidence fingerprint:
  `6a32ece046350944ae13a07f9751a9826081329092544f634e34b35bb5a2b155`;
- state SHA-256 before apply:
  `9a6b692903e681fea6fae5b498323dffa92d2bd3b34ef865d8523975def603c9`;
- lease SHA-256:
  `4aea885748b4a8e6da4a02993011f9a9e0bad50d3efed07d60429e91623a68e4`.

Exactly one acknowledged `apply-upload-reconciliation` changed chunk 222 from
`SENT` to `CONFIRMED`. It preserved signature
`3Vkuw3xGzFvM8RTVTSNkeNaPCRL6VhUhdcTx8aRBEJogeHu6QESRPRSqLPkLHEfJEK6vp5RCw1dSA3BvUwnv6tou`,
finalized slot 477359223, the 5,000-lamport fee, offset 224442, the 1,011-byte
payload, and chunk SHA-256
`722de60a2805e835e25459b830742562cbaa17ccb0bdbc6f90f7cc9f433165a7`.
The resulting state SHA-256 is
`61c889ae14dbacc432f9e03c23ac32a552ea8823bcbf3108e2604a26cbb85369`.

The before/after chunk counts are:

| Status | Before apply | After apply |
| --- | ---: | ---: |
| `CONFIRMED` | 222 | 223 |
| `PLANNED` | 168 | 168 |
| `SENT` | 1 | 0 |
| `UNKNOWN` | 0 | 0 |

All other 390 chunk records retained digest
`54063b07af559a1980dfb1d9e9866bccc8e90a540c9fd3bee8cb801a1b8b1504`.
After removing only the authorized chunk-status field and reconciliation
receipt, the complete state retained normalized digest
`6f044420a0b2729c1ee09148769a5559ca636f0354b5fd70743c31281f533348`.
The active lease bytes and mtime remained unchanged through apply, and the
state contains one exact `UPLOAD_RECONCILIATION_V1` receipt.

The 390-record digest is SHA-256 over `JSON.stringify` of the stored, ordered
chunk array after filtering out index 222. The normalized-state digest is
SHA-256 over `JSON.stringify` of the complete parsed state after deleting only
chunk 222's `status` and the matching upload window's
`reconciliationOutcomes`. These projections were captured both before and
after apply and matched exactly.

### Fresh release evidence and archive

The required post-apply reconciliation returned `SAFE_TO_RELEASE` with
`releaseReady: true`, zero proposed transitions, zero unresolved chunks, and:

- fresh evidence hash:
  `3f85960f96dc7ee24b0acd0c108df10eb02fd4ba82a80ec5c1ed706fcef9a1a8`;
- state SHA-256:
  `61c889ae14dbacc432f9e03c23ac32a552ea8823bcbf3108e2604a26cbb85369`;
- lease SHA-256:
  `4aea885748b4a8e6da4a02993011f9a9e0bad50d3efed07d60429e91623a68e4`;
- on-chain evidence fingerprint:
  `6a32ece046350944ae13a07f9751a9826081329092544f634e34b35bb5a2b155`.

Exactly one acknowledged `release-upload-lease` then moved the active audit
directory atomically to:

```text
.devnet/history/upload-leases/42334014-3823-441e-99b6-b62f17f45b45--3f85960f96dc7ee24b0acd0c108df10eb02fd4ba82a80ec5c1ed706fcef9a1a8/
```

The active directory is absent and exactly one matching archive exists. Its
preserved `lease.json` has the original SHA-256 and nanosecond mtime. Its exact
`UPLOAD_LEASE_RELEASE_V1` / `SAFE_TO_ARCHIVE` receipt has SHA-256
`0df21f0a398cc65d83593f5211e4148c4ce4243333add15781a6fde01eba2fb2`
and binds the execution ID, fresh evidence hash, post-apply state hash, and
original lease hash. No audit record was deleted.

### No-devnet-write proof

| Evidence | Before recovery | After archive | Result |
| --- | --- | --- | --- |
| Program account | absent | absent | unchanged |
| Buffer owner | `BPFLoaderUpgradeab1e11111111111111111111111` | same | unchanged |
| Buffer authority | `Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk` | same | unchanged |
| Buffer allocation | 395,181 bytes | same | unchanged |
| Buffer data SHA-256 | `5ead93a84d55d9eca4c33517847a20903e7a19aa9a00fa45fa0a7f8f75ce4554` | same | unchanged |
| Buffer history | 224 | 224 | no new signature |
| Authority balance | 3,247,363,680 lamports | same | unchanged |
| Buffer balance | 2,751,406,320 lamports | same | unchanged |
| State | chunk 222 `SENT` | chunk 222 `CONFIRMED` | authorized local mutation only |
| Lease | active | `ARCHIVED/RELEASED` | authorized local archive only |

The public post-apply reconciler reverified the receipt-bound chunk 222
transaction and every confirmed buffer byte. In addition, a separate
sanitized read-only observer batch-queried signature statuses and independently
fetched the finalized transactions for chunks 219–222. At finalized contextual
account slot 477381592, all four were canonical loader writes with
`meta.err = null`, 5,000-lamport fees, exact roles, offsets, payloads, and full
on-chain bytes. All 223 locally `CONFIRMED` chunk ranges match the preserved
buffer.

That observer also captured the balance and ordered 224-entry buffer history.
The history digest remained
`ab3a8255ee950693127d9db512d9dd2280e9c2f7b3fe7225879806ff96044ab2`;
it is SHA-256 over `JSON.stringify` of the RPC order with only `signature`,
`slot`, `err`, `confirmationStatus`, `memo`, and `blockTime`. A final
post-archive observer at contextual account slot 477381879 reproduced the same
program, buffer, balance, history count, digest, and newest signature.

Across the public reconciliations, their internal fresh-evidence recomputations,
and the separate before/after observers, the audited RPC surface contained only
genesis, signature-status, finalized-transaction, contextual-account, balance,
and signature-history reads. It made zero sign, blockhash, simulate, send,
airdrop, deploy, finalize, or close calls.
No real deployment signer was loaded, no public/devnet uploader was invoked,
and no second upload window was opened. The 14 preserved v2 history snapshots
retained aggregate digest
`ed539b4618c0cc6b3024b9a98fe36d1dc4fce5832651b594c50d9fa251a72d93`.
That digest is SHA-256 over `JSON.stringify` of the sorted manifest entries
`{relative, size, mtimeNs, sha256}` for `.devnet/history/state-v2*`.

### Recovery verification and remaining checkpoint

Local verification passed:

- focused reconciliation/apply/release/sanitizer suite: 58/58;
- full devnet tooling suite: 189/189;
- state-v3 focused suite: 24/24; state plus migration: 29/29;
- throttled local-validator resume and production recovery/resume: 1/1 each;
- local escrow integration: 26/26;
- Rust workspace: 11/11; TypeScript, both rustfmt checks, loader-vector parity,
  workflow YAML, public canonical program identity, and optimized SBF build:
  passed;
- optimized SBF: 395,144 bytes,
  `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`.

The focused 58/58 command was:

```text
node --test tests/devnet/upload-execution-contract.test.mjs tests/devnet/upload-execution-lease.test.mjs tests/devnet/upload-buffer-cli-safety.test.mjs tests/devnet/upload-reconciliation-apply.test.mjs tests/devnet/upload-execution-command.test.mjs
```

Anchor CLI 0.31.1 was not installed in the local shell, so publication CI is
the authoritative environment for `anchor build`, generated-IDL identity, and
`anchor test --skip-build`. The same 26 integration cases passed locally using
the exact optimized SBF and a direct local validator.

The preserved buffer now has 223 exact chunks and 168 remaining planned chunks.
The authority snapshot is 3,247,363,680 lamports; this recovery did not request
funding or recompute a new deployment headroom claim. Phase 2 remains blocked
pending a separately reviewed next phase. No R4C action or devnet transaction
is authorized by this recovery record.
