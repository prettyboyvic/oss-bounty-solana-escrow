# Phase 2-R4C second bounded upload checkpoint — 2026-07-19

Verdict: `R4C_NO_WRITE_PASS`.

R4C used exactly one bounded uploader invocation. The CLI classified its
terminal failure as `RPC_RATE_LIMITED` before any `SENT` transition or
transaction send; no raw RPC body was retained. Mandatory read-only
reconciliation found zero attempted transactions and returned
`SAFE_TO_RELEASE` with `releaseReady: true`. The R4C lease was then archived
and released locally. No retry, replacement, or second uploader invocation was
performed.

## Baseline and pre-write gates

- HEAD and `origin/main` were both
  `07091dd45c03ee6b16b7b54f9ed58f9db2bef33b`, with ahead/behind `0/0` and a
  clean tracked worktree. GitHub Actions run 29688081631 was successful for
  that exact SHA.
- The schema-v3 checkpoint had 223 `CONFIRMED`, 168 `PLANNED`, and zero
  `SENT`, `UNKNOWN`, or `FAILED` chunks. Its plan fingerprint was
  `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`.
- The optimized SBF was 395,144 bytes with SHA-256
  `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`.
- No uploader or validator process, active lease, or operation lock existed.
  Exactly one intact R4B archive existed.
- The read-only cooldown observer reported the newest prior buffer-write
  transaction finalized at slot 477359223, with block time 1784456699. The
  R4C observation was at Unix time 1784467076, giving a cooldown of 10,377
  seconds, above the 900-second gate.
