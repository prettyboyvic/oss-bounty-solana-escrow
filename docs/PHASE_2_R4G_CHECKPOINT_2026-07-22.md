# Phase 2 R4G Checkpoint - 2026-07-22

## Verdict

`R4G_WINDOW_PASS`

Exactly one bounded uploader invocation ran and finalized chunks 234-238.
No second invocation, send retry, re-sign, resend, replacement, finalize,
deploy, close, identity regeneration, faucet request, mint, DEVTEST, or escrow
flow occurred.

## Baseline and publication gate

Gate 0 matched branch `main` at
`d62cd6b00f208fe74f1a11f06701aef82ac31244`, local and remote `origin/main`,
ahead/behind `0/0`, a clean index/worktree, and successful exact-SHA CI run
[29742408289](https://github.com/prettyboyvic/oss-bounty-solana-escrow/actions/runs/29742408289).
The repository README contained the published R4F status. `.devnet/` was
ignored and no `.devnet` file was tracked.

## Fresh read-only preflight

The scheduler-backed preflight used seven successful read requests with zero
rate limits or RPC errors and a 500.4068 ms minimum request-start gap. It did
not load a signer, request a blockhash, invoke a write-capable method, or mutate
state. It proved:

- exact devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`;
- absent canonical program;
- canonical buffer, Loader-v3 owner, authority, and 395,181-byte allocation;
- 395,144-byte optimized binary with SHA-256
  `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`;
- plan fingerprint
  `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`;
- state SHA-256
  `7d465c9bec7730b6745f731dc71556f4749dc0d6c445e5622e4dc4fb8a2d3963`;
- buffer-data SHA-256
  `6f92051d61514e91e48d20c8476393d2028d98ffb2b58152fc6519384ebba3d7`;
- 234 `CONFIRMED`, 157 `PLANNED`, zero `SENT`, and zero `UNKNOWN`;
- one finalized snapshot proving the complete confirmed prefix 0-233;
- no active lease, operation lock, or uploader process; and
- 157,656 seconds of cooldown at the immediate boundary, above the required
  900 seconds.

Fresh funding was:

| Component | Lamports |
|---|---:|
| Authority balance | 3,247,308,680 |
| Remaining 157 chunk fee allowance | 1,570,000 |
| Future finalize fee allowance | 10,000 |
| Program rent | 1,141,440 |
| ProgramData rent | 2,751,406,320 |
| Operational reserve | 250,000,000 |
| Total requirement | 3,004,127,760 |
| Headroom | 243,180,920 |

The result was `SUFFICIENT`. No finalize transaction was performed.

## Candidate proof

The packet-safe plan retained a 1,011-byte payload and 1,231-byte maximum
serialized transaction. The first five full nonmatching `PLANNED` records all
had null signatures:

| Chunk | Offset | Length | Payload SHA-256 |
|---:|---:|---:|---|
| 234 | 236574 | 1011 | `6bcf0cc780c27421ca2385f96d0592976854e1bcf7410ea8a4cc77464da894f0` |
| 235 | 237585 | 1011 | `85b763fef51edaf3e06a491da2089073c76eb397633f09562897488f03822185` |
| 236 | 238596 | 1011 | `c5bdb5f8d4bbb2e1bce5f2b38406800ebfa3a5e1c8a22362afeec281b23553fc` |
| 237 | 239607 | 1011 | `1be974f5c0adc938cefdab444e2516d919d0559521040977e63117312fb2c24e` |
| 238 | 240618 | 1011 | `721f147fddfdeb4d1e79f2325289a13ee5a7a80bdf2718dba6fac04471d92656` |

Chunk 239 at offset 241629 was explicitly excluded and remained `PLANNED`
with a null signature.

## Sole bounded invocation

Execution ID: `638066b5-5ede-4726-b9cf-bd0a285d4a6c`

The invocation ran from `2026-07-22T00:10:43.679Z` to
`2026-07-22T00:12:10.032Z`, a total window duration of 86,353 ms, and ended at
`WINDOW_LIMIT`. It processed, sent, and finalized exactly five chunks. The
sanitized production result reported 56/56 successful RPC attempts, zero rate
limits, zero RPC errors, five fresh blockhash reads, five sends, and 35 status
requests.

The production CLI persists the aggregate request ledger and timing policy but
does not persist per-request timestamps or per-chunk confirmation duration.
Therefore this checkpoint does not invent an actual live minimum-gap or
per-chunk duration claim. The enforced policy was a 500 ms global request-start
gap, 2,000 ms confirmation floor, 2,000/5,000 ms read backoffs, concurrency
one, 3,000 ms pre-sign cool-off, 3,000 ms inter-chunk delay, and no send retry.
A separate post-window read-only evidence pass measured a 500.4492 ms minimum
request-start gap across 14/14 successful reads.

| Chunk | Slot | Fee | Duration | Signature / Explorer |
|---:|---:|---:|---|---|
| 234 | 477965984 | 5,000 | not persisted | [5wUXLjSq...9mXdxnV](https://explorer.solana.com/tx/5wUXLjSq3QQ3BFToUGCCSAAddpt8NNidVYJf7jwYyRh4AExySXBg3jQwDW7npuxsygGRT3erY4gFfK7MZ9mXdxnV?cluster=devnet) |
| 235 | 477966028 | 5,000 | not persisted | [2Pd7k7fM...wC6Yvzg](https://explorer.solana.com/tx/2Pd7k7fMh8ymhtn4nXKoZxoAk7ZYc78jnSBZ3hK6u3JSAhzfDL4e2tenNQUCCevA7vahNh3nT59sDurFDwC6Yvzg?cluster=devnet) |
| 236 | 477966073 | 5,000 | not persisted | [4CAUg5sE...Ds211KV](https://explorer.solana.com/tx/4CAUg5sEVwpWacjwqeyYk3ZQk7zbnPSU5FPbW7SgA94f6Wi1Fr1HNbbZkktrKfZjigQKsZ98oo4mXQSAnDs211KV?cluster=devnet) |
| 237 | 477966118 | 5,000 | not persisted | [5nGmB1VJ...FkXocxR1](https://explorer.solana.com/tx/5nGmB1VJfcrpbHp2rMwAdBWnMhNHYMQ6dR6xvpwqb4TcLjXf1wEjdLCpRrEG5BVYKakeqNKPr4DUzd4DFkXocxR1?cluster=devnet) |
| 238 | 477966164 | 5,000 | not persisted | [D6k1QqLE...F8wNvsz](https://explorer.solana.com/tx/D6k1QqLEYU5GmLWV6u4dccMndLV4dWdMah88qhPQB66vXiMLmXYvLxyvjV5aoddQmAMGtXkyaAUK9nvNF8wNvsz?cluster=devnet) |

Fresh finalized evidence proved for every signature: null transaction error,
one signature, one legacy Loader-v3 Write instruction, canonical buffer and
authority accounts, exact offset and declared length, exact payload hash, and
exact bytes in a finalized buffer snapshot. No provider-quota inference is
made from this bounded observation.

## State and balance deltas

| Evidence | Before | After | Delta |
|---|---:|---:|---:|
| `CONFIRMED` | 234 | 239 | +5 |
| `PLANNED` | 157 | 152 | -5 |
| `SENT/UNKNOWN` | 0/0 | 0/0 | 0/0 |
| Authority balance | 3,247,308,680 | 3,247,283,680 | -25,000 |
| Recent buffer history count | 15 | 20 | +5 |
| Archive count | 5 | 6 | +1 |

State SHA-256 changed from
`7d465c9bec7730b6745f731dc71556f4749dc0d6c445e5622e4dc4fb8a2d3963`
to `83b626d38931c9bd3026e5e51b7903597c8502816f547a8db9ead35a31552304`.
Buffer-data SHA-256 changed from
`6f92051d61514e91e48d20c8476393d2028d98ffb2b58152fc6519384ebba3d7`
to `83aa8fa7fdb1b3b6bc8658bdfb857ac897ad10a0964bb7739eb943e295b801ca`.
The program remained absent and chunk 239 remained `PLANNED` with a null
signature.

## Reconciliation and release

Fresh public reconciliation returned `SAFE_TO_RELEASE`, `releaseReady: true`,
and zero proposed transitions. Its evidence hash was
`6945b45889b8f980c9fe5f7734ab15e246eb9a796fb590ba5c9d0304347e338e`.
Because there were no transitions, `apply-upload-reconciliation` was not
invoked. A separately acknowledged release returned `ARCHIVED/RELEASED`,
removed the active lease, and created exactly one archive containing only the
public lease and release receipts. Reconciliation was read-only; release was a
local-only mutation. Neither performed an on-chain write.

## Verification and hygiene

Fresh local verification completed with:

- focused scheduler/uploader/reconciliation/snapshot tests: 103/103;
- full devnet tooling: 237/237;
- local-validator interruption/resume: 1/1;
- local-validator production/recovery: 1/1;
- Anchor-compatible integration: 26/26;
- Rust workspace: 11/11;
- TypeScript and both rustfmt checks: passed;
- Loader-v3 vector parity: exact 2,907-byte match; and
- optimized SBF: 395,144 bytes with the expected SHA-256.

The initial PowerShell string comparison of the vector output transformed line
endings and reported a false mismatch. A raw-byte child-process comparison
proved exact equality; no repository change was made for that harness issue.

The final publication gate must still prove only sanitized documentation is
tracked, `.devnet/` remains ignored/untracked, no signer or credential data is
present in the diff, exact-SHA CI succeeds, and the repository returns clean.

## Post-publication confirmation-telemetry correction

A source audit after R4G found `TELEMETRY_DEFECT_CONFIRMED`: the production
confirmation loop used a monotonic clock for its deadline and polling policy,
but the sequential uploader never calculated or attached the elapsed interval
to a successful chunk result. Consequently the execution window record and
sanitized CLI result had no per-chunk confirmation duration to preserve.

The correction records future finalized successes as public
`{ chunkIndex, confirmationDurationMs }` entries measured from the established
confirmation-wait boundary immediately before `confirm()` until finalized
status first returns authoritatively, rounded upward to an integer millisecond.
Each successful duration is saved atomically with its confirmed chunk and is
also retained in normal or later-error window evidence. Historical records
without this optional field remain readable. R4G remains valid, and its five
historical per-chunk durations remain explicitly unavailable rather than zero,
estimated, or synthesized.

This source/test/documentation correction did not change transaction
construction, signing, send count, retries, polling intervals, pacing,
max-window policy, reconciliation, or lease behavior. No devnet transaction
was sent during the correction.

## R4H recommendation

Retain the five-chunk ceiling and at least 900 seconds of cooldown. A future,
separately authorized window should begin with fresh proof of chunks 239-243,
fresh funding/rent/state/buffer evidence, and the same fail-closed execution and
reconciliation gates. One additional clean bounded window would still not
prove provider quota for a larger window.

`R4H LIVE WRITE NOT AUTHORIZED`.
