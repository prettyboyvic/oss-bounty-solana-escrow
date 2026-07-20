# Phase 2 R4D-E Checkpoint - 2026-07-20

## Verdict

`R4D_E_WINDOW_PASS`

Authorization ended after exactly one bounded uploader invocation. No second
window, resend, re-sign, replacement, send retry, finalize, deploy, close,
regenerate, faucet, mint, DEVTEST, or escrow flow was performed.

## Baseline and preflight

Gate 0 matched commit `cf9e57150ef26f227e95372b0157636d7c669e0a`,
origin/main, ahead/behind `0/0`, and successful CI run `29714231442`. The clean
state contained 226 `CONFIRMED`, 165 `PLANNED`, and zero `SENT/UNKNOWN` chunks.
There was no active lease or uploader process, all three existing lease
archives were immutable, `.devnet/` was ignored/untracked, and all five parked
repositories were clean at their audited commits. The latest prior write was
8,584 seconds old, exceeding the 900-second cooldown.

The sole fresh preflight used the published scheduler and seven successful
read requests with zero retries or errors. Its minimum actual invocation-start
gap was 500.5341 ms. It verified devnet genesis
`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, absent program, canonical
buffer owner/authority/allocation, binary and plan fingerprint, one finalized
snapshot covering all 226 confirmed chunks, state hash, balance, rent, history,
and no active lease. No signer or blockhash was loaded.

Fresh funding was:

| Component | Lamports |
|---|---:|
| Authority balance | 3,247,348,680 |
| Remaining 165 chunk fee estimate | 1,650,000 |
| Finalize fee estimate | 10,000 |
| Program rent | 1,141,440 |
| ProgramData rent | 2,751,406,320 |
| Reserve | 250,000,000 |
| Total requirement | 3,004,207,760 |
| Headroom | 243,140,920 |

The result was `SUFFICIENT`. The fee assumptions remain conservative: 10,000
lamports per remaining chunk and 10,000 lamports for a future finalize action;
this checkpoint did not perform finalize.

## Candidate proof and immediate boundary

The planner selected exactly the first three nonmatching `PLANNED` chunks:

| Chunk | Offset | Length | Payload SHA-256 | Before |
|---:|---:|---:|---|---|
| 226 | 228486 | 1011 | `315c71cc8d6989c02ab5252ddb89947608afd931d02ca7a2e40295721590ea88` | exact mismatch |
| 227 | 229497 | 1011 | `a5a695e3409b31215637895fb5583c48593e81469c8db7e2a98468d37fcca2ae` | exact mismatch |
| 228 | 230508 | 1011 | `4138ed5f3cf33b4deb84ecfc967d7c67ce1565fbc6415aaf6ffd04b7ea6bfba0` | exact mismatch |

Chunk 229 at offset 231519 was explicitly excluded and remained `PLANNED`
with a null signature. The immediate pre-write gate rechecked the unchanged
state, absent program, buffer identity/hash, funding, binary/plan fingerprint,
no lease/process, and the public key derived from the ignored authority file.
It recorded six successful read requests, no retry/error, and a 501.2487 ms
minimum gap. The enforced policy was max chunks 3, global RPC start gap 500 ms,
confirmation floor 2,000 ms, pre-sign cool-off 3,000 ms, inter-chunk delay
3,000 ms, concurrency one, and acknowledgement `R4_BUFFER_UPLOAD`.

## Sole bounded execution

Execution ID: `2b150695-bbc2-4902-8449-2e4dd0f5909c`

The sole invocation ran from `2026-07-20T03:36:08.677Z` to
`2026-07-20T03:37:01.809Z` and ended at `WINDOW_LIMIT`. It processed, sent,
and finalized exactly chunks 226-228. There was one signer load, three builds,
three signatures, and three send calls. Every send had retry number zero.

The bounded request ledger recorded 36/36 successful attempts: genesis 1,
account information 5, balance 1, rent 2, latest blockhash 3, signature status
21, and send 3. It recorded zero rate limits and zero RPC errors. Minimum actual
RPC invocation-start gap was 500.3259 ms; minimum normal status-poll gap was
2,000.8266 ms; observed pre-sign cool-off was 3,057.9605 ms. All recorded
3,000 ms sleeps completed at or above the requested duration. Confirmation
durations were 12,548.9065 ms, 12,544.8201 ms, and 12,553.2222 ms.

| Chunk | Slot | Fee | Signature / Explorer |
|---:|---:|---:|---|
| 226 | 477528126 | 5,000 | [4PZWoFtQ...pZWmXc](https://explorer.solana.com/tx/4PZWoFtQNjfPEEMp7fmnieAvK9PshREM6Kvh4XUw1FGohRSPGc8Fb5UJni83wQSJeAofVT63gLUw33WS35pZWmXc?cluster=devnet) |
| 227 | 477528171 | 5,000 | [4S5c5jMp...PKkbTtN](https://explorer.solana.com/tx/4S5c5jMpweJDDkuUm9o64926epH7FPWRe2urLAUBsecCSaDHwyLMKi4hM8Y5hX9uAzYqE9Yezoe6wPXR5PKkbTtN?cluster=devnet) |
| 228 | 477528217 | 5,000 | [2rjs5Jzt...UgLyXUuW](https://explorer.solana.com/tx/2rjs5Jzt4HSMBaUfDZJyn5gfMQ28hWC3hteVepcB9ipN6GAyHt9RGfaYqq2i56miUqVUvhuoMCjFSBEpUgLyXUuW?cluster=devnet) |

Fresh finalized transaction evidence proved for each signature: exactly one
legacy Loader-v3 Write instruction, exactly the canonical buffer and authority
accounts, the expected offset and declared length, exact payload SHA-256, null
transaction error, finalized status, and exact full bytes in the finalized
buffer snapshot. The post-evidence scheduler recorded 8/8 successful read-only
requests, zero retries/errors, a 500.2035 ms minimum gap, and no blockhash or
send call.

## State, balance, history, and buffer deltas

| Evidence | Before | After | Delta |
|---|---:|---:|---:|
| `CONFIRMED` | 226 | 229 | +3 |
| `PLANNED` | 165 | 162 | -3 |
| `SENT/UNKNOWN` | 0/0 | 0/0 | 0/0 |
| Authority balance | 3,247,348,680 | 3,247,333,680 | -15,000 |
| Buffer history count | 227 | 230 | +3 |
| State SHA-256 | `bee372e99019b35b30d2801eb927cf343411b848ba2f99d7f89650928de62481` | `9eb3357af879f5163eb4611455850e4ff6182d24e91d6008ea587cf6608017fb` | expected local checkpoint update |
| Buffer data SHA-256 | `e7916e8b8955675f4f900ab05cf1b58979acd3dbd5d4e3d12afb4359b9966385` | `644ccb391038ad1dca90e001a9ccbcbacb89733fe0c9bb12b0f675171421e3a9` | exact three-chunk update |

The program remained absent. The buffer remained owned by
`BPFLoaderUpgradeab1e11111111111111111111111`, authorized by
`Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk`, allocated at 395,181 bytes,
and funded with 2,751,406,320 lamports. The optimized binary remained 395,144
bytes with SHA-256
`f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`.

## Reconciliation and lease release

Mandatory public `reconcile-upload-lease` returned `SAFE_TO_RELEASE`, lifecycle
`SAFE_TO_RELEASE`, `releaseReady: true`, and zero proposed transitions. It was
strictly read-only: state hash/mtime and archive count did not change and the
lease remained active pending the separate release. Because no transitions
were proposed, `apply-upload-reconciliation` was not invoked.

Fresh acknowledged `release-upload-lease` returned lifecycle
`ARCHIVED/RELEASED`, the matching execution/evidence hash, local
`stateMutation: true`, and `onchainWrite: false`. It atomically preserved the
lease and release receipts under the fourth archive and removed the active
lease. State SHA-256 and mtime remained unchanged by reconciliation/release.

## R4C versus R4D-E

| Metric | R4C | R4D-E |
|---|---:|---:|
| Minimum RPC gap | 499.2464 ms | 500.3259 ms |
| Status requests | 46 | 21 |
| Status rate limits | 8 | 0 |
| Confirmation poll floor | old behavior | 2,000.8266 ms observed minimum |
| Sends | 3 | 3 |
| Finalized | 3 | 3 |
| Send retries | 0 | 0 |

No provider-quota inference is made from this single bounded observation.

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
- TypeScript, root/tool rustfmt, four-vector parity, optimized SBF/hash,
  workflow YAML, canonical program identity, and `git diff --check`: passed.

The final focused added-line scan found no mnemonic, seed phrase, private-key
array, credentialized RPC URL, signed transaction bytes, or ignored authority
path. `.devnet/` remained ignored and untracked. Existing archives stayed
immutable, the new archive contains only its public audit receipts, and all
five parked repositories remained clean at ahead/behind `0/0`. Publication is
limited to this checkpoint and its tracked execution plan.
