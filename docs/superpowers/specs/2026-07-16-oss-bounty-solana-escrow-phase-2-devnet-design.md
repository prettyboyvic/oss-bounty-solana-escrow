# Phase 2 Canonical Devnet Deployment Design

## Decision

Phase 2 uses one newly generated canonical program ID for source, devnet,
localnet, integration tests, and evidence tooling.

The canonical program keypair is random, devnet-only signer material. It is
stored only under the ignored `.devnet/` runtime directory. It is never copied
into CI, uploaded as an artifact, committed to Git, printed to logs, or reused
as a deterministic localnet fixture.

Localnet and CI do not need the canonical program secret. They load the same
compiled `.so` at the canonical public program ID with
`solana-test-validator --bpf-program` or Anchor `test.genesis`.

## Scope

Phase 2 will:

- deploy the escrow program to Solana devnet;
- retain and disclose a devnet-only upgrade authority;
- create a valueless classic SPL Token mint with six decimals and the display
  name `DEVTEST`;
- execute and capture an independent release flow;
- execute and capture an independent expiry-refund flow;
- capture negative authorization and early-refund failures;
- produce a sanitized, reproducible devnet evidence document;
- preserve the full localnet regression suite and Ubuntu CI.

Phase 2 will not:

- use mainnet-beta, real USDC, paid RPC credentials, an existing user wallet,
  or any asset with value;
- reuse the Phase 1 deterministic program or payer fixtures on devnet;
- revoke the upgrade authority;
- close terminal escrow or vault accounts;
- recover unsolicited dust;
- add partial payout, arbitration, fees, yield, swaps, bridges, or Token-2022;
- claim an audit, production readiness, partnership, or real payment.

## Repository and secret boundary

Before any key generation, the tracked `.gitignore` must include:

```text
.devnet/
*.devnet-keypair.json
```

The `.devnet/` directory contains:

- the devnet deployment authority;
- the canonical devnet program keypair;
- sponsor, maintainer, contributor, and mint-authority signers;
- resumable runtime state;
- raw RPC responses, transaction logs, and temporary evidence;
- downloaded onchain program bytes used for hash comparison.

No file under `.devnet/` is committed. Runtime JSON may contain public keys,
addresses, signatures, slots, timestamps, balances, and statuses, but it must
not duplicate secret key arrays into evidence records.

Commands may print public keys and transaction signatures. They must not print
seed phrases, secret key bytes, complete keypair JSON, bearer tokens, or
private RPC credentials.

The existing global Solana CLI keypair is out of scope and must not be read or
used. All write commands pass an explicit devnet RPC URL, fee payer, and signer.
The global Solana CLI configuration is not modified.

## Canonical public configuration

Implementation adds a tracked public configuration file containing:

- canonical program ID;
- `https://api.devnet.solana.com`;
- devnet genesis hash
  `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`;
- classic SPL Token Program ID
  `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`;
- display token name `DEVTEST`;
- token decimals `6`.

The canonical public program ID is synchronized in:

- `declare_id!` in the Rust program;
- `[programs.localnet]` and `[programs.devnet]` in `Anchor.toml`;
- Anchor `test.genesis`;
- the TypeScript test client and manual test IDL address;
- the Windows local-validator runner;
- program-ID verification tooling;
- deployment and evidence tooling.

A verification script compares every public copy against the public key derived
from `.devnet/`'s canonical program keypair without printing secret bytes.
Mismatch is a hard pre-deployment failure.

## Program-ID migration impact map

The migration is limited to files whose behavior depends on program identity:

- `programs/oss-bounty-escrow/src/lib.rs`
  - replace the Phase 1 `declare_id!` value;
- `Anchor.toml`
  - update localnet and devnet program mappings;
  - add a non-upgradeable local test genesis entry for the canonical address;
- `tests/helpers.ts`
  - use the canonical public program ID;
- `tests/idl.ts`
  - continue deriving its address from the test client program ID;
- `scripts/test-local.ps1`
  - preload the optimized `.so` at the canonical public address;
- `.github/workflows/ci.yml`
  - remove deterministic local program-keypair creation;
  - verify the generated IDL address;
  - run local tests without deploying a workspace keypair;
