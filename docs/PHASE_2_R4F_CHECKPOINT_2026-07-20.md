# Phase 2 R4F Checkpoint - 2026-07-20

## Verdict

`R4F_WINDOW_PASS`

Authorization ended after exactly one five-chunk uploader invocation. No
second window, resend, re-sign, replacement, send retry, finalize, deploy,
close, regenerate, faucet, mint, DEVTEST, or escrow flow was performed.

## Baseline and cooldown

Gate 0 matched commit `92796087fc11726d72c6195f5afa82744d687f21`,
origin/main, ahead/behind `0/0`, and successful CI run `29715623373`. The clean
state contained 229 `CONFIRMED`, 162 `PLANNED`, and zero `SENT/UNKNOWN`
chunks. Its SHA-256 was
`9eb3357af879f5163eb4611455850e4ff6182d24e91d6008ea587cf6608017fb`.
There was no active lease or uploader process. All four existing lease
archives were captured by hash and mtime, `.devnet/` was ignored/untracked,
and all five parked repositories were clean at their audited commits with
ahead/behind `0/0`. The latest R4D-E write was 2,252 seconds old, exceeding
the required 900-second cooldown.

## Fresh preflight and funding

The sole fresh preflight used the published scheduler and seven successful
read requests with zero retry, rate limit, or RPC error. Its minimum actual
request-start gap was 504.568 ms. It verified exact devnet genesis
`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, absent program, canonical
buffer owner/authority/allocation/hash, binary and plan fingerprint, state
hash, no lease, and one finalized snapshot validating confirmed chunks
0-228. Balance, both rent values, and history were refreshed. State SHA/mtime
and the complete `.devnet` file manifest remained unchanged; no signer,
blockhash, or write-capable method was used.

Fresh funding was:

| Component | Lamports |
|---|---:|
| Authority balance | 3,247,333,680 |
| Remaining 162 chunk fee estimate | 1,620,000 |
| Finalize fee estimate | 10,000 |
| Program rent | 1,141,440 |
| ProgramData rent | 2,751,406,320 |
| Operational reserve | 250,000,000 |
| Total requirement | 3,004,177,760 |
| Headroom | 243,155,920 |

The result was `SUFFICIENT`. The deterministic assumptions remain 10,000
lamports per remaining one-signature chunk transaction and 10,000 lamports
for a future finalize transaction. R4F did not perform finalize.

## Candidate and immediate pre-write evidence

The packet-safe plan retained a 1,232-byte ceiling, 1,011-byte payload, and
1,231-byte maximum serialized transaction. It selected exactly the first five
full nonmatching `PLANNED` chunks:

| Chunk | Offset | Length | Payload SHA-256 | Before |
|---:|---:|---:|---|---|
| 229 | 231519 | 1011 | `9d707d08900eb7e5b0d137998e468fb572eb33e518ffc9b88ac43d2d32a51b88` | exact mismatch |
| 230 | 232530 | 1011 | `155e9252b4c90b1369383ba18a922c06b4433ded4e4ab8b8e6237f653efffdb9` | exact mismatch |
| 231 | 233541 | 1011 | `7d55454a1050da4ad17382a52c8fe7a90ff0ad37195fb5e077fadc2b8a99f83e` | exact mismatch |
| 232 | 234552 | 1011 | `9e080e9885daf925dc4d32e0d5d2672e9b6fc1e777c48f4a02c79d103770ea2f` | exact mismatch |
| 233 | 235563 | 1011 | `27f1383d8b01d60021b9be39f954888ac9bac76947ed7c254a1b2781a6c60e44` | exact mismatch |

Chunk 234 at offset 236574 was explicitly excluded and remained `PLANNED`
with a null signature. The immediate boundary rechecked unchanged state,
absent program, buffer/binary/plan/funding, no lease/process, and the canonical
public key derived from exactly one ignored authority candidate. Its ledger
recorded 6/6 successful read-only requests, zero retries/errors, and a
501.606 ms minimum gap. The parsed public contract required max chunks 5,
3,000 ms delay, 500 ms global gap, 2,000 ms confirmation floor, read backoffs
2,000/5,000 ms, concurrency one, 3,000 ms pre-sign cool-off, and acknowledgement
`R4_BUFFER_UPLOAD`.

## Sole five-chunk execution

Execution ID: `d75f0b9a-1ce7-440a-970f-ae24e9338d48`

The only invocation ran from `2026-07-20T04:21:13.425Z` to
`2026-07-20T04:22:39.752Z` and ended at `WINDOW_LIMIT`. It processed, sent,
and finalized exactly chunks 229-233. There was one signer load, five fresh
blockhash calls, five builds, five sends, and five finalized confirmations.
Every send used retry number zero and returned the locally persisted signature.

The bounded ledger recorded 56/56 successful attempts: genesis 1, account
information 7, balance 1, rent 2, latest blockhash 5, signature status 35,
and send 5. It recorded zero rate limits and zero RPC errors. Minimum actual
RPC request-start gap was 502.027 ms; minimum status request-start gap was
2,000.0531 ms; observed pre-sign cool-off was 3,000.385 ms. All five 3,000 ms
sleeps completed at or above the requested duration.

| Chunk | Slot | Confirmation duration | Fee | Signature / Explorer |
|---:|---:|---:|---:|---|
| 229 | 477535506 | 12,531.7677 ms | 5,000 | [5h8sfXYi...PFXLUt](https://explorer.solana.com/tx/5h8sfXYikAMDCp3cKpqor9afbXnmL9Ca3Sb2fJJposgSCuEy67Y5CteBDoPQ1VVzMmtRALnszdhSe4hxeePFXLUt?cluster=devnet) |
| 230 | 477535552 | 12,538.4559 ms | 5,000 | [3HpxHSV6...3cLqYU](https://explorer.solana.com/tx/3HpxHSV6TzUcU12KZNzK79FAyff6rALhBsk2WyzUbWCJXXTnqapHxiMScM6Ao1TxtmrdDnawUzgGefRtkn3cLqYU?cluster=devnet) |
| 231 | 477535597 | 12,560.5270 ms | 5,000 | [4jcRTo9q...eyHq9V](https://explorer.solana.com/tx/4jcRTo9qSctJicyutTTDhxo5NRn2VvJ2cNXMhNQuWbPdURfT19zsvontMALkAfz5Fxi3Uig2ph52ZnvSYeyHq9V?cluster=devnet) |
| 232 | 477535642 | 12,541.5128 ms | 5,000 | [5ov8hHxi...kf3CSrM](https://explorer.solana.com/tx/5ov8hHxiNNMhvVMpJ1VmQPaiXR133enoBV5hRej77v22vQnsHsgH75gBCetDoYhtufBjeEKfcRrdU5ckRkf3CSrM?cluster=devnet) |
| 233 | 477535688 | 12,533.4194 ms | 5,000 | [4DXhR16E...Ai4mL79E](https://explorer.solana.com/tx/4DXhR16EP5cBWLsCdLyeG2zHXv7ZpJdynD1rSsCPfJh3TYCHLvrxXym55Sqzvffa7jkdghLqBCNdiRC5Ai4mL79E?cluster=devnet) |

Fresh finalized evidence proved for each signature: exactly one legacy
Loader-v3 Write instruction, canonical buffer and authority accounts, expected
offset and declared length, exact payload SHA-256, null transaction error,
finalized status, and exact full bytes in a finalized buffer snapshot. The
post-evidence scheduler recorded 10/10 successful read-only requests, zero
retries/errors, a 500.6374 ms minimum gap, and no blockhash or send.

## State, balance, history, and buffer deltas

| Evidence | Before | After | Delta |
|---|---:|---:|---:|
| `CONFIRMED` | 229 | 234 | +5 |
| `PLANNED` | 162 | 157 | -5 |
| `SENT/UNKNOWN` | 0/0 | 0/0 | 0/0 |
| Authority balance | 3,247,333,680 | 3,247,308,680 | -25,000 |
| Buffer history count | 230 | 235 | +5 |
| State SHA-256 | `9eb3357af879f5163eb4611455850e4ff6182d24e91d6008ea587cf6608017fb` | `7d465c9bec7730b6745f731dc71556f4749dc0d6c445e5622e4dc4fb8a2d3963` | expected local checkpoint update |
| Buffer data SHA-256 | `644ccb391038ad1dca90e001a9ccbcbacb89733fe0c9bb12b0f675171421e3a9` | `6f92051d61514e91e48d20c8476393d2028d98ffb2b58152fc6519384ebba3d7` | exact five-chunk update |

The program remained absent. The buffer retained canonical owner, authority,
395,181-byte allocation, and 2,751,406,320 lamports. The optimized binary
remained 395,144 bytes with SHA-256
`f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`.

## Reconciliation and release

Mandatory public `reconcile-upload-lease` returned `SAFE_TO_RELEASE`, lifecycle
`SAFE_TO_RELEASE`, `releaseReady: true`, and zero proposed transitions. It was
strictly read-only with `stateMutation: false` and `onchainWrite: false`.
Because no transition was proposed, `apply-upload-reconciliation` was not
invoked.

Fresh acknowledged `release-upload-lease` returned `ARCHIVED/RELEASED` with
evidence hash
`5fce1cd452533e1e475b9f8aa9eca049ed17d6cecc33bb3e7e4aae1886930b36`.
Its mutation was local archive-only (`stateMutation: true`,
`onchainWrite: false`). State SHA/mtime remained unchanged through reconcile
and release. The active lease was removed and the fifth archive atomically
preserved both public receipts.

## R4D-E versus R4F

| Metric | R4D-E | R4F |
|---|---:|---:|
| Selected / attempted / finalized | 3 / 3 / 3 | 5 / 5 / 5 |
| Minimum live RPC gap | 500.3259 ms | 502.0270 ms |
| Status requests | 21 | 35 |
| Status rate limits | 0 | 0 |
| Confirmation durations | 12,548.9065 / 12,544.8201 / 12,553.2222 ms | 12,531.7677 / 12,538.4559 / 12,560.5270 / 12,541.5128 / 12,533.4194 ms |
| Total fees | 15,000 | 25,000 |
| Send retries | 0 | 0 |

No provider-quota inference is made from this bounded observation.

## Regression and hygiene

Local verification completed with:

- focused scheduler/ledger/polling/uploader/reconciliation: 100/100;
- full devnet tooling: 237/237;
- state schema v3: 24/24;
- local-validator interruption/resume: 1/1;
- local-validator production/recovery: 1/1;
- Anchor-compatible integration: 26/26;
- Rust workspace: 11/11;
- IDL-build identity: 8/8;
- TypeScript, both rustfmt checks, four-vector parity, optimized SBF/hash,
  workflow YAML, canonical program identity, and `git diff --check`: passed.

The final staged scan found no mnemonic, seed phrase, private-key array,
credentialized RPC URL, signed transaction bytes, or ignored authority path.
`.devnet/` remained ignored and untracked. All eight pre-existing archive
files retained their exact Gate 0 hashes and mtimes; the new archive contains
only its public lease/release receipts. No active uploader process or lease
remained, no R4F temporary harness remained, and all five parked repositories
were clean at ahead/behind `0/0`. Publication is limited to this checkpoint
and its tracked execution plan.
