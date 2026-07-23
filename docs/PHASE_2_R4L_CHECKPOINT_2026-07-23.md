# Phase 2 R4L Checkpoint - 2026-07-23

## Verdict

`R4L_WINDOW_PASS`

Exactly one bounded uploader invocation finalized chunks 259-263. Live timing
telemetry was `COMPLETE`, its canonical hash matched the terminal state, and
the exact artifact survived lease archival. No second invocation, process
retry, replay, re-sign, resend, replacement, finalize, deploy, buffer close,
faucet, mint, DEVTEST, or escrow value flow occurred.

R4K remains separately and permanently evidence-blocked. R4L does not
reconstruct, replace, or change the classification of R4K evidence.

## Baseline and read-only gates

The window began from clean, synchronized `main` at
`9c59ce76ee309acc508e1aed71184cb385f45820`, with local `HEAD`,
`origin/main`, and remote main equal and ahead/behind `0/0`. Exact-SHA CI run
[29984348200](https://github.com/prettyboyvic/oss-bounty-solana-escrow/actions/runs/29984348200)
was successful. There was no Git lock or temporary object, active upload
lease, operation lock, uploader, validator, reconciler, or conflicting
state/binary file holder.

The pre-window local state SHA-256 was
`40cc2545aeba6d1dcf9ca9d2b3f7c08b64069a8ea8773bdcb56e23c57cd08ed0`.
The optimized 395,144-byte binary retained SHA-256
`f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`,
and the plan fingerprint remained
`a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.

Fresh production preflight and time/history observation used ten successful
read-only RPC calls, zero errors or rate limits, and a measured minimum
request-start gap of 502.8796 ms. They did not load a signer, request a
blockhash, send, or mutate local state. State bytes and mtime remained exact.
The observations proved:

- devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`;
- 259 `CONFIRMED`, 132 `PLANNED`, zero `SENT`, and zero `UNKNOWN`;
- chunk 259 `PLANNED` with a null signature;
- absent canonical program;
- canonical Loader-v3 buffer owner, authority, and 395,181-byte allocation;
- buffer-data SHA-256
  `317701f2d9c2c548925bfd6ae02fc64ccd06478f8bd6a36c26a436c8eb61b90c`;
- authority balance 3,247,183,680 lamports;
- authoritative on-chain time `2026-07-23T07:11:32.000Z`; and
- newest buffer write at `2026-07-22T05:54:51.000Z`, giving 91,001 seconds
  of cooldown against the 900-second requirement.

Fresh funding was `SUFFICIENT`. The remaining full funding requirement was
3,003,877,760 lamports, leaving 243,305,920 lamports of headroom after the
250,000,000-lamport operational reserve. The conservative five-chunk fee
envelope was 50,000 lamports.

## Frozen candidate proof

The exact candidate proof used state SHA, source binary identity, plan
fingerprint, ordered candidate records, excluded next record, and packet
ceiling. Its deterministic canonical SHA-256 was
`d107d883718165a4272295a38ee060554be5b4d62eda3c6f1a4ca29ea1e0bd7c`.

| Chunk | Offset | Length | Payload SHA-256 | Serialized bytes |
|---:|---:|---:|---|---:|
| 259 | 261849 | 1011 | `d8e58e147c9ef27a355d91a3b58db18611f71f4b45e9d546c95560a79f2f30b5` | 1231 |
| 260 | 262860 | 1011 | `9a77ffaed88f228517dc47c799b0eca1494841a4107153d16e807ef7e7298bb5` | 1231 |
| 261 | 263871 | 1011 | `34ead201527ec9dda78ca478027b1465217b19c4eb6ab374528a18aa2bde9ae8` | 1231 |
| 262 | 264882 | 1011 | `bbffd44eb1c425510fb32d19f68ebb3fbe31923d56202d9fb2cf40a4fffbf307` | 1231 |
| 263 | 265893 | 1011 | `60e9a430f33f29969624ec0717f98fb84b9a2f825287902efde748786e9417b1` | 1231 |

Every candidate was the next ordered full nonmatching `PLANNED` record with a
null signature and exact source payload hash. Chunk 264 at offset 266904 was
explicitly excluded and remained `PLANNED`/null. Each transaction remained
1,231 bytes against the 1,232-byte packet ceiling; transaction construction,
instruction, accounts, and signers were unchanged.

## Sole bounded invocation

Execution `c85f6349-aa34-408b-98dd-69270d128070` ran from
`2026-07-23T07:13:42.231Z` to `2026-07-23T07:15:12.681Z`, lasting 90,450 ms.
It ended at `WINDOW_LIMIT` and processed, sent, and finalized `5/5/5` chunks.
The sanitized runtime summary recorded 56/56 successful RPC requests, five
sends, 35 signature-status reads, and zero RPC errors or rate limits.

| Chunk | Slot | Fee | Confirmation | Signature / Explorer |
|---:|---:|---:|---:|---|
| 259 | 478270822 | 5000 | 12552 ms | [zLZGmk8J...KWTod9z](https://explorer.solana.com/tx/zLZGmk8JR7Zro7ey4LpBdHKFad4RueYGVdrbKgv2UxRtn4pqsMS33ugKuvq9ZnUN5cH1SJRGvD1MdxMpKWTod9z?cluster=devnet) |
| 260 | 478270868 | 5000 | 12549 ms | [39ngNEbP...twYGxhoD](https://explorer.solana.com/tx/39ngNEbP8mThrMVZGeRbMwtf9y59967bozPno24JMbx4m5h4AdsCc4BFMmVWHKJfkdZ183WkF45hXARitwYGxhoD?cluster=devnet) |
| 261 | 478270913 | 5000 | 12563 ms | [44XFY57A...DnauiZEF](https://explorer.solana.com/tx/44XFY57A9njxAPBMbQuMNdui6dF9JBwrXBCLv61jrz9D5K2KAdyuEkXNRpJs6TnVdKqqG8DKM9LN8rpRDnauiZEF?cluster=devnet) |
| 262 | 478270958 | 5000 | 12531 ms | [3B7K32mb...7KQYDV79](https://explorer.solana.com/tx/3B7K32mbFH8sCYXz73miRU8wj7bQdLe59eJEdQAvpfUPJZxQ9Zaiv3UZJTTf3syVnny38vQ9SoKSfsFh7KQYDV79?cluster=devnet) |
| 263 | 478271003 | 5000 | 12547 ms | [hQVBjxea...ew5Wfkm](https://explorer.solana.com/tx/hQVBjxeaCrpMWDUQHX2GE7H9ZjU8cd9yicQ72vjSWqJbFTWC6pZNNqab225RNdx5UBc4PmcPqPvuWCR5ew5Wfkm?cluster=devnet) |

Fresh paced transaction verification proved one signature and one canonical
Loader-v3 `Write` per transaction, exact buffer/authority accounts, exact
offset and payload bytes, null transaction error, finalized status, and no
inner instruction. The total fee and authority balance delta were both exactly
25,000 lamports.

## Live telemetry acceptance

The active lease contained a 31,752-byte atomic `telemetry.json`. Its evidence
verdict was `COMPLETE`, with no missing fields. The canonical sanitized JSON
SHA-256 was
`208feebe16685c52898c71ad988bc948f8bbd8079154de465ec1bd6153af0a02`;
recomputation matched both the artifact and terminal-state `{ verdict,
sha256 }` reference. The publication evaluator returned `publishable: true`,
and whitelist validation found no prohibited telemetry key.

Configured policy and measured evidence were:

| Evidence | Policy | Measured |
|---|---:|---:|
| Global RPC request-start gap | >= 500 ms | 500.0485 ms minimum |
| Confirmation poll gap | >= 2000 ms | 2000.0583 ms minimum |
| First pre-sign cooldown | >= 3000 ms | 3006.7133 ms |
| Inter-chunk delay | >= 3000 ms | enforced by the production window |

Each chunk had seven linked confirmation polls. Send durations were:

| Chunk | Pre-sign cooldown | Send duration |
|---:|---:|---:|
| 259 | 3006.7133 ms, required | 437.5869 ms |
| 260 | 0 ms, not applicable after initial cooldown | 484.1435 ms |
| 261 | 0 ms, not applicable after initial cooldown | 482.6088 ms |
| 262 | 0 ms, not applicable after initial cooldown | 487.0461 ms |
| 263 | 0 ms, not applicable after initial cooldown | 491.0027 ms |

The pre-archive raw file SHA-256 was
`dd18d2c1d4122f96a2fd9064d04606993b1a3d0c56e8511bde6ce704f10741e7`.
After release, the raw byte length, raw SHA-256, canonical SHA-256,
execution ID, start timestamp, and finish timestamp were unchanged.

## State, reconciliation, and release

Fresh post-window verification proved:

- 264 `CONFIRMED`, 127 `PLANNED`, zero `SENT`, and zero `UNKNOWN`;
- chunk 264 remains `PLANNED` with a null signature;
- program remains absent;
- all 264 confirmed chunks match the frozen binary exactly;
- buffer owner, authority, and 395,181-byte allocation remain valid;
- buffer-data SHA-256 is
  `79f566a6d3ec79a2afae1189097d17ca728bb0125663b13c0b7bd4a3c0861c26`;
- authority balance is 3,247,158,680 lamports; and
- post-window state SHA-256 is
  `86096abfa50e3d5bdf54cab1f11583d06293c6d2cb912563492ceca6903e794b`.

The sole explicit reconciliation command returned `SAFE_TO_RELEASE`,
`releaseReady: true`, and zero proposed transitions. Its on-chain evidence
fingerprint was
`ca3761f329e1a5e81018c0027f047325d54e8b73edc919ea2c707698e45df8f3`,
and reconciliation evidence hash was
`30c35e94d5fb0164227ec2ad40d8abcd75afe8f8415e9cff4d3c0d4f578f5438`.
Apply was not called.

Separately acknowledged local-only release returned `ARCHIVED/RELEASED`,
incremented the archive count exactly once from ten to eleven, and moved
`telemetry.json` with the lease. No active lease, operation lock, uploader,
validator, or reconciler remained. Release did not close the buffer or perform
an on-chain write.

## Verification

The post-window verification ladder passed:

- focused live-readiness telemetry/runtime suites: 89/89;
- full devnet tooling suite: 263/263;
- local-validator interruption/resume and production harnesses: 1/1 and 1/1;
- Anchor localnet integration: 26/26;
- Rust workspace tests: 11/11;
- TypeScript strict typecheck, Rust formatting, JavaScript syntax, and CI YAML;
- loader-v3 fixture parity: exact 2,907 bytes;
- optimized binary identity: exact 395,144 bytes and expected SHA-256; and
- serialized transaction regression: exact 1,231 bytes under the 1,232-byte
  ceiling.

The documentation publication commit, push, and its exact-SHA CI are separate
Git outcomes. They must be verified before this checkpoint is described as
published.
