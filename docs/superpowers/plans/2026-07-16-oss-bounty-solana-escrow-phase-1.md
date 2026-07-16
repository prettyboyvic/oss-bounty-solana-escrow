# OSS Bounty Escrow Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a minimal Anchor program for exact, pre-funded
classic SPL-token bounty escrow with maintainer release and expiry refund.

**Architecture:** A standalone Anchor 0.31.1 workspace owns one escrow PDA and
one token-vault PDA per sponsor/reference pair. Pure Rust rule functions provide
fast boundary coverage; Anchor integration tests verify signer, account, PDA,
and SPL-token behavior.

**Tech Stack:** Rust 2021, Anchor 0.31.1, anchor-spl 0.31.1, classic SPL Token,
TypeScript, Mocha, Solana local validator, GitHub Actions Ubuntu.

## Global Constraints

- Product name: `OSS Bounty Escrow on Solana`.
- Repository name: `oss-bounty-solana-escrow`.
- License: Apache-2.0.
- Do not copy or modify Grainlify repositories or use Grainlify branding.
- Classic SPL Token only; Token-2022 is out of scope.
- Localnet/devnet test tokens only; no mainnet or real funds.
- No partial payout, fee, arbitration, yield, swap, bridge, upgradeability, or
  automated GitHub-oracle release.
- Do not create wallets, deploy, commit, or push without separate approval.
- Release is allowed only when `now < expiry`; refund is allowed when
  `now >= expiry`.

---

### Task 1: Scaffold the isolated Anchor workspace and create the first RED rule tests

**Files:**
- Create: `.gitignore`
- Create: `Anchor.toml`
- Create: `Cargo.toml`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `programs/oss-bounty-escrow/Cargo.toml`
- Create: `programs/oss-bounty-escrow/src/lib.rs`
- Create: `programs/oss-bounty-escrow/src/rules.rs`

**Interfaces:**
- Produces `EscrowStatus` and the rule functions `can_fund`, `can_release`,
  `can_refund`, and `can_cancel`.

- [ ] Write Rust tests for valid and invalid status/time combinations before
      defining the rule functions.
- [ ] Run `cargo test --workspace` and record the expected RED caused by the
      missing rule API.
- [ ] Add the minimum enum, errors, and rule functions required to turn those
      tests GREEN.
- [ ] Run `cargo test --workspace` and record the exact passed test count.

### Task 2: Add initialization and cancellation through TDD

**Files:**
- Modify: `programs/oss-bounty-escrow/src/lib.rs`
- Create: `tests/oss-bounty-escrow.ts`
- Create: `tests/helpers.ts`

**Interfaces:**
- Produces instructions:
  `initialize_escrow(external_ref_hash, amount, expiry, maintainer, contributor)`
  and `cancel()`.
- Produces escrow and vault PDA derivation helpers.

- [ ] Add integration cases for valid initialization, zero amount, past expiry,
      default role keys, duplicate PDA, sponsor-only cancel, cancel-after-fund
      rejection, and replay rejection.
- [ ] Run the available test command and record RED. If local Anchor execution
      is unavailable, also run TypeScript compilation and label runtime RED as
      pending rather than claiming it executed.
- [ ] Implement only the escrow account, vault initialization, events, errors,
      initialization, and cancellation needed by these cases.
- [ ] Run Rust tests, TypeScript compilation, SBF build, and any available
      local integration runner.

### Task 3: Add exact funding through TDD

**Files:**
- Modify: `tests/oss-bounty-escrow.ts`
- Modify: `programs/oss-bounty-escrow/src/lib.rs`

**Interfaces:**
- Produces `fund_escrow()` transferring `Escrow.amount` from the sponsor's
  classic SPL-token account to the escrow vault.

- [ ] Add tests for exact balance delta, sponsor signature, source ownership,
      mint/vault constraints, funding at expiry, insufficient balance, and
      repeated funding.
- [ ] Run tests and record RED before adding the instruction.
- [ ] Implement the minimum `transfer_checked` CPI and state transition.
- [ ] Run the same tests and record GREEN only for commands that actually ran.

### Task 4: Add release and refund through TDD

**Files:**
- Modify: `tests/oss-bounty-escrow.ts`
- Modify: `programs/oss-bounty-escrow/src/lib.rs`

**Interfaces:**
- Produces maintainer-only `release()` and sponsor-only `refund()`.
- Both transfer exactly `Escrow.amount` using escrow PDA signer seeds.

- [ ] Add tests for release before funding, unauthorized maintainer, wrong
      contributor destination, exact payout, release at expiry, early refund,
      unauthorized refund, exact-boundary refund, replay, and conflicting
      terminal actions.
- [ ] Add a donated-extra-token case proving settlement transfers only the
      recorded obligation.
- [ ] Run tests and record RED.
- [ ] Implement the minimum release/refund CPI and state transitions.
- [ ] Run tests and record GREEN only for commands that actually ran.

### Task 5: Add Ubuntu CI and honest project documentation

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `README.md`
- Create: `SECURITY.md`
- Modify: `.gitignore`

**Interfaces:**
- CI runs format check, Rust tests, Anchor build, and Anchor integration tests
  on Ubuntu using Anchor 0.31.1.
- README documents local Windows limitations and Linux/CI verification.

- [ ] Add CI with pinned Solana and Anchor versions compatible with the
      workspace.
- [ ] Document localnet/devnet-only use, classic SPL Token scope, unaudited
      status, trust model, commands, and evidence policy.
- [ ] Run `cargo fmt --all -- --check`, `cargo test --workspace`,
      `cargo-build-sbf --workspace`, TypeScript checks, and `git diff --check`.
- [ ] Inspect `git status` in this repo and the five parked repos.
- [ ] Report blockers and do not claim Anchor integration PASS unless it
      actually ran successfully.
