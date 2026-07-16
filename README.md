# OSS Bounty Escrow on Solana

OSS Bounty Escrow on Solana is a neutral prototype for pre-funded open-source
work. It locks an exact classic SPL-token amount, lets the configured
maintainer release that amount before expiry, and lets the sponsor recover it
at or after expiry.

This repository is not affiliated with Grainlify or any bounty platform. It
does not use Grainlify code, branding, logos, or endorsements.

## Scope

The program implements:

- `initialize_escrow`
- `fund_escrow`
- `release`
- `refund`
- `cancel`

State transitions:

```text
Initialized -> Funded -> Released
Initialized -> Cancelled
Funded -> Refunded, when now >= expiry
```

At the exact expiry timestamp, release is rejected and refund is allowed.

The MVP intentionally excludes partial payout, fees, arbitration, yield,
swaps, bridges, Token-2022, upgradeability, automatic GitHub-triggered payout,
mainnet deployment, and real-value assets.

## Trust model

- Sponsor signs initialization, funding, cancellation, and refund.
- Maintainer signs release.
- GitHub or an integration backend may display PR state, but it is not treated
  as a trustless oracle.
- The contract transfers the recorded amount, not the vault's full balance.
  Unsolicited extra tokens therefore do not change the payout obligation.

Terminal escrow and vault accounts are not closed in this MVP. Account rent
and unsolicited token dust can therefore remain after release or refund. The
recorded principal is still transferred exactly; retained rent or dust is a
cleanup limitation, not loss of the principal. A recovery/close instruction is
deferred beyond the submission scope.

## PDA layout

```text
escrow = ["escrow", sponsor, sha256(canonical_external_reference)]
vault  = ["vault", escrow]
```

Readable issue and pull-request URLs remain offchain. Only the fixed 32-byte
reference hash is stored in the escrow account.

## Current verification

Verified locally on Windows:

- `cargo test --workspace`: 11 passed, 0 failed.
- TypeScript strict typecheck: passed.
- Optimized `sbf-solana-solana` build: passed.
- Local validator integration suite: 26 passed, 0 failed.

The GitHub Actions workflow is configured to install Solana 2.2.20 and Anchor
0.31.1, print the active Solana, Anchor, Rust, and Node versions, fail if the
Solana or Anchor versions differ, then run `anchor build` and `anchor test`. It
must not be described as passing until an actual GitHub Actions run succeeds.
The version numbers are pinned, but action references and installer sources are
not pinned to immutable commit hashes; this is not a claim of comprehensive
supply-chain hardening.

## Windows workflow

Requirements already used for local verification:

- Rust/Cargo
- Node.js and npm
- Solana CLI 2.2.20 with platform tools

Anchor CLI is not required on Windows for the verified local path. Windows
uses the Rust unit tests, Solana 2.2.20's platform Cargo for the optimized SBF
build, and `solana-test-validator` for integration tests. Ubuntu CI is the
canonical environment for `anchor build` and `anchor test` with Anchor 0.31.1.

Install project dependencies:

```powershell
npm ci
```

Run Rust tests:

```powershell
cargo test --workspace
```

Build the SBF artifact with the installed Solana platform Cargo:

```powershell
.\scripts\build-sbf.ps1
```

Run the full local validator suite:

```powershell
.\scripts\test-local.ps1
```

The local runner:

- loads the built `.so` directly into `solana-test-validator`;
- uses an in-memory payer derived from a public test seed;
- preloads only valueless localnet lamports;
- creates no user-controlled wallet or private production credential;
- stops the validator after the test run.

## Anchor / Ubuntu workflow

CI creates one public, deterministic localnet payer identity represented by:

- a system account fixture with valueless localnet lamports;
- an ignored Anchor provider signer file under `.tmp/`.

The canonical program secret is never provided to CI. `anchor build` produces
the `.so` and generated IDL, CI verifies the IDL address, and Anchor
`test.genesis` preloads the binary at the canonical public program ID before
running tests with deployment skipped.

The local payer seed is public and must never be reused for devnet assets with
value, mainnet, custody, or any production deployment. Random devnet-only
signers live under ignored `.devnet/` and are never committed.

## Dependency compatibility

`Cargo.lock` intentionally pins several transitive dependencies to versions
compatible with the Rust 1.84 platform toolchain shipped with Solana CLI
2.2.20. Do not update the lockfile blindly; rerun the SBF build after any
dependency change.

All JavaScript packages are development dependencies used by local scripts,
TypeScript integration tests, or CI. There is no published JavaScript runtime
package or production dependency set in this repository. `npm audit
--omit=dev` reports zero advisories; the complete development tree retains
known advisories documented in [SECURITY.md](SECURITY.md).

## Status and limitations

This is an unaudited prototype for localnet and later devnet test-token
demonstration only. It has not been deployed to mainnet, does not handle real
funds, and provides no legal, compliance, or security guarantee.

See [SECURITY.md](SECURITY.md) for the security boundary.

## License

Apache-2.0.
