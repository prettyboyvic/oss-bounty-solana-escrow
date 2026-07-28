# Devnet Business-Flow Runner (governed, plan/execute separated)

A client-side runner for exercising the deployed escrow program's business flows on
devnet, with a strict separation between a **read-only PLAN mode** and an
**authorization-gated EXECUTE mode**. It does **not** change the on-chain program,
its IDL contract, PDA rules, or business logic.

- Core: `scripts/devnet/business-flow-runner.mjs`
- CLI (plan default): `scripts/devnet/business-flow-cli.mjs`
- Tests: `tests/devnet/business-flow-runner.test.mjs`,
  `business-flow-instructions.test.mjs`, `business-flow-adapter.test.mjs`,
  `business-flow-execution.test.mjs`, `business-flow-full-matrix.test.mjs`
  (top-level driver, end-to-end with fake adapter + fake clock), and
  `business-flow-cli-safety.test.mjs`

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

`executeBusinessFlows(plan, authorization, deps)` (in the runner) builds the ordered
step plan and delegates signing/sending to injected `deps.signAndSend` /
`deps.readAccount`; it enforces the ceiling, stops on the first failed send or
unexpected on-chain status, never blind-retries, and preserves partial-success
evidence. The concrete top-level driver `executeFullMatrix(...)` (in
`business-flow-execution.mjs`, see below) is what the CLI actually calls. **Neither
path is ever invoked against live devnet in this phase or in CI**; the CLI's
`execute` subcommand is fail-closed behind an explicit live acknowledgement flag.

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

## Concrete execution implementation (Phase 2 repair)

The scaffold is now backed by concrete code (still never invoked against live devnet
in CI or the repair phase):

- `scripts/devnet/business-flow-instructions.mjs` — concrete builders for the five
  escrow instructions and classic SPL asset setup (create mint @6 decimals, create
  associated token accounts, mint tokens), plus decoders for `Escrow`, mint and token
  accounts and an Anchor custom-error decoder. Account-meta order, signer/writable
  flags and discriminators are pinned against the committed IDL by tests.
- `scripts/devnet/business-flow-adapter.mjs` — production adapter over a Solana
  `Connection`: read account/balance, latest blockhash, authoritative chain time
  (`getBlockTime(getSlot)`), build+sign, send, confirm, signature status, read-only
  `simulate`, and atomic sanitized receipts. It loads only contained `.devnet`
  keypairs, rejects any signer equal to the deployment/upgrade authority, exposes no
  airdrop/fund/close surface, and never emits secret bytes.
- `scripts/devnet/business-flow-execution.mjs` — orchestrator: full transaction
  ceiling (setup 4 + flows 8 = 12; 3 read-only simulations), persistent
  execution-ID reservation (replay refusal), plan TTL freshness, immediate
  on-chain rechecks (program executable, ProgramData linkage, PDA re-derivation,
  escrow collision, sponsor balance), bounded refund expiry wait using chain time,
  post-state verification via decoders, outcome classes (`NOT_STARTED`, `RUNNING`,
  `CONFIRMED_SUCCESS`, `CONFIRMED_FAILED`, `CONFIRMATION_UNKNOWN`, `PARTIAL_SUCCESS`,
  `STOPPED_ON_STATE_MISMATCH`, `STOPPED_ON_SIMULATION`, `STOPPED_ON_EXPIRY_TIMEOUT`,
  `COMPLETE`), no blind retry, and durable evidence.
  - `runAcceptanceMatrix(...)` is the guarded context builder (freshness, replay
    reservation, on-chain recheck, ceiling, and a guarded `sendStep`).
  - `executeFullMatrix(...)` is the **top-level driver** that self-orchestrates the
    whole matrix: 4 setup sends (create+init mint, sponsor ATA, contributor ATA,
    mint tokens), then per instance the release / refund / cancel flows, running the
    three negative checks as read-only simulations at the correct states
    (fail-closed on unexpected success), waiting for refund expiry on chain time
    with a bounded timeout that stops rather than resends, verifying terminal escrow
    status and token deltas, stopping the whole matrix on the first failure (no step
    N+1), and writing a durable partial receipt that always carries the completed
    steps, the pending/unknown step, the stop reason, and the ephemeral mint public
    key. It is proven end-to-end with a fake adapter and fake clock in
    `tests/devnet/business-flow-full-matrix.test.mjs`.

The CLI `execute` subcommand builds the production adapter and calls
`executeFullMatrix`, but requires `--plan`, `--authorization` and
`--acknowledge-live-devnet-write`; without the acknowledgement it refuses (covered
by `tests/devnet/business-flow-cli-safety.test.mjs`), so no accidental devnet write
can occur. The mint is a transient generated keypair (never persisted to tracked
files); its public key is bound into the receipt for post-crash reconciliation.

Full transaction ceiling: setup is part of the same execution and is included in the
ceiling (12 live writes for all three flows); negative checks are 3 read-only
simulations. The ceiling is enforced before every send.

## Later live-acceptance phase (separately authorized)

A later session, with its own authorization, funds the identities if needed, obtains
a fresh plan, constructs an authorization bound to the plan's `manifestHash`, and
runs the bounded acceptance matrix: positive flows live, negative checks via
read-only simulation. It records every signature and pre/post account snapshot, does
not close accounts or reclaim rent, and never changes upgrade authority or the program.
