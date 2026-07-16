# OSS Bounty Escrow on Solana — Design

## Product

OSS Bounty Escrow on Solana is a neutral, standalone prototype for pre-funded
open-source work. A sponsor records a bounty reference, exact SPL-token amount,
maintainer, contributor, and expiry. The sponsor funds a program-owned vault.
The maintainer may release the recorded amount before expiry; at or after
expiry, the sponsor may refund the recorded amount.

The project is not affiliated with Grainlify. Grainlify may be mentioned only
as prior contributor experience with GitHub bounty workflows or as a possible
future integration target. No Grainlify code, branding, logo, partnership, or
endorsement is used.

## Honest founder-market fit

The submitter has firsthand experience finding, claiming, completing, and
submitting open-source bounties. That experience includes unclear requirements,
maintainer-dependent acceptance, competition for the same work, and payout
execution that depends on a platform or maintainer. The submitter has also built
and tested Solana escrow and yield-adapter code. The project makes no claim of
customers, revenue, production usage, audit coverage, mainnet readiness, or
Grainlify ownership.

## Scope

The program supports one classic SPL Token mint per escrow and exactly five
instructions:

1. `initialize_escrow`
2. `fund_escrow`
3. `release`
4. `refund`
5. `cancel`

It does not support partial payouts, fees, arbitration, yield, swaps, bridges,
Token-2022, upgradeability, automated GitHub-oracle release, mainnet deployment,
or real-value assets.

## State machine

```text
Initialized -> Funded -> Released
Initialized -> Cancelled
Funded -> Refunded, when now >= expiry
```

`release` requires `now < expiry`. At the exact expiry timestamp, release is
rejected and refund is allowed.

## Accounts and identity

The escrow PDA uses:

```text
["escrow", sponsor_pubkey, external_ref_hash]
```

The vault token account PDA uses:

```text
["vault", escrow_pubkey]
```

`external_ref_hash` is a 32-byte SHA-256 digest of a canonical offchain bounty
reference. Readable GitHub URLs remain offchain.

The `Escrow` account stores:

- sponsor
- maintainer
- contributor
- mint
- vault
- external reference hash
- exact amount in token base units
- creation timestamp
- expiry timestamp
- status
- escrow bump
- vault bump

## Authority and token rules

- The sponsor signs initialization, exact funding, cancellation, and refund.
- The maintainer signs release.
- The contributor is the owner of the release destination token account.
- Funding transfers exactly the recorded amount.
- Release and refund transfer exactly the recorded amount, not the vault's
  current balance.
- Unsolicited extra tokens do not increase the recorded obligation and do not
  block settlement. Vault cleanup is deliberately out of scope.
- Funding is rejected at or after expiry.
- Terminal states cannot be replayed.

The backend or a future GitHub integration never holds a payout authority key.
A merged pull request may inform the UI, but release remains an explicit
maintainer-signed transaction.

## Threat model

The MVP protects against:

- unauthorized funding, release, refund, or cancellation;
- wrong mint, vault, source owner, or destination owner;
- duplicate escrow identity for the same sponsor and reference hash;
- underfunded release;
- early refund;
- release at or after expiry;
- terminal action replay;
- arithmetic overflow in amount and time validation;
- unsolicited vault token griefing changing the recorded payout.

The MVP does not solve:

- dishonest maintainer acceptance decisions;
- compromised sponsor or maintainer keys;
- GitHub identity-to-wallet verification;
- disputes over work quality;
- malicious or nonstandard token mints;
- production operations, monitoring, audit, or legal compliance.

## Test strategy

Rust unit tests exercise state-transition and boundary rules directly on
Windows. Anchor integration tests exercise PDA creation, SPL-token transfers,
account constraints, signer constraints, replay safety, and exact token deltas.

Windows verification uses installed Rust, Solana CLI, local validator, and
`cargo-build-sbf`. Anchor CLI is not installed locally. Ubuntu GitHub Actions
installs Anchor 0.31.1 and runs formatting, Rust tests, SBF/Anchor build, and
Anchor integration tests.

Only localnet and devnet test tokens are allowed. Deployment, wallet creation,
commit, and push require separate approval.

## Acceptance

Gate 1 is satisfied only when:

- every intended rule was first represented by a failing test;
- Rust tests pass;
- the program builds for SBF;
- Anchor integration tests pass in an environment that actually ran them;
- formatting and diff checks pass;
- no unrelated repository changed;
- README and CI accurately distinguish verified evidence from pending evidence.
