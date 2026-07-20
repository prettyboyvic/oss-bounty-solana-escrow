# Phase 2 R4D-C paced buffer upload checkpoint — 2026-07-20

## Scope and safety boundary

R4D-C used the public devnet RPC and invoked the production
`upload-buffer-throttled` command exactly once. The invocation was bounded to
three chunks with a 3,000 ms inter-transaction delay. It did not finalize,
deploy, close, regenerate, fund through a faucet, create a token, or execute an
escrow flow. No second upload invocation, resend, re-sign, replacement, or
send retry occurred.

The three authorized buffer writes landed and were independently proven
finalized and byte-exact. Reconciliation returned `SAFE_TO_RELEASE` with
`releaseReady: true`, and the lease was archived locally. One scheduler timing
observation nevertheless requires focused review: the configured request-start
gap was 500 ms, while the minimum delta between retained ledger start
timestamps was 499.2464 ms. This checkpoint records that value without rounding
it up and includes no scheduler or retry-policy change.

## Baseline and paced preflight

The tracked baseline was clean at
`3ee635e06ea4fdb54d6929c51da608b2f10508c0`, equal to `origin/main` at
ahead/behind `0/0`. GitHub Actions run 29709933003 was successful. The ignored
state contained 223 `CONFIRMED`, 168 `PLANNED`, and zero `SENT/UNKNOWN`
chunks, with no active upload lease or uploader process. The elapsed time since
R4B's last buffer write was 52,406 seconds, exceeding the required 900-second
cooldown.

The fresh read-only preflight verified:

- devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`;
- program `6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z` absent;
- buffer `CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW`, upgradeable-loader owner,
  authority `Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk`, allocation 395,181;
- initial buffer-data SHA-256
  `5ead93a84d55d9eca4c33517847a20903e7a19aa9a00fa45fa0a7f8f75ce4554`
  at finalized slot 477502767;
- optimized binary length 395,144 and SHA-256
  `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`;
- plan fingerprint
  `a5e631b14da0b5d1bace51230bc992849382b25d1f327498e6a176f4b45937d6`;
- all 223 confirmed chunks from exactly one finalized buffer snapshot;
- state SHA-256
  `507432a0e941126c09757375d9602493daa9d1d6e2a5daf5675068386fa9e6c0`
  and unchanged state mtime/filesystem inventory;
- buffer history count 224 and authority balance 3,247,363,680 lamports.

The preflight ledger recorded seven successful read requests, no retry or
error, no blockhash, signer, lease, or write, and a minimum observed start gap
of 504.6598 ms. Its method counts were one genesis, two account-info (program
plus the single buffer validation snapshot), one balance, two rent, and one
signature-history request.

Fresh funding was:

| Item | Lamports |
|---|---:|
| Authority balance | 3,247,363,680 |
| Program account rent | 1,141,440 |
| ProgramData rent | 2,751,406,320 |
| 168 remaining conservative chunk fees | 1,680,000 |
| Finalize/deploy estimate | 10,000 |
| Operational reserve | 250,000,000 |
| Total required remaining balance | 3,004,237,760 |
| Headroom after reserve | 243,125,920 |

The fee estimate assumes 10,000 lamports per one-signature transaction. It is
conservative and is not a claim that finalize/deploy was authorized or run.

## Candidate and execution evidence

The planner derived maximum payload 1,011 bytes, 391 total chunks, and a
1,231-byte serialized transaction size below the 1,232-byte packet ceiling.
The first four proven nonmatching `PLANNED` chunks were inspected; only the
first three were selected:

| Index | Offset | Length | Payload SHA-256 | Selected |
|---:|---:|---:|---|---|
| 223 | 225453 | 1011 | `cfb95d2df860429105afa3e8e351571b3a2ca56ab4ecba74122c60d76ed9e83e` | yes |
| 224 | 226464 | 1011 | `7ecfb8c1ff4ac32f766d5acdc4d038697267d6c75bf26fbf321599cf2207fe9a` | yes |
| 225 | 227475 | 1011 | `5b7e584f8f5450b935ba4e00089871a4fd9f35402e5463d999c3c6642aadd64c` | yes |
| 226 | 228486 | 1011 | `315c71cc8d6989c02ab5252ddb89947608afd931d02ca7a2e40295721590ea88` | no |

The ignored authority keypair resolved to the expected public authority and
was loaded once. The production command used `maxChunks = 3`, `delayMs = 3000`,
acknowledgement `R4_BUFFER_UPLOAD`, scheduler concurrency one, configured
request gap 500 ms, read backoffs 2,000/5,000 ms, and pre-sign cool-off 3,000
ms. Supervision required the same public signature to reach `finalized` before
returning confirmation to the uploader core.

Execution ID:
`a5d5e0f4-034e-4c41-9919-0af3130de4c7`.
The command returned `WINDOW_LIMIT` with exactly three processed, sent, and
confirmed chunks: 223, 224, and 225.

| Chunk | Finalized slot | Fee | Confirmation duration | Exact instruction and buffer bytes | Explorer |
|---:|---:|---:|---:|---|---|
| 223 | 477503289 | 5,000 | 12,995.7694 ms | yes | [24Tj6R…](https://explorer.solana.com/tx/24Tj6RLcxtYBsXogz3C1F6Te1d86Bc8XTQSgsDz1FLKNDBwYFqEoKyga9NQnjYrgdY4uVK9UTbLSWvuxw7gEh3Hn?cluster=devnet) |
| 224 | 477503335 | 5,000 | 13,475.2656 ms | yes | [4izVSm…](https://explorer.solana.com/tx/4izVSmHwm8utiHJ8rnhpJ7xGpFBRRCKcF3P1NCcQE1xEeGjuk5GFRg2E5GjTgXNQmXbowDAwoE6gPAMMtj2bKrCU?cluster=devnet) |
| 225 | 477503383 | 5,000 | 12,899.7355 ms | yes | [28vuQG…](https://explorer.solana.com/tx/28vuQGCdDMW5D6RM4kbCJaFyiXGZ3fDRu8GZ3DLyhjRqAjmCjYMzFP7pHgTgMhMhFehynmF91LyWJDZXbMyiaG6S?cluster=devnet) |

Each transaction was a finalized successful legacy transaction containing one
upgradeable-loader `Write`, exactly two canonical accounts, the expected
offset, length, payload hash, and no inner instruction. A later finalized
buffer snapshot at slot 477503691 matched all three complete chunk ranges.
Observed 3,000 ms sleeps were 3,001.0428, 3,005.6032, and 3,005.5073 ms.

The live invocation ledger retained all 61 attempts: 53 `SUCCESS`, eight
`RPC_RATE_LIMITED`, and zero `RPC_ERROR`. Method counts were one genesis, five
account-info, one balance, two rent, three blockhash, three send, and 46
signature-status requests. All eight rate-limited outcomes were
`GET_SIGNATURE_STATUSES`. There were seven retry-number-1 attempts and one
retry-number-2 attempt; the bounded reads recovered. Each of the three sends
had retry number zero and occurred exactly once. The minimum retained ledger
start-timestamp delta was 499.2464 ms, below the literal 500 ms evidence
threshold; no provider-quota claim is made.

## Reconciliation and before/after evidence

The mandatory public reconciliation returned `SAFE_TO_RELEASE`,
`releaseReady: true`, zero proposed transitions, and evidence hash
`be61562d88e30db9ef9a7d1762404f9c891e52fe5ea194bf00ff6e5791e21f29`.
No reconciliation apply was needed. A fresh acknowledged local-only release
archived the lease with no on-chain write. The final archive retains lease
SHA-256 `08b0a147a57861f026758e58e7a443aee0e515115d957623923fb0e4e5a7b000`
and release SHA-256
`719672339edd08b555c300d8e74309764b0399255335564e88d9775f695d52ac`.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Confirmed chunks | 223 | 226 | +3 |
| Planned chunks | 168 | 165 | -3 |
| SENT / UNKNOWN | 0 / 0 | 0 / 0 | 0 / 0 |
| Buffer history | 224 | 227 | +3 |
| Authority balance | 3,247,363,680 | 3,247,348,680 | -15,000 |
| Active lease | absent | absent | archived |

The state changed only through the authorized uploader transitions, from
SHA-256 `507432a0e941126c09757375d9602493daa9d1d6e2a5daf5675068386fa9e6c0`
and mtime `2026-07-19T13:23:40.389Z` to
`bee372e99019b35b30d2801eb927cf343411b848ba2f99d7f89650928de62481`
and `2026-07-20T01:05:27.239Z`. Reconciliation and release did not rewrite the
state. The final buffer hash is
`e7916e8b8955675f4f900ab05cf1b58979acd3dbd5d4e3d12afb4359b9966385`;
the program remains absent.

## R4C comparison

| Metric | R4C | R4D-C |
|---|---:|---:|
| Confirmed-validation buffer reads | 224 old path | 1 |
| Max chunks | 3 | 3 |
| Transaction delay | 3000 ms | 3000 ms |
| RPC scheduler | absent | published |
| Minimum observed ledger start gap | absent | 499.2464 ms (configured 500 ms) |
| Attempted transactions | 0 | 3 |
| Rate-limited method | `METHOD_UNKNOWN` | `GET_SIGNATURE_STATUSES` |

The historical R4C method remains `METHOD_UNKNOWN`. R4D-C makes no claim about
the public provider's quota.

## Regression, hygiene, and publication boundary

Post-reconciliation local verification passed:

- focused snapshot/ledger/scheduler/uploader/reconciliation/CLI: 100/100;
- full devnet tooling: 221/221;
- state v3: 24/24; state plus migration: 29/29;
- local-validator interruption/resume and production scenarios: 1/1 + 1/1;
- local escrow integration: 26/26;
- Rust workspace: 11/11; IDL-build tests: 8/8;
- TypeScript, root/tool rustfmt, loader-vector byte parity, workflow YAML,
  program identity, `git diff --check`, and optimized SBF hash: passed.

Ignored deployment state, keypairs, binaries, lease archives, and test artifacts
remain untracked. Focused scans found only the existing negative-test canaries,
not a new credentialized RPC URL, mnemonic, private-key array, secret-bearing
path, raw RPC body, or signed transaction. The five parked repositories remain
clean at their audited heads and ahead/behind `0/0`; no uploader or validator
process remains.

Only this sanitized Markdown file is eligible for publication. The literal
499.2464 ms observation is preserved for focused scheduler timing review. R4D-C
authorization ends after this one window; this checkpoint does not authorize
another upload or any finalize/deploy/close/mint/escrow action.
