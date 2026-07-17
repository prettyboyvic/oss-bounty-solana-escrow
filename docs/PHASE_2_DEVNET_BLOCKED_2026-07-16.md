# Phase 2 Devnet Blocked Checkpoint — 2026-07-16

## Verdict

`BLOCKED — faucet availability only`

Phase 2 reached its authorized devnet funding boundary, but all three bounded
public faucet requests were rate-limited. No request produced a transaction
signature and the dedicated deployment authority remains unfunded. No program
deployment, mint creation, token-account creation, or escrow transaction was
attempted.

This is not a Phase 2 PASS and is not evidence of a devnet deployment.

## Repository baseline and commit chain

Phase 2 execution started from:

```text
defa40874a4db95ec1c5b250ceffd06405b39464
```

At that point the branch was two commits ahead of `origin/main` and zero
commits behind, with a clean tracked and untracked worktree and no `.devnet/`
directory.

The durable local checkpoint chain before this report is:

```text
41ad345162fc9e75f45e11e37387ad457f2cf286 test: checkpoint resumable devnet deployment tooling
4b2571713fd982858dde166d30cb8ce9a98c012b feat: migrate escrow to canonical devnet identity
defa40874a4db95ec1c5b250ceffd06405b39464 docs: plan phase 2 devnet evidence implementation
def0d161078a893648a54d7a25d0de3838c3fe9a docs: approve canonical devnet deployment design
293f071 origin/main before the Phase 2 documentation and implementation chain
```

No existing commit was amended or rewritten.

## Canonical identities

Canonical public program ID:

```text
6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z
```

Dedicated public actor identities:

```text
Deployment authority: Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk
Sponsor:              CY5KKnfh1TdSCmm3PuwCrCL5aGLEaqm8ZHiK8Q6AqDHq
Maintainer:           7xBirdhUMsm7KEnfvx7mvUSrhVzZoJhoc4jnCurQo8S6
Contributor:          DG2kRnmBhZVAusBUfG7eGqUHNXo2rQJ3Z1PCLrUURceT
Mint authority:       7auk8apjydhbbDkwyjD3EJQopmckUMyaa1JTNp8e6fz7
```

These identities are preserved for resume. They must not be regenerated and
the canonical program ID must not be changed.

## Devnet attestation

A direct read-only RPC attestation after the blocked faucet sequence observed:

```text
RPC URL:       https://api.devnet.solana.com
Genesis hash:  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG
Slot:          476707753
Block time:    1784218082
Solana core:   4.2.0-beta.1
Feature set:   4119855713
```

The classic SPL Token Program was executable on the attested cluster. The
canonical program account was absent at the observed slot.

## Local deployment artifact

The optimized local SBF artifact was measured as:

```text
Length:  395144 bytes
SHA-256: F0820F1F06E5FFCB64026AE3C748B47B6E64674333F3CA98E8E468717C668FCD
```

No onchain executable exists, so there is no onchain raw/canonical binary
length or hash to compare.

## Faucet attempts and balance

The dedicated deployment authority started with zero balance. The only three
authorized requests were:

| Attempt | Requested devnet SOL | Outcome | Signature |
| --- | ---: | --- | --- |
| 1 | 2.0 | Public faucet rate-limit rejection | `null` |
| 2 | 1.0 | Public faucet rate-limit rejection | `null` |
| 3 | 0.5 | Public faucet rate-limit rejection | `null` |

Total requested was 3.5 devnet SOL, within the original three-attempt and
six-SOL limits. None of the requests landed. The final directly observed
deployment-authority balance was:

```text
0 lamports
```

There is no transaction signature, slot, or Explorer URL for any faucet
attempt.

## Transactions and unexecuted gates

The following were not executed:

- program deployment or ProgramData creation;
- classic SPL DEVTEST mint creation;
- sponsor or contributor token-account creation;
- DEVTEST minting;
- release-flow initialize, fund, or release transactions;
- refund-flow initialize, fund, or refund transactions;
- non-maintainer or early-refund simulations;
- onchain executable dump and binary comparison;
- sanitized successful devnet evidence generation.