- `scripts/create-test-program-keypair.mjs`
  - remove the obsolete deterministic program-keypair fixture;
- Phase 2 safety, deployment, and evidence scripts
  - reject any program ID that differs from the canonical public config;
- README and SECURITY documentation
  - remove the obsolete claim that CI creates a deterministic program keypair.

Historical Phase 1 design and plan documents remain historical records and are
not rewritten to pretend they described the later Phase 2 identity.

## Generated IDL consistency

Before devnet deployment, program-ID verification must prove:

1. the canonical program keypair derives the expected public program ID;
2. Rust `declare_id!` equals that public ID;
3. Anchor localnet/devnet mappings and `test.genesis` equal that public ID;
4. the TypeScript client/IDL address equals that public ID;
5. the local-validator runner equals that public ID;
6. Anchor's IDL-build output reports that public ID.

Windows does not require Anchor CLI for the pre-deployment IDL address check.
The existing Anchor `idl-build` feature can emit the address through:

```text
cargo test __anchor_private_print_idl --features idl-build -- --show-output --quiet
```

Ubuntu CI runs `anchor build`, reads
`target/idl/oss_bounty_escrow.json`, and fails if its `address` differs from the
canonical public configuration.

## Localnet and Ubuntu CI design

Windows local integration continues to:

1. build the optimized SBF artifact;
2. start `solana-test-validator`;
3. preload the `.so` at the canonical public program ID with `--bpf-program`;
4. run the existing TypeScript integration suite.

Ubuntu CI:

1. installs and verifies Solana CLI 2.2.20 and Anchor CLI 0.31.1;
2. creates only the public deterministic local payer fixture;
3. runs Rust formatting and unit tests;
4. runs TypeScript typechecking;
5. runs `anchor build`;
6. verifies the generated IDL address;
7. preloads `target/deploy/oss_bounty_escrow.so` at the canonical public ID
   through Anchor `test.genesis`;
8. runs Anchor tests with build and deploy disabled. Anchor 0.31.1 uses
   `solana-test-validator` for this localnet workflow.

The intended CI command is:

```text
anchor test --skip-build --skip-deploy
```

CI does not receive, reconstruct, or require the canonical devnet program
keypair.

## Safety tooling contract

Devnet write tooling requires an explicit RPC URL argument. The default may be
the public Solana devnet RPC, but the resolved value is always printed before
any transaction.

Before writes, the tooling must:

1. reject `mainnet-beta`, mainnet URLs, testnet, and unknown clusters;
2. reject localhost unless invoked in an explicit local-test mode;
3. call `getGenesisHash`;
4. require the exact devnet genesis hash recorded above;
5. verify the classic SPL Token Program ID;
6. verify the canonical program ID;
7. verify required signer files are below `.devnet/`;
8. print only public identities and balances;
9. refuse to fall back to global Solana CLI URL or keypair configuration.

Safety validation is implemented as pure functions with failure-first tests
before the transaction orchestrator uses them.

## Runtime state and idempotency

An ignored `.devnet/state.json` records completed public operations:

- cluster identity;
- binary hash and size;
- canonical program ID;
- deploy signature and program-data address;
- actor public keys;
- mint and token account addresses;
- escrow and vault addresses;
- transaction signatures;
- observed slots, block times, decoded states, token balances, and logs.

Each operation has a check-before-send rule:

- if no state exists, build and send the operation;
- if a signature exists, query signature status and transaction metadata;
- if an address exists, fetch and validate owner, mint, authority, or escrow
  fields before reuse;
- if an escrow has advanced, resume from its decoded state;
- if an escrow is terminal, never replay settlement;
- if RPC status is uncertain, query by the already known signature before
  constructing another transaction.

The sanitized evidence document is produced from verified RPC reads, not by
committing `.devnet/state.json`.

## Build and deployment preflight

Deployment preflight requires a clean source tree except for the intentional
Phase 2 implementation changes and ignored runtime artifacts.

It records:

