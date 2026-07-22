# Phase 2 R4J Checkpoint - 2026-07-22

## Verdict

`R4J_WINDOW_PASS`

Exactly one bounded uploader invocation ran and finalized chunks 249-253. No
second invocation, retry, re-sign, resend, replacement, finalize, deploy,
close, faucet, mint, DEVTEST, or escrow flow occurred.

## Baseline and read-only preflight

Gate 0 matched `main` at
`e558dcfd226bd2be73feef5b34d40e4ec9ebaf4e`, local and freshly fetched remote
`origin/main`, ahead/behind `0/0`, clean index/worktree, and successful exact-SHA
CI run
[29886624401](https://github.com/prettyboyvic/oss-bounty-solana-escrow/actions/runs/29886624401).
The HEAD README contained current R4I status; `.devnet/` was ignored with zero
tracked paths.

Production scheduler-backed preflight used six successful read requests, zero
rate limits or RPC errors, and a 500.2333 ms minimum request-start gap. It did
not load a signer, request a blockhash, send, or mutate state. It proved:

- devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`;
- absent canonical program;
- canonical buffer, Loader-v3 owner, authority, and 395,181-byte allocation;
- 395,144-byte optimized binary with SHA-256
  `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`;
- plan fingerprint
  `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`;
- state SHA-256
  `8dacf17b86fb98ec34b32361a7b3761303ef501ea74d105177d310a7c2c4371c`;
- buffer-data SHA-256
  `585d380dcaa6b33f840396ea86a68874b1323ae8816909e558e6bfe6d935e76d`;
- 249 `CONFIRMED`, 142 `PLANNED`, zero `SENT`, and zero `UNKNOWN`;
- complete finalized confirmed prefix 0-248;
- intact R4H and R4I confirmation telemetry;
- no active lease, lock, uploader, or validator; and
- 1,473 seconds of cooldown, above the required 900 seconds.

Fresh funding was:

| Component | Lamports |
|---|---:|
| Authority balance | 3,247,233,680 |
| Remaining 142 chunk fee allowance | 1,420,000 |
| Future finalize fee allowance | 10,000 |
| Program rent | 1,141,440 |
| ProgramData rent | 2,751,406,320 |
| Operational reserve | 250,000,000 |
| Total requirement | 3,003,977,760 |
| Headroom | 243,255,920 |

Funding was `SUFFICIENT`. No finalize transaction was performed.

## Candidate proof

The plan retained 1,011-byte payloads and 1,231-byte serialized transactions.
The first five full nonmatching `PLANNED` records had null signatures:

| Chunk | Offset | Length | Payload SHA-256 |
|---:|---:|---:|---|
| 249 | 251739 | 1011 | `5a0dd450269499c33a89cf7aa77aee565004a815329fe3416cef00c39561843d` |
| 250 | 252750 | 1011 | `35e2b0a01bffe350788cc2eabf031b8491fe7bf7e2011b7bc2e67c18265db9bc` |
| 251 | 253761 | 1011 | `9e4a3f78443bf1ece292ff8b4c3b577cd613f676dd9084ac46c3f81715c9ac22` |
| 252 | 254772 | 1011 | `c6acc86a359a86bb228c46469166b5d78c296cefb4aec9d17a6e40be84b98c2d` |
| 253 | 255783 | 1011 | `60c2c26c121986fcd5dae68b31c01b90f60e703397580ec68fec5a2386407c32` |

Chunk 254 at offset 256794 was explicitly excluded and remained
`PLANNED`/null.

## Sole bounded invocation

Execution ID: `5a28f970-9f19-4724-9c47-9da148666f6d`

The invocation ran from `2026-07-22T02:58:13.591Z` to
`2026-07-22T02:59:40.015Z`, lasting 86,424 ms, and ended at `WINDOW_LIMIT`.
It processed, sent, and finalized exactly five chunks. The sanitized result
reported 56/56 successful RPC attempts, zero rate limits/errors, five
blockhash reads, five sends, and 35 status reads.

Policy remained: concurrency one, 500 ms global request-start gap, 2,000 ms
confirmation-poll floor, 2,000/5,000 ms read-only rate-limit backoffs, 3,000 ms
pre-sign cool-off and inter-chunk delay, and no send retry. Live aggregate
evidence does not retain timestamps, so no live minimum is invented. A fresh
post-window read-only pass measured 500.1320 ms across 13/13 successful reads.

| Chunk | Slot | Fee | confirmationDurationMs | Signature / Explorer |
|---:|---:|---:|---:|---|
| 249 | 477993392 | 5,000 | 12,535 | [2YM1KaMZ...s1ZoCEME](https://explorer.solana.com/tx/2YM1KaMZAkvxWJo3qVCcCcSMd4NrJ9q5jKt8NF8tpxdUvusNcgfy6eogycD3KpdqQRiRhzPAbQ46KoJLs1ZoCEME?cluster=devnet) |
| 250 | 477993439 | 5,000 | 12,709 | [377JXfts...cSdhTegf](https://explorer.solana.com/tx/377JXftsSBEZ7yuhgFcHPWCwTG82xXSFqV1YmpjQRpmktouqWVUxDiFBLmV4CC9PT44fm9juzEUQDcNncSdhTegf?cluster=devnet) |
| 251 | 477993484 | 5,000 | 12,530 | [4EYiLo92...vk2Zc9ob](https://explorer.solana.com/tx/4EYiLo921haAhEPhYFE7sYnANULv8oGfP7HHk7wTu5eUbbWRWLmWrtAffDGy4cutfzRRUMQWHiNHmi1Xvk2Zc9ob?cluster=devnet) |
| 252 | 477993529 | 5,000 | 12,545 | [3fzJ8MuK...qXMV7owQq](https://explorer.solana.com/tx/3fzJ8MuKFmuutFYNPvgtrSihdaXoroQG273aCs5FHQhf7HU9tphb2hJVWzEDcskdiAHZBexzMdAE6u2qXMV7owQq?cluster=devnet) |
| 253 | 477993575 | 5,000 | 12,543 | [64coG446...Pj53t33s](https://explorer.solana.com/tx/64coG446yA4pVByzFXtDhysa3hzdqMLqy7o8riWriRXpePATyPaCk5DhFBrppbEc6usNPJtp6c1qDKciPj53t33s?cluster=devnet) |

Every R4J duration is a persisted non-negative integer. R4H/R4I telemetry
remained intact. Historical R4G durations remain unavailable and were not
estimated or synthesized.

Fresh finalized evidence proved one signature and exactly one canonical
Loader-v3 Write per transaction, null errors, exact offsets/lengths/payload
hashes, and exact finalized bytes in snapshot slot 477993777.

## State, reconciliation, and release

| Evidence | Before | After | Delta |
|---|---:|---:|---:|
| `CONFIRMED` | 249 | 254 | +5 |
| `PLANNED` | 142 | 137 | -5 |
| `SENT/UNKNOWN` | 0/0 | 0/0 | 0/0 |
| Authority balance | 3,247,233,680 | 3,247,208,680 | -25,000 |
| Archive count | 8 | 9 | +1 |

The balance delta equals all finalized fees. State SHA-256 changed from
`8dacf17b86fb98ec34b32361a7b3761303ef501ea74d105177d310a7c2c4371c`
to `7926038de3498102e064538025c4e891aeca234b9a9f0ff29b0e16a2f6de03f5`.
Buffer-data SHA-256 changed from
`585d380dcaa6b33f840396ea86a68874b1323ae8816909e558e6bfe6d935e76d`
to `e21d4b03f38c514906d8f9361140c1364055ed288e014dbecdf357080a2822ae`.
The program remained absent and chunk 254 remained `PLANNED`/null.

Fresh reconciliation returned `SAFE_TO_RELEASE`, `releaseReady: true`, zero
transitions, and evidence hash
`bceee91246d370fe3d71d7fa8d6cc091a1cbe2f15e15855ae31cb8ac4dd2e348`.
Apply was not invoked. A separately acknowledged local-only release returned
`ARCHIVED/RELEASED`, removed the lease, and created exactly one archive.
Reconciliation was read-only; neither action performed an on-chain write.

## Verification and recommendation

Fresh local verification completed: focused safety 114/114; full devnet
244/244; local-validator 1/1 plus 1/1; integration 26/26; Rust 11/11;
TypeScript, formatting, vector parity, artifact hash, and YAML passed. Anchor
CLI/IDL are unavailable locally; exact publication-SHA Ubuntu CI remains the
authority for Anchor build, generated IDL identity, and Anchor integration.

Retain the five-chunk ceiling and at least 900 seconds cooldown. A future,
separately authorized R4K should freshly prove chunks 254-258. A higher ceiling
requires a separate read-only decision gate.

`R4K LIVE WRITE NOT AUTHORIZED`.