No localnet transaction is represented as a devnet transaction.

## Local verification

The reconciliation checkpoint recorded:

- Rust rule/program tests: 11 passed, 0 failed;
- devnet pure/tooling unit tests: 63 passed, 0 failed;
- local-validator integration tests: 26 passed, 0 failed;
- TypeScript strict typecheck: passed;
- Rust formatting check: passed;
- optimized SBF build: passed;
- canonical IDL address extraction: matched the canonical program ID;
- `git diff --check`: passed.

These local results verify the checkpoint tooling and localnet behavior only.
They do not replace devnet deployment evidence.

## Secret and runtime boundary

All devnet signer material, runtime state, history, raw logs, binary dumps, and
future raw evidence remain under ignored `.devnet/`. The directory is protected
by tracked `.gitignore` rules and contains no tracked files.

The repository does not use a personal/global Solana wallet for Phase 2.
Tracked state and documentation contain public keys only. Runtime identities
must be preserved exactly for resume.

## Resume procedure

Phase 2-R2 must begin only after separate approval and a reasonable faucet
cooldown:

1. Preserve `.devnet/`, its state, and every existing identity.
2. Re-run exact RPC URL and genesis-hash attestation.
3. Confirm the canonical program account is still absent or classify any
   unexpected account fail-closed.
4. Read the dedicated deployment-authority balance before any request.
5. Complete and test any required CLI command that is still deliberately
   unavailable; unavailable commands currently fail closed without performing
   a devnet action.
6. Apply the separately approved R2 faucet policy without using alternate
   clusters, paid RPC, personal wallets, mainnet, testnet, or valuable assets.
7. Stop immediately when the measured deployment requirement plus the
   operational buffer is available.
8. If the new bounded attempts are exhausted, record a second honest
   `BLOCKED` checkpoint.
9. Only after funding and all preconditions pass, resume deployment,
   upgradeable-loader verification, classic DEVTEST setup, and the two
   independent escrow evidence flows.

Raw runtime evidence must remain ignored. Only sanitized, independently
verifiable evidence may be committed.

## Phase 2-R3A addendum — safe recovery from throttled deployment

The verdict above is the historical R1 checkpoint. Manual funding later made
the dedicated deployment authority sufficiently funded, but the first program
upload attempt was throttled by the public devnet RPC with HTTP/RPC `429`.
Phase 2 remains blocked pending a corrected, explicit resumable-buffer retry.
This is still not a Phase 2 PASS.

The Solana CLI invocation used for that first attempt omitted an explicit
buffer signer. Solana CLI 2.2.20 therefore created a temporary buffer signer
internally and entered its recovery-output branch after the interrupted
upload. Recovery material appeared only in ephemeral process output. It was
not saved, copied into state, committed, or repeated. The temporary buffer was
closed using its documented recovery path, its rent was returned, and the
close transaction finalized successfully with `meta.err = null` at slot
`476878150`.

Read-only reconciliation at finalized slot `476880497` observed:

```text
RPC URL:                 https://api.devnet.solana.com
Genesis hash:            EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG
Block time:              1784281393
Authority balance:       5,999,895,000 lamports
Canonical program:       absent
Closed temporary buffer: absent
Planned explicit buffer: CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW (absent onchain)
```

The funding was a manual external event through the Solana Foundation faucet;
repository tooling did not create or claim that transfer. No new funding
signature is recorded because this checkpoint did not identify one with
sufficient certainty. There is no deployment signature or deployment Explorer
URL, and no mint, token-account, or escrow transaction has occurred.

R3A corrects the deployment boundary locally:

- `.devnet/deploy-buffer.devnet-keypair.json` is a dedicated, ignored,
  devnet-only signer created silently and never tracked;
- only its public address is stored in versioned runtime state;
- write, resume, finalize, and recovery command builders always supply the
  explicit repository-managed buffer;
- partial valid buffers resume with the same signer; wrong owner, authority,
  allocation, address, binary, or uncertain state stops fail-closed;
- RPC rate limiting preserves resumable state and never regenerates the
  buffer;
- closing a buffer requires a separate explicit recovery decision.

