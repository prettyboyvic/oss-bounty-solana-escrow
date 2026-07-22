# Phase 2 R4I Checkpoint - 2026-07-22

## Verdict

`R4I_WINDOW_PASS`

Exactly one bounded uploader invocation ran and finalized chunks 244-248. No
second invocation, send retry, re-sign, resend, replacement, finalize, deploy,
close, identity regeneration, faucet request, mint, DEVTEST, or escrow flow
occurred.

## Baseline and read-only preflight

Gate 0 matched branch `main` at
`2c4c37b2bd4ae20d5a99edc988fa9d3f316d2bcc`, local and freshly fetched remote
`origin/main`, ahead/behind `0/0`, a clean index/worktree, and successful
exact-SHA CI run
[29884570754](https://github.com/prettyboyvic/oss-bounty-solana-escrow/actions/runs/29884570754).
The repository README contained the published R4H status. `.devnet/` was
ignored and no `.devnet` path was tracked.

The production scheduler-backed preflight used six successful read requests,
zero rate limits or RPC errors, and a 504.5260 ms minimum request-start gap. It
did not load a signer, request a blockhash, invoke a write-capable method, or
mutate state. It proved:

- exact devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`;
- absent canonical program;
- canonical buffer, Loader-v3 owner, authority, and 395,181-byte allocation;
- 395,144-byte optimized binary with SHA-256
  `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`;
- plan fingerprint
  `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`;
- state SHA-256
  `652dd588eba7752cf3ea35a1bff13021b59efa9795909099be0a2359832916d2`;
- buffer-data SHA-256
  `9710f4717e6fb8fe0cbd436d08c3561d185e0516de3461df999bcc58bf2aa301`;
- 244 `CONFIRMED`, 147 `PLANNED`, zero `SENT`, and zero `UNKNOWN`;
- complete finalized confirmed prefix 0-243;
- intact R4H confirmation durations for chunks 239-243;
- no active lease, operation lock, uploader, or validator process; and
- 2,723 seconds of cooldown, above the required 900 seconds.

Fresh funding was:

| Component | Lamports |
|---|---:|
| Authority balance | 3,247,258,680 |
| Remaining 147 chunk fee allowance | 1,470,000 |
| Future finalize fee allowance | 10,000 |
| Program rent | 1,141,440 |
| ProgramData rent | 2,751,406,320 |
| Operational reserve | 250,000,000 |
| Total requirement | 3,004,027,760 |
| Headroom | 243,230,920 |

The result was `SUFFICIENT`. No finalize transaction was performed.

## Candidate proof

The packet-safe plan retained a 1,011-byte payload and 1,231-byte maximum
serialized transaction. The first five full nonmatching `PLANNED` records all
had null signatures:

| Chunk | Offset | Length | Payload SHA-256 |
|---:|---:|---:|---|
| 244 | 246684 | 1011 | `6ebbc4564b16c033328a694d5b7e795a7d2933666a185169c2aba47d1b0d85e7` |
| 245 | 247695 | 1011 | `a3e1f882eb029d48c901837c5f7d3cf8261d9eaf636682a4036f15c5af28febd` |
| 246 | 248706 | 1011 | `097769041462a797c51ee3ff40a3e39befd77d2db5c8789b57cb411f6ea207ce` |
| 247 | 249717 | 1011 | `5cccae999cf78dac2503aa38216119d1f90f6650a2d2299ad679c7db1d1a2797` |
| 248 | 250728 | 1011 | `f6c2462fe1937b3301500220989cd117aa4bfc4064ef0ae9445f98a054874c4c` |

Chunk 249 at offset 251739 was explicitly excluded and remained `PLANNED`
with a null signature.

## Sole bounded invocation

Execution ID: `3f303c05-a4d0-4b35-988a-be097c4829ec`

The invocation ran from `2026-07-22T02:31:49.461Z` to
`2026-07-22T02:33:15.960Z`, a total window duration of 86,499 ms, and ended at
`WINDOW_LIMIT`. It processed, sent, and finalized exactly five chunks. The
sanitized result reported 56/56 successful RPC attempts, zero rate limits,
zero RPC errors, five blockhash reads, five sends, and 35 status requests.

The enforced policy was a 500 ms global request-start gap, 2,000 ms
confirmation-poll floor, 2,000/5,000 ms read-only rate-limit backoffs,
concurrency one, 3,000 ms pre-sign cool-off, 3,000 ms inter-chunk delay, and no
send retry. The live aggregate does not retain per-request timestamps, so no
actual live minimum gap is invented. A separate post-window read-only pass
measured a 500.2815 ms minimum gap across 13/13 successful reads.

| Chunk | Slot | Fee | confirmationDurationMs | Signature / Explorer |
|---:|---:|---:|---:|---|
| 244 | 477989074 | 5,000 | 12,552 | [5aUyz5oy...8LTKGw2z](https://explorer.solana.com/tx/5aUyz5oyU5qceV9YVudyApzFgNvzw7B3ivQENTySVhaSExMWVbNhLo76EAxNdWXH8NSLMeBzcbwDnNof8LTKGw2z?cluster=devnet) |
| 245 | 477989120 | 5,000 | 12,569 | [24ygMg1o...tcZRW51AF](https://explorer.solana.com/tx/24ygMg1o7SrNccRwbCgxq1ZeLSE1WJKnyqnLVmkQeAMYmMuRk7QZfuRNuPrrte1Vkdzo4iBgTccE6eXtcZRW51AF?cluster=devnet) |
| 246 | 477989166 | 5,000 | 12,542 | [9Npz5WUu...YeLm2uUL](https://explorer.solana.com/tx/9Npz5WUuJPtoMF4znWZqjYPeWvFBN7SRfaw4gZJaxPyYcLhaFnZY2SzT5dEHgjHA8FbVvt6PkEvXSoUYeLm2uUL?cluster=devnet) |
| 247 | 477989210 | 5,000 | 12,555 | [LsZiyzpV...3ygL4iUX](https://explorer.solana.com/tx/LsZiyzpVboaWHBWRpZmPGHf7sRTtF6p8hcWSt742zeJYmhbA6S42BcTMubxabm5EQiyv29VwMU5VH7G3ygL4iUX?cluster=devnet) |
| 248 | 477989256 | 5,000 | 12,551 | [4ZTtfTSk...U7XhLNyg](https://explorer.solana.com/tx/4ZTtfTSkyPvotnYKD5av5cV7DjviHWV831C9e8wpGpzbNXVEs6JjwJb9snrXDEPabG55RWFo62Pj6T63U7XhLNyg?cluster=devnet) |

Each R4I duration is a persisted non-negative integer. R4H durations remained
intact. Historical R4G durations remain unavailable and were not estimated,
synthesized, or represented as zero.

Fresh finalized evidence proved for every R4I signature: null transaction
error, one signature, one legacy Loader-v3 Write instruction, canonical buffer
and authority accounts, exact offset, length, payload hash, and exact bytes in
finalized buffer snapshot slot 477989487.

## State, balance, reconciliation, and release

| Evidence | Before | After | Delta |
|---|---:|---:|---:|
| `CONFIRMED` | 244 | 249 | +5 |
| `PLANNED` | 147 | 142 | -5 |
| `SENT/UNKNOWN` | 0/0 | 0/0 | 0/0 |
| Authority balance | 3,247,258,680 | 3,247,233,680 | -25,000 |
| Archive count | 7 | 8 | +1 |

The balance delta equals the five finalized transaction fees. State SHA-256
changed from
`652dd588eba7752cf3ea35a1bff13021b59efa9795909099be0a2359832916d2`
to `8dacf17b86fb98ec34b32361a7b3761303ef501ea74d105177d310a7c2c4371c`.
Buffer-data SHA-256 changed from
`9710f4717e6fb8fe0cbd436d08c3561d185e0516de3461df999bcc58bf2aa301`
to `585d380dcaa6b33f840396ea86a68874b1323ae8816909e558e6bfe6d935e76d`.
The program remained absent and chunk 249 remained `PLANNED`/null.

Fresh reconciliation returned `SAFE_TO_RELEASE`, `releaseReady: true`, and
zero proposed transitions. Its evidence hash was
`193b2e1c22cb267100a2725f5c031601d6ff8581ee2b5a73c5bf758b488c94b6`.
Apply was not invoked. Separately acknowledged release returned
`ARCHIVED/RELEASED`, removed the active lease, and created exactly one local
archive. Reconciliation was read-only and release was local-only; neither
performed an on-chain write.

## Verification and hygiene

Fresh local verification completed with:

- focused preflight safety tests: 114/114;
- full devnet tooling: 244/244;
- local-validator interruption/resume: 1/1;
- local-validator production/recovery: 1/1;
- Anchor-compatible local integration: 26/26;
- Rust workspace: 11/11;
- TypeScript and formatting checks: passed;
- Loader-v3 vector parity: exact 2,907-byte match; and
- optimized SBF: 395,144 bytes with the expected SHA-256.

Anchor CLI and generated IDL are unavailable in the local Windows environment.
The exact publication-SHA Ubuntu CI run remains the required authority for
Anchor build, generated IDL identity, and Anchor integration.

## R4J recommendation

Retain the five-chunk ceiling and at least 900 seconds of cooldown. A future,
separately authorized window should begin with fresh proof of chunks 249-253
and the same fail-closed gates. A higher ceiling requires a separate decision.

`R4J LIVE WRITE NOT AUTHORIZED`.