- source commit baseline;
- Solana CLI, Rust, Node, npm, and Anchor/CI versions;
- RPC URL, cluster version, genesis hash, epoch, and capture time;
- canonical program ID;
- optimized `.so` path, byte length, and SHA-256;
- generated IDL address;
- deployment authority public key and devnet SOL balance;
- estimated program and program-data rent;
- classic SPL Token Program ID.

The deploy command passes:

- explicit `--url devnet`;
- explicit devnet-only fee payer;
- explicit canonical program keypair;
- explicit retained upgrade authority;
- the verified optimized `.so`;
- JSON output where supported.

Deployment is not finalized and does not use `--final`.

After deployment, verification requires:

- executable program account;
- upgradeable loader ownership;
- program-data address;
- upgrade authority equal to the disclosed devnet-only authority;
- deploy or upgrade transaction signature;
- a devnet Explorer link;
- an onchain program dump whose SHA-256 matches the locally deployed `.so`.

Any binary mismatch stops Phase 2. The script does not perform a blind upgrade.

## Test mint and actors

Separate random devnet-only identities are used for:

- deployment and upgrade authority;
- canonical program keypair;
- sponsor;
- maintainer;
- contributor;
- mint authority.

The deployment authority may pay transaction fees and account rent, but role
authorization is still exercised by the dedicated sponsor and maintainer.

The test mint:

- uses the classic SPL Token Program;
- has six decimals;
- is described only as `DEVTEST`;
- has no asserted market value;
- is never called USDC;
- mints only the small amount required for the two demonstrations.

The script records the public mint address, sponsor token account, contributor
token account, mint authority, supply, decimals, and token-program owner.

## Evidence flow A: release

Flow A uses its own canonical external reference and escrow PDA.

Sequence:

1. initialize with a nonzero reference hash;
2. fetch and record `Initialized`;
3. fund the exact recorded amount;
4. record sponsor decrease, vault increase, and `Funded`;
5. submit a release signed by a non-maintainer and record the failed
   transaction signature, error, slot, Explorer link, and program logs;
6. release with the configured maintainer;
7. record the contributor's exact increase;
8. verify the principal portion of the vault is zero;
9. fetch and record `Released`.

The negative transaction is sent once. It is not retried after a confirmed
authorization failure.

## Evidence flow B: expiry refund

Flow B uses a different external reference, escrow PDA, and vault.

Sequence:

1. read the onchain clock and initialize with expiry approximately 120 seconds
   later;
2. fund the exact recorded amount;
3. submit one sponsor refund before expiry and record the confirmed failure;
4. poll onchain block time at a bounded interval;
5. print progress periodically while continuing useful state verification;
6. stop with `BLOCKED` if the configured timeout expires;
7. once observed onchain time is `>= expiry`, submit the sponsor refund;
8. record the sponsor's exact principal increase;
9. fetch and record `Refunded`;
10. record the expiry, pre-expiry failure clock, and successful refund clock.

Windows wall-clock time may be recorded as capture metadata but never decides
whether refund is allowed.

## Transaction and evidence capture

For every successful or failed transaction that reaches devnet, capture:

- signature;
- devnet Explorer URL;
- slot;
- block time;
- confirmation status and error;
- fee payer;
- relevant public accounts;
- pre/post token balances;
- relevant program log excerpts;
- decoded escrow state after the transaction when available.

The durable report is written to:

```text
docs/DEVNET_EVIDENCE_2026-07-16.md
```

It contains:

- scope and unaudited/devnet-only disclaimer;
- source baseline and evidence capture time;
- cluster identity and toolchain versions;
- program ID, binary hash, deployment signature, program-data address, and
  retained upgrade authority;
- DEVTEST mint and actor public keys;
- separate transaction tables for flow A and flow B;
- exact base-unit and display-unit deltas;
- negative-probe evidence;
- terminal decoded states;
- reproducible commands with relative paths and no secret material;
- evidence provenance and known limitations.

README receives only a short link to this report and does not make a marketing
or production-readiness claim.

## Recovery and uncertain-state handling

### Deployment succeeded but the script lost connection

Do not redeploy immediately. Query the canonical program ID with explicit
devnet RPC, verify it is executable, fetch program-data and upgrade-authority
information, dump the onchain bytes, and compare the binary hash. If those
checks pass, record deployment as recovered. If they do not, stop without
claiming success.