The canonical program signer and all actor signers remain intact. No
canonical or actor key material leaked. The new explicit buffer signer was
created only after tracked ignore protection passed and has not been used in a
devnet transaction during R3A.

## Phase 2-R3B1 addendum — resumable buffer checkpoint

Verdict: `BLOCKED_WITH_RESUMABLE_BUFFER`.

R3B used the preserved explicit buffer and stopped after the approved three
write/resume attempts. All three aggregate CLI attempts ended with
`RPC_MAX_RETRIES`. No fourth attempt was made, and the buffer was not closed,
regenerated, or replaced.

The buffer creation transaction finalized successfully with `meta.err = null`
at slot `476885328`:

- buffer: `CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW`;
- creation transaction:
  `4oWuUj3V3GziWVVf4zwG6BVYwRMkja5782cbmmZWyXkdVo2out9NGu8G2EyvssAUrUSecWXy5EM1yTnoRGPDB4pZ`;
- owner: `BPFLoaderUpgradeab1e11111111111111111111111`;
- authority: `Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk`;
- allocated data length: `395181` bytes;
- state: `BUFFER_WRITING`.

A finalized read of the buffer-address history observed 60 successful
transactions and zero failed transactions. The aggregate CLI attempts did not
return one signature representing each entire upload attempt, so their
per-attempt signature fields remain `null`. No synthetic signature or Explorer
URL is used.

The full account-byte comparison does not match the 395144-byte local binary
yet. A count of equal byte positions is deliberately not reported as upload
offset or confirmed progress: unwritten buffer storage is zero-filled, and
zero bytes in that storage may equal zero bytes in the local SBF artifact.
Accordingly, `lastConfirmedProgress` remains `null` until the whole executable
matches exactly.

At the final R3B read-only checkpoint:

```text
Canonical program:              absent
Buffer state:                   BUFFER_WRITING
Authority balance:              3,248,183,680 lamports
Remaining requirement + reserve: 3,002,547,760 lamports
Funding status:                 sufficient
```

Resume must preserve the same buffer address and signer, re-attest the cluster,
query the buffer directly, and continue only in a separately approved bounded
execution window. Do not close or regenerate the buffer merely because the
public RPC throttled the upload.

No canonical deployment, ProgramData account, DEVTEST mint, token account,
escrow flow, or devnet deployment claim exists at this checkpoint. Raw process
output and ignored runtime state remain outside Git.

## Phase 2-R3C1 addendum — second bounded resume window

Verdict: `BLOCKED_WITH_RESUMABLE_BUFFER`.

R3C opened a new approved execution window against the same explicit buffer
and used exactly three write/resume attempts. All three aggregate CLI attempts
ended with `RPC_MAX_RETRIES`; no fourth attempt, buffer replacement, close, or
regeneration occurred.

The finalized buffer-address history increased to 120 successful transactions
and zero failed transactions. The latest confirmed transaction was observed at
slot `476895163`. An aggregate CLI attempt still has no single transaction
signature, so the per-attempt aggregate signature remains `null`; no signature
or Explorer URL is invented.

The final read-only reconciliation observed:

```text
Canonical program:               absent
Buffer:                          CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW
Buffer state:                    BUFFER_WRITING
Buffer owner:                    BPFLoaderUpgradeab1e11111111111111111111111
Buffer authority:                Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk
Buffer allocation:               395181 bytes
Full executable-byte match:      false
Equal byte positions:            248399 of 395144 (NOT_AN_UPLOAD_OFFSET)
Authority balance:               3,247,883,680 lamports
Remaining requirement + reserve: 3,002,547,760 lamports
Funding headroom:                 245,335,920 lamports
```

The equal-byte-position count is not an upload offset or confirmed progress;
`lastConfirmedProgress` remains `null`. No finalize, canonical deployment,
ProgramData account, DEVTEST mint, token account, or escrow-flow transaction
occurred in R3C.

Any later resume must preserve and re-query this exact buffer and its existing
repository-managed signer after fresh cluster, identity, binary, funding, and
single-writer checks. Do not close or regenerate the buffer because the public
devnet RPC throttled this bounded window.
