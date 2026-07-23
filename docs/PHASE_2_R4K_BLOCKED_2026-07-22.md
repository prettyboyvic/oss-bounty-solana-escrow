# Phase 2 R4K Evidence-Blocked Report - 2026-07-22

## Verdict

| Boundary | Classification |
|---|---|
| On-chain upload window | `SUCCESS` |
| Local reconciliation and release | `SUCCESS` |
| Literal evidence completeness | `FAILED` |
| Success-checkpoint publication | `BLOCKED` |
| Replay authorization | `DENIED` |

R4K finalized exactly chunks 254-258 in one bounded uploader invocation. The
transactions and resulting buffer bytes succeeded, and the lease was safely
reconciled and archived. R4K is not a normal accepted success checkpoint:
required literal live timing measurements were not persisted before the
process ended. They are unavailable and are not inferred from slots, explorer
times, total confirmation durations, or configured policy.

No second invocation, retry, re-sign, resend, replacement, finalize, deploy,
close, faucet, mint, DEVTEST, or escrow flow is authorized by this report.

## Audited baseline and final state

The invocation started from clean, synchronized `main` at
`19ec0bc82615ae12b245b07566d379710adfa86a`; exact-SHA CI run
[29887813871](https://github.com/prettyboyvic/oss-bounty-solana-escrow/actions/runs/29887813871)
succeeded.

Execution `de818191-15c2-4eed-a85d-99b1a6a2197b` ran from
`2026-07-22T05:53:40.822Z` to `2026-07-22T05:55:07.376Z`, lasting 86,554 ms.
It ended at `WINDOW_LIMIT` and processed, sent, and finalized `5/5/5` chunks.
The retained aggregate reported 56/56 successful RPC requests, five sends, 35
signature-status reads, and zero rate limits or RPC errors. No later uploader
execution exists.

Final authoritative evidence is:

- 259 `CONFIRMED`, 132 `PLANNED`, zero `SENT`, and zero `UNKNOWN`;
- chunk 259 remains `PLANNED` with a null signature;
- program account remains absent;
- authority balance is 3,247,183,680 lamports;
- remaining requirement is 3,003,877,760 lamports, leaving 243,305,920
  lamports headroom;
- state SHA-256 is
  `40cc2545aeba6d1dcf9ca9d2b3f7c08b64069a8ea8773bdcb56e23c57cd08ed0`;
- buffer-data SHA-256 is
  `317701f2d9c2c548925bfd6ae02fc64ccd06478f8bd6a36c26a436c8eb61b90c`.

Fresh reconciliation ran exactly once and returned `SAFE_TO_RELEASE`,
`releaseReady: true`, and zero proposed transitions. Apply was not called.
Separately acknowledged local release returned `ARCHIVED/RELEASED` and moved
the archive count from nine to ten. Evidence hash:
`df1db2566b016a8e4c32f2aeef367c066c4884e2fc9bbea138f46eea36902148`.

## Transactions

Each transaction used one canonical Loader-v3 write, paid a 5,000-lamport fee,
and finalized successfully. The serialized transaction remained 1,231 bytes
against the 1,232-byte ceiling.

| Chunk | Slot | Persisted confirmation duration | Signature / Explorer |
|---:|---:|---:|---|
| 254 | 478022116 | 12,562 ms | [4ARXayNZ...VgeKxN](https://explorer.solana.com/tx/4ARXayNZAXPioVEdHKdguRUBiDZskwZpy6UHmMNU9Qci1ryJTQaunVkSA5jShb8QGg5ZwE8zciEA4NArM2VgeKxN?cluster=devnet) |
| 255 | 478022162 | 12,546 ms | [5dQn2pta...wvL1xC](https://explorer.solana.com/tx/5dQn2ptasYfRFWoHCfzg5vS4AJucy3UYAJTYsaeU2hUTH6pbe9g3JMxfPM3ukQLHxmpr68gLDaSmdbAMB3wvL1xC?cluster=devnet) |
| 256 | 478022208 | 12,532 ms | [4KBfnmYA...JoDoTo6](https://explorer.solana.com/tx/4KBfnmYA1dXoKupCnBUmSnW58X81VTTnp6qRanGDoeRwHorpyugp5KMnpiMGz1uY1tkdyZQTetqnuds9wJoDoTo6?cluster=devnet) |
| 257 | 478022253 | 12,551 ms | [2pgrtJCk...UdyK1W](https://explorer.solana.com/tx/2pgrtJCkGr9TNcBEofam5xjbavE3LYZ1voLGR3xsYkWnQB8U13YdKrwQraBc3qkHF11KoC8dxw7PBbDu5oUdyK1W?cluster=devnet) |
| 258 | 478022299 | 12,555 ms | [5RxGLpPx...hWP3gWHX](https://explorer.solana.com/tx/5RxGLpPxX4m3X4vuuYHcd7iLzCHVmR59LPn4yeKvZC5d9rb22JGXb51uxnTnSvRZRtVwDViUzmxNQavJhWP3gWHX?cluster=devnet) |

## Evidence completeness failure

The completed process did not persist:

- per-send start, finish, or duration for each chunk;
- actual measured pre-sign cooldown;
- actual minimum confirmation-polling gap;
- ordered live request timestamps or the actual minimum request-start gap.

Only configured policy and deterministic test enforcement survived. The
persisted per-chunk confirmation durations do not recover the missing
measurements. Consequently literal evidence completeness is `FAILED`, and a
success checkpoint cannot be published.

## R4K-R1 design decision

R4K-R1 will add an atomic, sanitized `telemetry.json` snapshot inside the
active upload-lease directory. It will persist monotonically growing evidence
at request, send, cooldown, polling, and terminal boundaries; release will move
the file with the lease archive and verify its canonical hash is unchanged.

Monotonic elapsed time is authoritative for interval compliance. ISO timestamps
are audit-only. Terminal state will retain only the evidence verdict and
canonical telemetry hash. The schema distinguishes `COMPLETE`, `INCOMPLETE`,
and legacy `UNAVAILABLE`; missing legacy evidence is never synthesized, and
the publication gate fails closed unless evidence is `COMPLETE`.

Persistence rejects any update that removes or changes already valid evidence.
Canonical hashes use deterministic field ordering over whitelist-sanitized
JSON. Private keys, seeds, signed transaction bytes, authorization headers,
credential-bearing RPC URLs, and equivalent sensitive data are forbidden.
Telemetry is local-only and cannot alter transaction construction,
instructions, accounts, signers, or serialized size.

Implementation and test results are intentionally not claimed by this report.
They require a separate R4K-R1 code commit. R4L remains unauthorized.