### Mint or token account already exists

Read the saved public address, fetch the account, and validate token-program
owner, mint, decimals, authority, and expected actor. Reuse only an exact match.
An absent, closed, or mismatched account is a hard stop; the script does not
silently substitute another address.

### A flow completed only partially

Fetch the escrow and vault directly. Resume only from a valid state-machine
edge:

- `Initialized` may fund;
- `Funded` may release before expiry or refund at/after expiry;
- `Released`, `Refunded`, and `Cancelled` are terminal and are never replayed.

Token balances and previously recorded signatures are revalidated before the
next transaction.

### RPC returned an uncertain send result

Persist the transaction signature before confirmation when possible. Query
signature status and transaction metadata with bounded retries. Do not
construct a replacement transaction until the existing signature is known to
be absent or expired without landing. A confirmed error is evidence, not a
reason to resend the same negative probe.

### Faucet rate limiting

Use a bounded number of public devnet faucet attempts with visible progress and
backoff. If the required devnet SOL is not obtained, stop with `BLOCKED`. Do not
switch to mainnet, paid RPC, a personal wallet, another credential, or an asset
with value.

### Program ID mismatch

Stop before build or deploy. Do not run `anchor keys sync` against the wrong
keypair and do not rewrite the canonical identity silently. Fix all public
references, rerun the complete regression suite, and repeat preflight.

### Binary hash mismatch

If the local optimized build changes after the recorded hash, invalidate the
deployment preflight and rebuild the evidence baseline. If an onchain dump does
not match the intended deployment binary, stop with `REVISE` or `BLOCKED`; do
not automatically upgrade.

## Regression and publication gate

Program-ID migration is accepted only when all of the following pass:

- source, Anchor.toml, public config, generated IDL, test client, runners, and
  canonical program keypair agree;
- `cargo fmt --all -- --check`;
- `cargo test --workspace`, with at least the existing 11 Rust tests passing;
- TypeScript typechecking;
- optimized SBF build;
- full Windows local-validator suite, with at least the existing 26 integration
  tests passing;
- Ubuntu `anchor build`;
- Ubuntu generated-IDL address assertion;
- Ubuntu localnet integration suite with deploy skipped;
- `git diff --check`;
- secret and private-key scan;
- ignored runtime-artifact inspection;
- direct RPC verification of executable program and terminal escrow states;
- successful opening of all recorded Explorer links on devnet;
- all five parked repositories clean at their existing audited HEADs.

Before the Phase 2 implementation commit, report exact staged paths and diff
stat. No `.devnet/`, keypair, raw runtime state, validator ledger, binary, or
secret material may be staged.

After local and devnet verification passes, create a separate Phase 2 commit:

```text
feat: add reproducible devnet escrow evidence
```

Push `main` without force and monitor Ubuntu CI to terminal success. A failed or
uncertain run is not converted into a PASS.

## Upgrade authority and terminal-account disclosure

The Phase 2 program remains upgradeable. The upgrade authority is a new,
devnet-only public identity retained under ignored local signer material. The
evidence report discloses the public authority and explicitly states that it
was not revoked.

Terminal escrow and vault accounts are not closed. Rent and unsolicited dust
may remain. Phase 2 does not add close or recovery instructions and does not
describe retained rent or dust as loss of recorded principal.

## Threat model

The design protects against:

- accidental mainnet or unknown-cluster writes;
- accidental use of the user's existing Solana keypair;
- devnet program-secret exposure through Git, CI, logs, or artifacts;
- source/binary/program-ID drift;
- blind retries after partial or uncertain transactions;
- replay of terminal settlement;
- treating Windows wall-clock time as the expiry oracle;
- presenting valueless DEVTEST as real USDC or payment;
- claiming success when faucet, RPC, deployment, or evidence is incomplete.

The design does not protect against:

- compromise of locally stored devnet-only signer files;
- malicious or unavailable public devnet RPC nodes;
- maintainer or sponsor key compromise;
- business disputes or work-quality verification;
- unaudited program defects;
- devnet resets or long-term persistence guarantees.
