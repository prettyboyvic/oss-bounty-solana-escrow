# Phase 2 R4H Checkpoint - 2026-07-22

## Verdict

`R4H_WINDOW_PASS`

Exactly one bounded uploader invocation ran and finalized chunks 239-243.
No second invocation, send retry, re-sign, resend, replacement, finalize,
deploy, close, identity regeneration, faucet request, mint, DEVTEST, or escrow
flow occurred.

## Baseline and publication gate

Gate 0 matched branch `main` at
`e0cabdca05973481a5755e0acfcbbcefaa983f2b`, local and freshly fetched remote
`origin/main`, ahead/behind `0/0`, a clean index/worktree, and successful
exact-SHA CI run
[29883024730](https://github.com/prettyboyvic/oss-bounty-solana-escrow/actions/runs/29883024730).
The current repository README contained the published R4G status. `.devnet/`
was ignored and no `.devnet` file was tracked.

## Fresh read-only preflight

The production scheduler-backed preflight used six successful read requests
with zero rate limits or RPC errors and a 504.9175 ms minimum request-start
gap. It did not load a signer, request a blockhash, invoke a write-capable
method, or mutate state. It proved:

- exact devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`;
- absent canonical program;
- canonical buffer, Loader-v3 owner, authority, and 395,181-byte allocation;
- 395,144-byte optimized binary with SHA-256
  `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`;
- plan fingerprint
  `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`;
- state SHA-256
  `83b626d38931c9bd3026e5e51b7903597c8502816f547a8db9ead35a31552304`;
- buffer-data SHA-256
  `83aa8fa7fdb1b3b6bc8658bdfb857ac897ad10a0964bb7739eb943e295b801ca`;
- 239 `CONFIRMED`, 152 `PLANNED`, zero `SENT`, and zero `UNKNOWN`;
- one finalized snapshot proving the complete confirmed prefix 0-238;
- no active lease, operation lock, uploader, or validator process; and
- 5,516 seconds of cooldown at the immediate boundary, above the required
  900 seconds.

Fresh funding was:

| Component | Lamports |
|---|---:|
| Authority balance | 3,247,283,680 |
| Remaining 152 chunk fee allowance | 1,520,000 |
| Future finalize fee allowance | 10,000 |
| Program rent | 1,141,440 |
| ProgramData rent | 2,751,406,320 |
| Operational reserve | 250,000,000 |
| Total requirement | 3,004,077,760 |
| Headroom | 243,205,920 |

The result was `SUFFICIENT`. No finalize transaction was performed.

## Candidate proof

The packet-safe plan retained a 1,011-byte payload and 1,231-byte maximum
serialized transaction. The first five full nonmatching `PLANNED` records all
had null signatures:

| Chunk | Offset | Length | Payload SHA-256 |
|---:|---:|---:|---|
| 239 | 241629 | 1011 | `3568045b56b8c26fef82c2257d9e8cc7ad3c0f3eb7a0c5ede826407fb87b7136` |
| 240 | 242640 | 1011 | `e18fc4af8a7a529e30cee001b4756ef26f432d3257e41d4df82f1a29a21d116e` |
| 241 | 243651 | 1011 | `54fe9997d3453febf4afdfd3673fdfa6fb1cc4a934bbdf5e0e65678588ef93f3` |
| 242 | 244662 | 1011 | `f2200de086b55a3de7db636c5dab5482bbcbced4fa931d31d5c0cc6047a33ac5` |
| 243 | 245673 | 1011 | `df007f5878a048cbd74a97a8890970d25b91b8b1aa56b27c9d5271a37aabf7e0` |

Chunk 244 at offset 246684 was explicitly excluded and remained `PLANNED`
with a null signature.

## Sole bounded invocation

Execution ID: `d677c357-5e3c-4b5a-9ec7-b0ba3650a070`

The invocation ran from `2026-07-22T01:44:34.937Z` to
`2026-07-22T01:46:01.510Z`, a total window duration of 86,573 ms, and ended at
`WINDOW_LIMIT`. It processed, sent, and finalized exactly five chunks. The
sanitized production result reported 56/56 successful RPC attempts, zero rate
limits, zero RPC errors, five fresh blockhash reads, five sends, and 35 status
requests.

The enforced policy was a 500 ms global request-start gap, 2,000 ms
confirmation-poll floor, 2,000/5,000 ms read-only rate-limit backoffs,
concurrency one, 3,000 ms pre-sign cool-off, 3,000 ms inter-chunk delay, and no
send retry. The aggregate live result does not retain per-request timestamps,
so it does not invent an actual live minimum-gap claim. A separate post-window
read-only evidence pass measured a 508.3760 ms minimum request-start gap across
13/13 successful reads.

| Chunk | Slot | Fee | confirmationDurationMs | Signature / Explorer |
|---:|---:|---:|---:|---|
| 239 | 477981341 | 5,000 | 12,561 | [Ypvna4LC...hhV1QAA](https://explorer.solana.com/tx/Ypvna4LCo5gZoGGsZyDVC4gkidBA8CrPkt8mwT3SP9ttsUVZ3desAUEeCfwsfAMrTf3cfAwNtsinueCqhhV1QAA?cluster=devnet) |
| 240 | 477981387 | 5,000 | 12,559 | [5JbkrawM...t4H6TLm](https://explorer.solana.com/tx/5JbkrawMEpBXHnGPdZeRCNMPgMcabpX73gT53AvCuUndab5Q7tumAUBHduc9SN2Hgc1xQ2CQMLKofLDR4t4H6TLm?cluster=devnet) |
| 241 | 477981432 | 5,000 | 12,557 | [hna5hFBq...R1nCpsD](https://explorer.solana.com/tx/hna5hFBqNPWa9x1ogXTh3r6rdHsbtmJ3o3G7ShevCWLTYnnXsYRCFhzaXn82xnfH8RnK5NcP1VqBm1WNR1nCpsD?cluster=devnet) |
| 242 | 477981478 | 5,000 | 12,563 | [4UDR5s9U...91jfAVPR](https://explorer.solana.com/tx/4UDR5s9UtfkWTrYxRnn7e3ga3xUj4nGNk62Bu1rcXnXgvNzy8U1BdA1XMtue8TiRE6iHPinZ37PpCKGW91jfAVPR?cluster=devnet) |
| 243 | 477981522 | 5,000 | 12,570 | [465Y9Et5...SkyhbAkm2](https://explorer.solana.com/tx/465Y9Et5KGpLFxVjGR7p16rUJhq6HqhE6Q2VYCmbzgs2NK75dpzukPgpdjTBmR5FtsA3KsHZHM4BFoZSkyhbAkm2?cluster=devnet) |

Each duration is a non-negative integer measured and atomically persisted for
that newly finalized R4H chunk. Historical R4G per-chunk confirmation durations
remain unavailable; they were not estimated, synthesized, or represented as
zero.

Fresh finalized evidence proved for every R4H signature: null transaction
error, one signature, one legacy Loader-v3 Write instruction, canonical buffer
and authority accounts, exact offset and declared length, exact payload hash,
and exact bytes in finalized buffer snapshot slot 477981786. No provider-quota
inference is made from this bounded observation.

## State and balance deltas

| Evidence | Before | After | Delta |
|---|---:|---:|---:|
| `CONFIRMED` | 239 | 244 | +5 |
| `PLANNED` | 152 | 147 | -5 |
| `SENT/UNKNOWN` | 0/0 | 0/0 | 0/0 |
| Authority balance | 3,247,283,680 | 3,247,258,680 | -25,000 |
| Archive count | 6 | 7 | +1 |

The 25,000-lamport balance delta equals the five finalized transaction fees.
State SHA-256 changed from
`83b626d38931c9bd3026e5e51b7903597c8502816f547a8db9ead35a31552304`
to `652dd588eba7752cf3ea35a1bff13021b59efa9795909099be0a2359832916d2`.
Buffer-data SHA-256 changed from
`83aa8fa7fdb1b3b6bc8658bdfb857ac897ad10a0964bb7739eb943e295b801ca`
to `9710f4717e6fb8fe0cbd436d08c3561d185e0516de3461df999bcc58bf2aa301`.
The program remained absent and chunk 244 remained `PLANNED` with a null
signature.

## Reconciliation and release

Fresh public reconciliation returned `SAFE_TO_RELEASE`, `releaseReady: true`,
and zero proposed transitions. Its evidence hash was
`efab9ad526a4d4314c243ccccd4aec89c99675cc74ecf41507e47033917054ad`.
Because there were no transitions, `apply-upload-reconciliation` was not
invoked. A separately acknowledged release returned `ARCHIVED/RELEASED`,
removed the active lease, and created exactly one archive containing only the
local lease and release receipts. Reconciliation was read-only; release was a
local-only mutation. Neither performed an on-chain write.

## Verification and hygiene

Fresh local verification completed with:

- focused preflight safety tests: 114/114;
- full devnet tooling: 244/244;
- local-validator interruption/resume: 1/1;
- local-validator production/recovery: 1/1;
- Anchor-compatible local integration: 26/26;
- Rust workspace: 11/11;
- TypeScript and both rustfmt checks: passed;
- Loader-v3 vector parity: exact 2,907-byte match; and
- optimized SBF: 395,144 bytes with the expected SHA-256.

Anchor CLI and generated IDL are unavailable in the local Windows environment.
The exact publication-SHA Ubuntu CI run remains the required authority for
`anchor build`, generated IDL identity, and `anchor test --skip-build`.

The final publication gate must prove only sanitized documentation is tracked,
`.devnet/` remains ignored/untracked, no signer or credential data is present
in the diff, exact-SHA CI succeeds, and the repository returns clean.

## R4I recommendation

Retain the five-chunk ceiling and at least 900 seconds of cooldown. A future,
separately authorized window should begin with fresh proof of chunks 244-248,
fresh funding/rent/state/buffer evidence, and the same fail-closed execution and
reconciliation gates. A higher ceiling requires a separate decision gate.

`R4I LIVE WRITE NOT AUTHORIZED`.
