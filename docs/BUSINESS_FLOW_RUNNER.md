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
- select the dependency-complete canonical event list once, derive rent, fees,
  inventory, simulations, waits, and the send ceiling from that selection, and
  allocate every lamport requirement to its exact payer identity;
- emit the selected event IDs, counts, and complete per-payer funding projection
  in the canonical hashed manifest together with a sanitized transaction plan and
  selected simulate-only negative checks;
- report `BLOCKED_FUNDING` when any payer balance is below that payer's own
  requirement, and never use another payer's excess balance or request an airdrop.

Plan output is passed through `sanitizePublicOutput`; no secret bytes are produced.

### Execute mode (implemented, not invoked in enablement)

`authorizeExecution(plan, authorization)` requires and cross-checks a fresh
`manifestHash`, `expectedGenesisHash` (must be devnet), `expectedProgramId`,
`executionId`, `transactionCeiling`, `enabledFlows`, per-role `identityAssertions`,
and the explicit `acknowledgeDevnet = "R4_DEVNET_BUSINESS_FLOW"`. It recomputes
the manifest hash, compares the public funding view with the hash-bound projection,
and rejects stale or missing values and any identity equal to the upgrade authority.

The sole public execution entry point is `executeFullMatrix(...)` in
`business-flow-execution.mjs`. It selects dependency-complete canonical events and
constructs every transaction through the canonical registry/factory. It is never
invoked against live devnet in this phase or in CI; the CLI's `execute` subcommand
is fail-closed behind an explicit live acknowledgement flag.

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
- Funding separates recoverable account rent from permanent transaction fees,
  per-identity retry reserve, and per-identity safety margin. The legacy scalar
  safety reserve maps only to the sponsor's safety margin. Sponsor, maintainer,
  contributor, and mint-authority allocations remain explicit even when zero; test
  identities are never assumed funded and are never auto-funded.

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
- `scripts/devnet/business-flow-execution.mjs` — orchestrator: canonical
  selected-event ceiling (12 sends, 3 read-only simulations, and 1 wait for the
  full canonical matrix), persistent
  execution-ID reservation (replay refusal), plan TTL freshness, immediate
  on-chain rechecks (program executable, ProgramData linkage, PDA re-derivation,
  escrow collision, each payer's balance), bounded refund expiry wait using chain time,
  post-state verification via decoders, outcome classes (`NOT_STARTED`, `RUNNING`,
  `CONFIRMED_SUCCESS`, `CONFIRMED_FAILED`, `CONFIRMATION_UNKNOWN`, `PARTIAL_SUCCESS`,
  `STOPPED_ON_STATE_MISMATCH`, `STOPPED_ON_SIMULATION`, `STOPPED_ON_EXPIRY_TIMEOUT`,
  `COMPLETE`), no blind retry, and durable evidence.
  - `executeFullMatrix(...)` is the **sole public execution driver** that
    self-orchestrates the
    whole matrix: 4 setup sends (create+init mint, sponsor ATA, contributor ATA,
    mint tokens), then per instance the release / refund / cancel flows, running the
    three negative checks as read-only simulations at the correct states
    (fail-closed on unexpected success), waiting for refund expiry on chain time
    with a bounded timeout that stops rather than resends, verifying terminal escrow
    status and token deltas, stopping the whole matrix on the first failure (no step
    N+1), and writing the single authoritative `<executionId>.matrix.json` receipt.
    Its append-only `evidence` timeline binds every lifecycle entry to the
    execution-spec hash/schema and canonical event identity. `steps`, `simulations`,
    `pendingStep`, outcome, and stop-reason fields are compatibility projections
    derived from that timeline on every receipt snapshot, not independent logs.
    The receipt also carries the deterministic seed-derived mint public key. It is
    proven end-to-end with a
    fake adapter and
    fake clock in
    `tests/devnet/business-flow-full-matrix.test.mjs`.

The CLI `execute` subcommand builds the production adapter and calls
`executeFullMatrix`, but requires `--plan`, `--authorization` and
`--acknowledge-live-devnet-write`; without the acknowledgement it refuses (covered
by `tests/devnet/business-flow-cli-safety.test.mjs`), so no accidental devnet write
can occur. The mint is deterministically derived from canonical execution identity
and created with the sponsor as the System Program seed base; no mint keypair is
generated or loaded. Its public key is bound into the receipt for post-crash
reconciliation.

Full transaction ceiling: setup is part of the same execution and is included in the
ceiling (12 live writes for all three flows); negative checks are 3 read-only
simulations. The ceiling is enforced before every send.

## Later live-acceptance phase (separately authorized)

A later session, with its own authorization, funds the identities if needed, obtains
a fresh plan, constructs an authorization bound to the plan's `manifestHash`, and
runs the bounded acceptance matrix: positive flows live, negative checks via
read-only simulation. It records every signature and pre/post account snapshot, does
not close accounts or reclaim rent, and never changes upgrade authority or the program.
