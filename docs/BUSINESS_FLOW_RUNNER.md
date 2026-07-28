# Devnet Business-Flow Runner (governed, plan/execute separated)

A client-side runner for exercising the deployed escrow program's business flows on
devnet, with a strict separation between a **read-only PLAN mode** and an
**authorization-gated EXECUTE mode**. It does **not** change the on-chain program,
its IDL contract, PDA rules, or business logic.

- Core: `scripts/devnet/business-flow-runner.mjs`
- CLI (plan default): `scripts/devnet/business-flow-cli.mjs`
- Tests: `tests/devnet/business-flow-runner.test.mjs`

The existing local-validator integration suite (`tests/oss-bounty-escrow.ts`,
`npm run test:integration`) is unchanged in meaning and remains the authoritative
local-validator coverage.

## Design

### Plan mode (read-only, default)

`buildPlan(request, rpc)` and the CLI `plan` command:

- require the exact devnet RPC URL and reject any rpc adapter exposing a
  send/sign/airdrop method (`sendTransaction`, `sendRawTransaction`,
  `signTransaction`, `requestAirdrop`, `confirmTransaction`);
- verify the devnet genesis hash;
- read the program account, assert it is executable and owned by the upgradeable
  loader, and confirm it links to the expected ProgramData PDA;
- parse the ProgramData upgrade authority **from the on-chain account** (never from
  the stale `.devnet/state.json` `BUFFER_WRITING` label, which the runner never reads);
- assert the sponsor/maintainer/contributor identities are all distinct from the
  deployment/upgrade authority;
- derive all escrow/vault PDAs from unique external references;
- inspect identity balances and compute a funding plan (rent vs permanent fees);
- emit a canonical, hashed execution manifest, a sanitized transaction plan, the
  exact transaction ceiling, and the simulate-only negative-check list;
- report `BLOCKED_FUNDING` when the sponsor balance is below the required lamports,
  and never request an airdrop.

Plan output is passed through `sanitizePublicOutput`; no secret bytes are produced.

### Execute mode (implemented, not invoked in enablement)

`authorizeExecution(plan, authorization)` requires and cross-checks a fresh
`manifestHash`, `expectedGenesisHash` (must be devnet), `expectedProgramId`,
`executionId`, `transactionCeiling`, `enabledFlows`, per-role `identityAssertions`,
and the explicit `acknowledgeDevnet = "R4_DEVNET_BUSINESS_FLOW"`. It rejects stale
or missing values and any identity equal to the upgrade authority.

`executeBusinessFlows(plan, authorization, deps)` builds the ordered step plan and
delegates signing/sending to injected `deps.signAndSend` / `deps.readAccount`. It
enforces the ceiling, stops on the first failed send or unexpected on-chain status,
never blind-retries, and preserves partial-success evidence. **This module and its
CLI never invoke the execute path in the enablement phase**; the CLI's `execute`
subcommand is intentionally disabled and directs the operator to the separately
authorized live-acceptance session.

## Flows and negatives

Positive live flows: `release` (initialize → fund → release), `refund`
(initialize → fund → wait for on-chain expiry → refund), `cancel` (initialize →
cancel). Live-write ceilings: release 3, refund 3, cancel 2.

Negative checks are **simulate-only** by contract: `unauthorized_release`,
`refund_before_expiry`, `release_at_or_after_expiry`. They are never sent live.

## Identities, PDAs, expiry, funding

- Identities are separate devnet-only keypairs (`.devnet/sponsor|maintainer|
  contributor.devnet-keypair.json`); the deployment authority is always excluded.
- External references are `sha256("r4-business-flow:<flow>:<token>:<flow>")`,
  guaranteeing unique escrow PDAs per instance and avoiding "account already in use".
- Expiry is derived from authoritative chain time via `planExpiry(...)`: release
  escrows expire ~1 hour ahead; refund escrows use a bounded lead (default 20 s,
  minimum 10 s) with a bounded polling wait that **stops rather than resends** on
  timeout. `waitReached(...)` is a pure, unit-tested bound.
- Funding separates recoverable account rent from permanent transaction fees plus a
  safety reserve; test identities are never assumed funded and are never auto-funded.

## Later live-acceptance phase (separately authorized)

A later session, with its own authorization, funds the identities if needed, obtains
a fresh plan, constructs an authorization bound to the plan's `manifestHash`, and
runs the bounded acceptance matrix: positive flows live, negative checks via
read-only simulation. It records every signature and pre/post account snapshot, does
not close accounts or reclaim rent, and never changes upgrade authority or the program.
