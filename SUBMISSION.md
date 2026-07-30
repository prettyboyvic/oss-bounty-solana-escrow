# OSS Bounty Escrow on Solana

> A sponsor pre-funds a test-token reward in a Solana program vault; a maintainer releases it when work is accepted, or the sponsor recovers it after expiry.

## The Web2 problem

Contributors often begin bounty work without an independently verifiable view of whether the promised reward is funded. Even after work is accepted, payment execution can still depend on a platform or maintainer.

## The Solana escrow

This prototype makes funding and settlement rules visible onchain. A sponsor defines and funds an escrow, a maintainer authorizes release after accepting the work, and the contributor receives the reward. If the deadline passes, the sponsor can recover the funded principal; an unfunded escrow can be cancelled.

The trust boundary is deliberate: the program proves funding and enforces settlement rules, but it does not judge work quality or guarantee acceptance.

## Two-page pitch deck

[Open the required two-page pitch deck](submission/oss-bounty-escrow-pitch-deck.pdf).

## MVP prototype

The curated snapshot contains the Solana escrow program, a governed devnet business-flow runner, deterministic evidence generation, and tests covering release, refund, cancellation, authorization, timing, identity, and transaction construction.

## Three-minute reviewer path

1. Read the [two-page pitch deck](submission/oss-bounty-escrow-pitch-deck.pdf).
2. Inspect the [release/refund/cancel verification summary](docs/evidence/LIVE_VERIFICATION_REPORT.md) and [Explorer transaction index](docs/evidence/EXPLORER_INDEX.md).
3. Review the [business-flow implementation guide](docs/BUSINESS_FLOW_RUNNER.md), program source, and reproducible tests.

## Verified devnet demonstration

The accepted canonical demonstration completed 16 terminal events:

- **12 finalized SEND transactions** for setup, release, refund, and cancellation;
- **3 read-only SIMULATE checks** reproducing expected authorization and timing rejections;
- **1 bounded WAIT event** driven by observed chain time.

The evidence records `3,000,000 minted = 1,000,000 contributor + 2,000,000 sponsor`, with the recorded escrow vault principal reaching zero in each terminal flow.

## Limitations

This is an unaudited, devnet-only, test-token prototype. It is not production-ready and does not claim mainnet or real-value asset support, dispute resolution, persistence or recovery across host restarts, or production operations. Human acceptance remains outside the program.

## Technical evidence

- [Sanitized evidence manifest](docs/evidence/evidence-manifest.json)
- [Live verification report](docs/evidence/LIVE_VERIFICATION_REPORT.md)
- [Devnet Explorer index](docs/evidence/EXPLORER_INDEX.md)
- [Detailed evidence narrative](docs/evidence/SUBMISSION.md)

## Publication provenance

This snapshot is derived from reviewed source commit `5c8869f0c9901dc96b04a203a80398f159ed62d6` on top of public base `77d0994e1a101056fba75fecf1bc3ba0914d1c3d`. The [machine-readable publication provenance](submission/publication-provenance.json) records imported, sanitized, omitted, and newly created artifacts. This curated publication snapshot is available on the submission/bring-web2-onchain branch.
