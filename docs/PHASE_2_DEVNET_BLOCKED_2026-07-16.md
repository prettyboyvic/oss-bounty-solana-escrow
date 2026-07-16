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
