# Phase 1.5 Repository Evidence Design

## Objective

Turn the accepted local Phase 1 checkpoint into reproducible repository and
Ubuntu CI evidence without deploying to devnet, creating a production wallet,
or using assets with value.

## Focused security correction

`external_ref_hash == [0; 32]` is rejected during initialization with a
dedicated `InvalidExternalReference` error.

The reference hash is the only onchain link to the offchain bounty identity
and is part of the escrow PDA seeds. Accepting the all-zero sentinel would let
an integration create an escrow with no meaningful reference and would collapse
all omitted references for one sponsor onto the same identity. The Solana
runtime rolls back the newly initialized escrow and vault accounts when the
instruction returns the error, so validation inside the instruction remains
atomic.

## Settlement and dust boundary

Release and refund transfer only the recorded obligation. Unsolicited classic
SPL tokens do not increase the obligation. A refund integration test must prove
that the sponsor receives exactly the principal, the dust remains in the vault,
and the escrow reaches `Refunded`.

Terminal escrow and vault accounts are not closed in this MVP. Their rent and
unsolicited dust can remain after settlement. This is a cleanup limitation, not
loss of the recorded principal. Recovery and close instructions remain outside
the submission scope.

## Dependency boundary

The JavaScript packages are used only by local scripts, TypeScript integration
tests, and CI. They are not a shipped runtime client and do not compile into the
Solana program. They should therefore be classified as `devDependencies` if
`npm ci`, typechecking, and integration tests continue to pass.

No dependency is downgraded and `npm audit fix --force` is prohibited. Advisory
evidence distinguishes the empty production dependency set from advisories in
the development/test toolchain.

## CI evidence

Ubuntu CI installs Solana CLI 2.2.20 and Anchor CLI 0.31.1, prints the Solana,
Anchor, Rust, and Node versions, and fails before build/test if the exact Solana
or Anchor versions are not active. Node is configured as major version 22.

The workflow keeps read-only repository permissions. Version tags and installer
URLs are pinned only to the versions shown; the workflow does not claim
commit-SHA pinning or broader supply-chain hardening.

## Publication boundary

The first commit is created on `main` only after local verification and staged
artifact inspection. The new public GitHub repository uses a neutral
description and contains no Grainlify code, logo, branding, partnership, or
endorsement claim. Phase 1.5 does not deploy the program.