- The fresh read-only preflight attested the exact devnet genesis
  `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. The canonical program was
  absent. The preserved buffer remained owned by loader-v3, retained the
  expected authority and 395,181-byte allocation, and had data SHA-256
  `5ead93a84d55d9eca4c33517847a20903e7a19aa9a00fa45fa0a7f8f75ce4554`.
- The ignored authority fixture resolved to the expected public authority.
  No private bytes or secret-bearing path was printed or recorded.

Fresh funding remained sufficient:

| Component | Lamports |
|---|---:|
| Authority balance | 3,247,363,680 |
| ProgramData rent | 2,751,406,320 |
| Program account rent | 1,141,440 |
| 168 remaining chunk fees at conservative 10,000 each | 1,680,000 |
| Finalize/deploy fee estimate | 10,000 |
| Operational reserve | 250,000,000 |
| Required remaining balance | 3,004,237,760 |
| Headroom after reserve | 243,125,920 |

The pre-write planner reported a 1,232-byte packet ceiling, 1,011-byte derived
payload, and 1,231-byte maximum serialized write transaction. Its candidate
selection used exact full-chunk comparison only:

| Chunk | Offset | Length | SHA-256 | Pre-write state | Full-byte result |
|---:|---:|---:|---|---|---|
| 223 | 225453 | 1011 | `cfb95d2df860429105afa3e8e351571b3a2ca56ab4ecba74122c60d76ed9e83e` | `PLANNED` | nonmatching |
| 224 | 226464 | 1011 | `7ecfb8c1ff4ac32f766d5acdc4d038697267d6c75bf26fbf321599cf2207fe9a` | `PLANNED` | nonmatching |
| 225 | 227475 | 1011 | `5b7e584f8f5450b935ba4e00089871a4fd9f35402e5463d999c3c6642aadd64c` | `PLANNED` | nonmatching |

Chunk 226 was the next nonmatching planned chunk and was not selected or
written. Equal-position counts were not used as progress or an upload offset.

## Single R4C observation window

The only invocation used `maxChunks = 3`, `delayMs = 3000`, fixed concurrency
1, and acknowledgement `R4_BUFFER_UPLOAD`. Its execution ID was
`5e6ffc72-447d-49b2-baa2-2037e6c15531`.

The persisted upload window ran from `2026-07-19T13:23:36.545Z` to
`2026-07-19T13:23:40.391Z`, or 3,846 ms. The operator-observed end-to-end shell
wall time, including command startup and preflight, was about 7.4 seconds. The
sanitized result was:

```text
RPC_RATE_LIMITED; retryable=false; terminal=true
```

The locally persisted terminal window status is the generic fail-closed
`EXECUTION_ERROR`. The state contains zero `SENT` or `UNKNOWN` chunks, and the
terminal upload-window record contains no processed, sent, or confirmed chunk.
The checkpoint does not claim which final read produced the rate-limit
classification or whether lazy signer loading had begun. It proves that no
public signature was persisted and no send occurred. The fresh post-window
read-only observer reported unchanged public history, balance, and buffer
bytes, independently supporting that no transaction reached the network. It
found no R4C public signatures, slots, transaction fees, or new Explorer URLs.

The sanitized mandatory reconciliation output reported:

- result and lifecycle: `SAFE_TO_RELEASE`;
- `releaseReady: true`;
- verified transactions: 0;
- proposed transitions: 0;
- state mutation: false;
- on-chain write: false;
- evidence hash:
  `f3baadca0281f358b64649cd52a8cf440609be02ee45a2541a33de95455e1c24`.

No reconciliation apply was needed or run. A fresh evidence recheck preceded
the acknowledged local release. The lease reached `ARCHIVED/RELEASED` with
`onchainWrite: false`. The new archive binds execution ID and evidence hash;
its preserved lease and receipt SHA-256 values are respectively
`afeea42eed68c6985d8f27aa8c0819b1cceb7b380af2f8951cbec88aa7765bfc`
and
`6ce6a24c009a31133b079091ae31f0770357160d8be93c9f288727868d450f03`.
The original R4B archive retained its exact lease and receipt hashes,
`4aea885748b4a8e6da4a02993011f9a9e0bad50d3efed07d60429e91623a68e4`
and
`0df21f0a398cc65d83593f5211e4148c4ce4243333add15781a6fde01eba2fb2`.

## Before and after evidence

Separate fresh read-only observers captured the following values immediately
before and after the bounded window. The history digest is SHA-256 over the
ordered public fields `signature`, `slot`, `err`, `blockTime`, and
`confirmationStatus`.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Exact confirmed chunks | 223 | 223 | 0 |
| Remaining planned chunks | 168 | 168 | 0 |
| `SENT` / `UNKNOWN` chunks | 0 / 0 | 0 / 0 | 0 / 0 |
| Buffer history count | 224 | 224 | 0 |
| Buffer history digest | `bf744c77c2d95db1530c78a2570347fe317ce47e8c7114bdf3ed91f939c417dc` | same | unchanged |
| Authority balance | 3,247,363,680 | 3,247,363,680 | 0 |
| Actual R4C transaction fees | 0 | 0 | 0 |
| Buffer account SHA-256 | `5ead93a84d55d9eca4c33517847a20903e7a19aa9a00fa45fa0a7f8f75ce4554` | same | unchanged |
| Program disposition | absent | absent | unchanged |
| Active leases | 0 | 0 | 0 |
| Archived leases | 1 | 2 | +1 local archive |

The state SHA-256 changed from
`61c889ae14dbacc432f9e03c23ac32a552ea8823bcbf3108e2604a26cbb85369`
to
`507432a0e941126c09757375d9602493daa9d1d6e2a5daf5675068386fa9e6c0`,
with the appended fail-closed terminal R4C window as the only observed semantic
state delta. Its mtime changed from 1784464797839117000 to
1784467420389248200 Unix ns. A post-window regression harness captured the
same final state hash, size, and mtime before and after the test runs.

## R4B and R4C comparison

| Metric | R4B | R4C |
|---|---:|---:|
| Maximum chunks | 5 | 3 |
| Minimum inter-send delay | 1,000 ms | 3,000 ms |
| Attempted transactions | 4 | 0 |
| Clean confirmations before uncertainty | 3 | 0 |
| RPC unknown outcome | yes | no |
| Rate-limit/raw output | sanitized classification only | `RPC_RATE_LIMITED`; no raw output |
| Actual fee per attempted transaction | 5,000 lamports | none; total 0 |

## Local verification and hygiene

Local verification passed:

- focused upload contract/lease/apply/release/sanitizer suite: 58/58;
- full devnet tooling suite: 189/189;
- state-v3 suite: 24/24; state plus migration: 29/29;
- focused lease plus apply suite: 22/22;
- throttled local-validator interruption/resume: 1/1;
- production execution recovery/resume: 1/1;
- local escrow integration: 26/26;
- Rust workspace: 11/11;
- TypeScript typecheck, root/tool rustfmt, loader-vector parity, workflow YAML,
  canonical public identity, and optimized SBF build/hash: passed.

Anchor CLI 0.31.1 was unavailable in the local shell, so publication CI remains
the authoritative environment for Anchor build, generated-IDL identity, and
the 26-case Anchor runner. The identical 26 cases passed locally using the
freshly verified optimized SBF and a local validator.

Raw RPC bodies and raw command logs are deliberately not tracked. This
document is the sanitized evidence boundary for the operator-observed live
facts; the ignored state and lease archives independently preserve the local
terminal-window and release records. The principal local checks are
reproducible with:

```text
node --test tests/devnet/upload-execution-contract.test.mjs tests/devnet/upload-execution-lease.test.mjs tests/devnet/upload-buffer-cli-safety.test.mjs tests/devnet/upload-reconciliation-apply.test.mjs tests/devnet/upload-execution-command.test.mjs
node --test tests/devnet/state.test.mjs
npm run test:devnet:unit
node --test tests/local-validator/throttled-uploader.test.mjs
node --test tests/local-validator/upload-execution-command.test.mjs
powershell -File scripts/test-local.ps1
cargo test --workspace --offline
npm run typecheck
cargo fmt --all -- --check
cargo fmt --manifest-path tools/loader-v3-vectors/Cargo.toml -- --check
cargo test __anchor_private_print_idl --package oss-bounty-escrow --features idl-build --offline -- --show-output --quiet
powershell -File scripts/build-sbf.ps1
git diff --check
```

Ignored deployment artifacts remained untracked, the secret/raw-RPC/key-array
scan passed, `git diff --check` passed, and all five parked repositories
remained clean at ahead/behind `0/0`. Only this sanitized Markdown checkpoint
is eligible for publication.

No finalize, deploy, buffer close/regeneration, faucet, mint, DEVTEST, or escrow
flow was performed on devnet. R4C authorization ends at this checkpoint; R4D
is not opened.
