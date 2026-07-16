# Security

## Prototype status

This program is unaudited and must not be used with mainnet assets or tokens
that carry real value. Current verification covers local Rust tests, an SBF
build, and local-validator integration tests.

## Supported boundary

The prototype supports one classic SPL Token mint, one sponsor, one
maintainer, one contributor, one exact funding amount, full release, full
refund, and cancellation before funding.

It does not support:

- Token-2022 extensions;
- transfer-fee, rebasing, confidential, or otherwise nonstandard tokens;
- dispute resolution or work-quality verification;
- compromised sponsor or maintainer keys;
- GitHub identity-to-wallet verification;
- production monitoring, upgrades, or incident response.

## Important invariants

- Only the sponsor can fund, cancel, or refund its escrow.
- Only the configured maintainer can release.
- Funding and release are rejected at or after expiry.
- Refund is rejected before expiry.
- Terminal actions cannot be replayed.
- Release and refund transfer exactly the recorded amount.
- Extra vault tokens do not change the recorded obligation.

## Terminal account limitation

The MVP does not close terminal escrow or vault accounts. Rent and unsolicited
classic SPL-token dust can remain after release or refund. This does not reduce
the recorded principal transferred to the contributor or sponsor. Recovery and
account-close instructions are intentionally deferred beyond the submission
scope.

## Test-only keys

Scripts may create deterministic, public localnet-only signer material inside
ignored `.tmp/` and `target/deploy/` directories so Anchor can run local
validator tests. These keys are intentionally non-secret and must never be used
on devnet with valuable assets, mainnet, or production infrastructure.

## JavaScript dependency advisories

All JavaScript packages are classified as development dependencies because
they are used only by local scripts, TypeScript integration tests, and CI.
There is no shipped JavaScript runtime package. `npm audit --omit=dev` reports
zero advisories.

The complete development tree currently reports thirteen advisories: four
high, eight moderate, and one low. They are in the Anchor 0.31.1,
`@solana/web3.js` 1.x, SPL Token, Mocha, and transitive test-client/tooling
trees. npm's advertised changes include incompatible downgrades or semver-major
changes, and Anchor has no automatic fix. No forced audit fix or dependency
downgrade has been applied.

These packages do not compile into the Rust program bytecode. Do not reuse this
dependency set in a production web client without a separate dependency
upgrade and security review.

## Reporting

Do not publish active private keys, deployment credentials, or exploitable
mainnet details in a public issue. This prototype currently has no production
security contact; use a private repository contact channel before any real
deployment.
