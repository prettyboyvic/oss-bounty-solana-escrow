# Phase 2 Devnet Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the escrow program under one canonical devnet program ID, run reproducible release and expiry-refund demonstrations with valueless classic SPL tokens, and publish sanitized, independently verifiable evidence without exposing signer material.

**Architecture:** A tracked public configuration records the expected devnet identity while all signer files and raw runtime state stay under ignored `.devnet/`. Pure Node.js modules validate cluster safety, program-ID consistency, state recovery, evidence classification, and binary comparison before a command orchestrator is allowed to write to devnet. Localnet and CI preload the canonical `.so` at its public ID and never receive the canonical devnet program secret.

**Tech Stack:** Rust 2021, Anchor 0.31.1, Solana CLI 2.2.20, classic SPL Token Program, `@coral-xyz/anchor` 0.31.1, `@solana/web3.js` 1.98.4, `@solana/spl-token` 0.4.13, Node.js built-in test runner, PowerShell on Windows, GitHub Actions Ubuntu.

## Global Constraints

- Baseline design commit: `def0d161078a893648a54d7a25d0de3838c3fe9a`.
- Devnet RPC: `https://api.devnet.solana.com`.
- Required devnet genesis hash: `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.
- Classic SPL Token Program only: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`.
- `DEVTEST` is an offchain/documentation label only. A classic SPL Mint has no token-name field.
- Do not add Metaplex metadata, metadata-program calls, Token-2022 metadata, or another naming subsystem.
- Six token decimals; no real USDC and no asset with value.
- DEVTEST is an offchain/documentation label; it is not an onchain classic SPL
  Mint name.
- No mainnet-beta, testnet, paid RPC, existing user wallet, personal credential, or global Solana CLI fallback.
- The canonical program keypair and all actor signers live only under ignored `.devnet/`.
- Never print seed phrases, secret arrays, complete keypair JSON, or private credentials.
- Do not revoke the upgrade authority in Phase 2.
- Do not add terminal-account close or dust-recovery instructions.
- Do not modify the five parked repositories.
- Do not amend or rewrite commits `59ec326`, `293f071`, or `def0d161`.
- Do not push until the full publication gate passes.
- Negative-probe evidence is classified truthfully:
  - simulation/preflight rejection may have logs and an RPC error but no signature, slot, or Explorer transaction;
  - confirmed failed onchain evidence requires a real signature, slot, and `meta.err`.
- The planned negative probes use simulation/preflight rejection. Preflight is not disabled merely to manufacture Explorer links.

## File Structure

### Tracked configuration

- `config/devnet.schema.json`
  - documents the public configuration contract;
- `config/devnet.json`
  - created only after the random canonical program ID exists;
  - contains public cluster/program/token constants, never key paths or secrets.

### Safety and runtime modules

- `scripts/devnet/safety.mjs`
  - validates URLs, cluster names, genesis hashes, token program, signer containment, and safe output;
- `scripts/devnet/program-identity.mjs`
  - extracts and compares program IDs from source, Anchor, client, runner, generated IDL, and canonical keypair;
- `scripts/devnet/state.mjs`
  - versioned `.devnet/state.json` load/save/backup and resume decisions;
- `scripts/devnet/cluster.mjs`
  - explicit-RPC attestation, bounded read retries, onchain clock polling, and faucet policy;
- `scripts/devnet/deploy.mjs`
  - deployment command construction, existing-program recovery, program metadata capture, and binary verification inputs;
- `scripts/devnet/binary.mjs`
  - raw/canonical byte comparison and SHA-256 evidence;
- `scripts/devnet/evidence-client.mjs`
  - actor setup, mint setup, escrow instructions, simulations, RPC capture, and balance/state decoding;
- `scripts/devnet/evidence-classification.mjs`
  - distinguishes simulation rejection, confirmed failure, and confirmed success;
- `scripts/devnet/report.mjs`
  - renders sanitized Markdown from verified runtime state;
- `scripts/devnet/publication-gate.mjs`
  - rejects incomplete, dirty, secret-bearing, or unverifiable publication state;
- `scripts/devnet/run.mjs`
  - command entry point and explicit phase/resume orchestration.

### Tests

- `tests/devnet/safety.test.mjs`
- `tests/devnet/program-identity.test.mjs`
- `tests/devnet/state.test.mjs`
- `tests/devnet/cluster.test.mjs`
- `tests/devnet/deploy.test.mjs`
- `tests/devnet/binary.test.mjs`
- `tests/devnet/evidence-classification.test.mjs`
- `tests/devnet/evidence-client.test.mjs`
- `tests/devnet/report.test.mjs`
- `tests/devnet/publication-gate.test.mjs`

All tests use synthetic public keys, byte arrays, RPC response fixtures, and
temporary directories. They do not access `.devnet/` signer files or devnet.

## Gate Summary

| Gate | Deliverable | External write? |
|---|---|---|
| A | Tracked ignore protection, public schema, pure safety tests | No |
| B | Canonical program-ID migration, local preload, full local regression | No |
| C1 | Runtime state, identities, read-only attestation and deploy preflight | No |
| C2 | Bounded faucet funding | **Yes — first external-write boundary** |
| C3 | Program deploy/recovery and DEVTEST setup | Yes |
| D | Release/refund flows and negative simulations | Yes for successful instructions; simulations are read-only RPC |
| E | Sanitized report, binary verification and direct RPC re-checks | Read-only after prior writes |
| F | Final regression, commits, push and Ubuntu CI | Git/GitHub writes only |

Everything through Gate C1 is testable locally or through read-only devnet RPC.
The first external state change is a devnet faucet/airdrop request in Gate C2.

---

## Gate A — Tracked Safety Boundary

### Task 1: Protect runtime secrets before identity generation

**Goal:** Make Git reject all planned devnet key and runtime paths before any key exists.

**Files:**
- Modify: `.gitignore`
- Test: command-level `git check-ignore` probes

**Interfaces:**
- Consumes: current repository ignore rules.
- Produces: tracked ignore protection for `.devnet/` and `*.devnet-keypair.json`.

**Execution class:** Local-only. No key generation and no network calls.

- [ ] **Step 1: Run failure-first ignore probes**

```powershell
git check-ignore -v --no-index .devnet/program.devnet-keypair.json
git check-ignore -v --no-index sponsor.devnet-keypair.json
```

Expected before implementation: both probes return nonzero because the tracked
`.gitignore` does not yet protect these paths.

- [ ] **Step 2: Add the exact tracked patterns**

Append:

```text
.devnet/
*.devnet-keypair.json
```

Do not create `.devnet/` yet.

- [ ] **Step 3: Verify GREEN**

```powershell
git check-ignore -v --no-index .devnet/program.devnet-keypair.json
git check-ignore -v --no-index sponsor.devnet-keypair.json
git status --short --ignored
```

Expected evidence:

- both probes cite tracked `.gitignore`;
- `.devnet/` does not exist;
- no signer or runtime artifact is staged.

**Expected evidence:** Two tracked-ignore matches, zero devnet key files, and a
Git status containing no staged runtime artifact.

**Stop condition:** Any probe is not ignored, or a pre-existing `.devnet/` file
is found. Stop before key generation and inspect it without printing contents.

---

### Task 2: Define and test the public devnet configuration contract

**Goal:** Establish a secret-free configuration schema before a real program ID is generated.

**Files:**
- Create: `config/devnet.schema.json`
- Create: `scripts/devnet/safety.mjs`
- Create: `tests/devnet/safety.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `validatePublicConfig(value): PublicDevnetConfig`
  - `assertAllowedRpcUrl(url, mode): URL`
  - `assertDevnetGenesis(actual, expected): void`
  - `assertClassicTokenProgram(programId): void`
  - `assertSignerPathContained(repoRoot, candidate): string`
  - `sanitizePublicOutput(value): unknown`
- `PublicDevnetConfig` fields:
  - `schemaVersion: 1`
  - `cluster.name: "devnet"`
  - `cluster.rpcUrl: "https://api.devnet.solana.com"`
  - `cluster.genesisHash: string`
  - `programId: string`
  - `token.programId: string`
  - `token.displayLabel: "DEVTEST"`
  - `token.decimals: 6`

**Dependencies:** Existing Node.js runtime only; no new npm package.

**Execution class:** Local-only.

- [ ] **Step 1: Write failure-first safety tests**

Tests must cover:

```javascript
test("accepts the exact public devnet RPC and genesis");
test("rejects mainnet-beta moniker");
test("rejects api.mainnet-beta.solana.com");
test("rejects testnet");
test("rejects an unknown https RPC");
test("rejects localhost in devnet mode");
test("allows localhost only in explicit local-test mode");
test("rejects a genesis hash that differs by one character");
test("rejects Token-2022 and accepts classic SPL Token");
test("rejects signer paths outside .devnet");
test("rejects a sibling path with a .devnet prefix");
test("does not include secretKey or mnemonic fields in sanitized output");
test("requires DEVTEST label and six decimals");
```

Use synthetic config objects and `node:assert/strict`.

- [ ] **Step 2: Run RED**

```powershell
node --test tests/devnet/safety.test.mjs
```

Expected: FAIL because `scripts/devnet/safety.mjs` does not exist.

- [ ] **Step 3: Implement minimal pure validation**

Rules:

- compare parsed hostname and protocol, not substring-only URL checks;
- accept only HTTPS public devnet RPC in devnet mode;
- accept `http://127.0.0.1:*` only in `local-test` mode;
- resolve signer paths and require their relative path to begin with
  `.devnet` as a full path segment;
- reject `..`, symlink escapes, and drive changes;
- reject unexpected config keys that could hide a credential;
- never read Solana global config.

- [ ] **Step 4: Add npm unit-test command**

Add:

```json
"test:devnet:unit": "node --test tests/devnet/*.test.mjs"
```

- [ ] **Step 5: Run GREEN**

```powershell
npm run test:devnet:unit
npm run typecheck
```

Expected evidence: all Gate A tests pass; existing TypeScript checks remain
green.

**Expected evidence:** Passing URL, genesis, token-program, containment and
sanitization tests with no new dependency.

**Stop condition:** Validation needs a new dependency, allows an ambiguous URL,
or cannot prove signer containment. Revise the pure interface before proceeding.

---

## Gate B — Canonical Program-ID Migration

### Task 3: Generate the canonical program keypair after ignore protection

**Goal:** Create the one canonical random program identity without exposing secret material.

**Files:**
- Runtime create only: `.devnet/program.devnet-keypair.json`
- Create tracked after generation: `config/devnet.json`
- Create: `scripts/devnet/program-identity.mjs`
- Create: `tests/devnet/program-identity.test.mjs`

**Interfaces:**
- Produces:
  - `readCanonicalProgramPubkey(keypairPath): PublicKey`
  - `extractProgramIdentitySources(repoRoot): IdentitySources`
  - `verifyProgramIdentity(expected, sources): IdentityEvidence`
  - `parseIdlBuildAddress(output): string`

**Execution class:** Local secret generation only. No RPC and no devnet write.

- [ ] **Step 1: Re-run the tracked ignore gate**

```powershell
git check-ignore -v --no-index .devnet/program.devnet-keypair.json
git diff -- .gitignore
```

Expected: the path is ignored by tracked `.gitignore`, not only
`.git/info/exclude`.

- [ ] **Step 2: Write failure-first identity tests**

Tests use a temporary synthetic keypair and fixture files:

```javascript
test("derives only the public key from a keypair file");
test("detects declare_id mismatch");
test("detects Anchor localnet mismatch");
test("detects Anchor devnet mismatch");
test("detects test.genesis mismatch");
test("detects test-client mismatch");
test("detects local-runner mismatch");
test("extracts the address from Anchor idl-build output");
test("rejects missing or duplicate IDL address sections");
test("never returns secret key bytes in evidence");
```

- [ ] **Step 3: Run RED**

```powershell
node --test tests/devnet/program-identity.test.mjs
```

Expected: FAIL because the program-identity module is missing.

- [ ] **Step 4: Implement the pure identity verifier**

The verifier reads text/public JSON plus the keypair file, derives the pubkey,
and returns only:

```javascript
{
  programId,
  checks: {
    keypair: true,
    rust: true,
    anchorLocalnet: true,
    anchorDevnet: true,
    anchorGenesis: true,
    client: true,
    runner: true,
    generatedIdl: true
  }
}
```

- [ ] **Step 5: Generate the random keypair silently**

```powershell
New-Item -ItemType Directory -Path .devnet -ErrorAction Stop
solana-keygen new `
  --silent `
  --no-bip39-passphrase `
  --outfile .devnet/program.devnet-keypair.json
$programId = solana-keygen pubkey .devnet/program.devnet-keypair.json
$programId
```

Expected output: public program ID only. Do not run `Get-Content` on the keypair.

- [ ] **Step 6: Create the real public config**

Create `config/devnet.json` with:

- actual `$programId`;
- exact public devnet RPC and genesis hash;
- classic Token Program ID;
- `DEVTEST`;
- decimals `6`.

- [ ] **Step 7: Run GREEN on synthetic tests**

```powershell
npm run test:devnet:unit
```

Expected: identity-parser tests pass. Repository-wide identity verification
still fails until Task 4 migrates every public copy; that failure is the
expected Gate B RED signal.

**Expected evidence:** public program ID; ignored key path; no secret output;
real config validates against the schema.

**Stop condition:** The generated program ID equals the Phase 1 deterministic
ID, the key file is not ignored, any secret appears in terminal output, or the
real config fails validation. Remove no evidence; quarantine the run and stop.

---

### Task 4: Migrate every public program-ID reference and localnet preload

**Goal:** Make source, client, local runners, Anchor and CI use the canonical public ID without the canonical secret.

**Files:**
- Modify: `programs/oss-bounty-escrow/src/lib.rs`
- Modify: `Anchor.toml`
- Modify: `tests/helpers.ts`
- Modify: `scripts/test-local.ps1`
- Modify: `.github/workflows/ci.yml`
- Delete: `scripts/create-test-program-keypair.mjs`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Test: `tests/devnet/program-identity.test.mjs`

**Interfaces:**
- Consumes: actual `config/devnet.json` and canonical public key.
- Produces: one program ID across all public identity sources.

**Execution class:** Local-only.

- [ ] **Step 1: Add repository-layout assertions to the failing test**

Tests must assert:

- `declare_id!` equals config;
- `[programs.localnet]` and `[programs.devnet]` equal config;
- one `[[test.genesis]]` entry uses the same address and
  `target/deploy/oss_bounty_escrow.so`;
- test genesis is not marked upgradeable;
- `tests/helpers.ts` equals config;
- `scripts/test-local.ps1` equals config;
- CI does not mention `create-test-program-keypair.mjs`;
- CI contains generated-IDL verification;
- CI runs `anchor test --skip-build --skip-deploy`;
- the obsolete deterministic fixture file is absent.

- [ ] **Step 2: Run RED against the current repository**

```powershell
node --test tests/devnet/program-identity.test.mjs
```

Expected: FAIL with the old Phase 1 ID and missing devnet/test.genesis entries.

- [ ] **Step 3: Apply the canonical public ID**

Update only the impact-map files. Read the public value once:

```powershell
$programId = solana-keygen pubkey .devnet/program.devnet-keypair.json
```

Write the literal contents of `$programId` into `[programs.devnet]`,
`[programs.localnet]`, `[[test.genesis]].address`, `declare_id!`, the test
client, and the Windows runner. The genesis program path is exactly
`target/deploy/oss_bounty_escrow.so` and `upgradeable = false`. No variable name
or template marker is committed.

- [ ] **Step 4: Remove deterministic program-secret creation**

Delete `scripts/create-test-program-keypair.mjs`. CI creates only the
deterministic valueless local payer fixture.

- [ ] **Step 5: Add generated IDL verification in CI**

After `anchor build`, run a Node command that:

- reads `config/devnet.json`;
- reads `target/idl/oss_bounty_escrow.json`;
- requires equal addresses;
- prints only the public address.

- [ ] **Step 6: Change CI localnet test command**

Use:

```text
anchor test --skip-build --skip-deploy
```

Anchor 0.31.1 starts `solana-test-validator`; `test.genesis` preloads the `.so`.

- [ ] **Step 7: Update security documentation**

README/SECURITY must say:

- CI/localnet preload the binary by public ID;
- CI has no canonical devnet program secret;
- the only deterministic signer retained is the valueless local payer;
- `.devnet/` signers are devnet-only and never committed.

- [ ] **Step 8: Run GREEN**

```powershell
npm run test:devnet:unit
node scripts/devnet/program-identity.mjs verify `
  --config config/devnet.json `
  --program-keypair .devnet/program.devnet-keypair.json `
  --skip-generated-idl
```

Expected: all public sources except generated IDL agree.

**Expected evidence:** A verifier result showing true for Rust, both Anchor
clusters, test genesis, client and runner, with the generated-IDL check
explicitly deferred to Task 5.

**Stop condition:** More than one public ID remains, localnet requires the
canonical secret, CI references `.devnet/`, or historical Phase 1 documents
would need rewriting.

---

### Task 5: Verify IDL address, optimized build and complete local regression

**Goal:** Prove the migrated program identity works before any devnet write.

**Files:**
- Modify if needed: `scripts/devnet/program-identity.mjs`
- Runtime only: `target/`

**Execution class:** Local build and local-validator writes only. No devnet write.

- [ ] **Step 1: Run the generated-IDL address command as RED/GREEN proof**

```powershell
$env:ANCHOR_IDL_BUILD_PROGRAM_PATH = (
  Resolve-Path programs/oss-bounty-escrow
).Path
cargo test __anchor_private_print_idl `
  --package oss-bounty-escrow `
  --features idl-build `
  -- --show-output --quiet
```

The verifier parses the address section. Expected: exactly one address equal to
the canonical program ID. A missing or different address is RED and blocks
build/deploy.

- [ ] **Step 2: Run full local verification**

```powershell
cargo fmt --all -- --check
cargo test --workspace
npm run typecheck
npm run test:devnet:unit
.\scripts\build-sbf.ps1
.\scripts\test-local.ps1
git diff --check
```

Expected:

- at least 11 Rust tests pass;
- all devnet pure unit tests pass;
- optimized SBF build exits 0;
- at least 26 local-validator integration tests pass.

- [ ] **Step 3: Record local binary identity**

```powershell
$binary = 'target\sbf-solana-solana\release\oss_bounty_escrow.so'
Get-Item $binary | Select-Object FullName,Length
Get-FileHash $binary -Algorithm SHA256
```

Expected evidence: byte length and SHA-256 without modifying the binary.

- [ ] **Step 4: Create the local-only implementation commit**

Before commit:

- run secret scan;
- confirm `.devnet/` is ignored and unstaged;
- report exact staged paths and diff stat.

Commit:

```text
feat: migrate escrow to canonical devnet identity
```

Do not push.

**Expected evidence:** One canonical public ID, generated IDL agreement,
optimized binary length/hash, at least 11 Rust tests and at least 26 local
integration tests, plus the unpushed local implementation commit.

**Stop condition:** Any regression, ID mismatch, unexpected binary change after
hash capture, staged key/runtime file, or CI design requiring a secret.

---

## Gate C — Devnet Runtime Tooling

### Task 6: Implement versioned resumable runtime state

**Goal:** Make every external action recoverable without deleting useful evidence.

**Files:**
- Create: `scripts/devnet/state.mjs`
- Create: `tests/devnet/state.test.mjs`
- Runtime create: `.devnet/state.json`
- Runtime create: `.devnet/history/`

**Interfaces:**
- `createInitialState(publicConfig, sourceCommit): DevnetStateV1`
- `loadState(path): DevnetStateV1`
- `saveStateAtomic(path, state): void`
- `backupState(path, historyDir): string`
- `migrateState(value): DevnetStateV1`
- `decideNextStep(state, observedOnchain): ResumeDecision`

`DevnetStateV1` contains public evidence only:

```javascript
{
  schemaVersion: 1,
  runId,
  cluster,
  source,
  identities,
  deployment,
  mint,
  flows: { release, refund },
  transactions,
  captures
}
```

Key paths are derived from fixed `.devnet/` filenames and are not stored.

**Execution class:** Local-only.

- [ ] **Step 1: Write failure-first state tests**

```javascript
test("creates schemaVersion 1");
test("loads version 1 without mutation");
test("rejects a future schema version");
test("rejects a missing schemaVersion");
test("writes atomically without partial JSON");
test("backs up existing state before mutation");
test("does not delete history during recovery");
test("resumes Initialized at fund");
test("resumes Funded at release or expiry check");
test("never replays Released or Refunded");
test("does not store secretKey, mnemonic or keypair arrays");
```

- [ ] **Step 2: Run RED**

```powershell
node --test tests/devnet/state.test.mjs
```

- [ ] **Step 3: Implement versioning and migration**

Version policy:

- current version is exactly `1`;
- version `1` loads directly;
- future versions fail closed;
- any future migration must be an explicit numbered function;
- state is backed up before migration;
- no rollback command deletes current or historical state.

- [ ] **Step 4: Run GREEN**

```powershell
npm run test:devnet:unit
```

Expected evidence: atomic/resume/version tests pass.

**Expected evidence:** A version-1 state fixture that survives save/load,
creates a history backup, rejects future versions and never stores secret
material.

**Stop condition:** State recovery would require guessing a completed
transaction or deleting a prior capture.

---

### Task 7: Initialize devnet-only actors without logging secrets

**Goal:** Create dedicated actor identities and record only public keys.

**Files:**
- Create: `scripts/devnet/run.mjs`
- Modify: `scripts/devnet/state.mjs`
- Modify: `tests/devnet/state.test.mjs`
- Runtime create:
  - `.devnet/deployment-authority.devnet-keypair.json`
  - `.devnet/sponsor.devnet-keypair.json`
  - `.devnet/maintainer.devnet-keypair.json`
  - `.devnet/contributor.devnet-keypair.json`
  - `.devnet/mint-authority.devnet-keypair.json`

**Interfaces:**
- CLI command:
  `node scripts/devnet/run.mjs init-identities --rpc https://api.devnet.solana.com`
- Produces state `identities` containing role and public key only.

**Execution class:** Local secret generation only. No RPC write.

- [ ] **Step 1: Add failure-first CLI/output tests**

Tests inject a temporary directory and assert:

- missing tracked ignore protection rejects initialization;
- existing valid key files are reused after public-key verification;
- partial identity creation resumes without overwriting existing keys;
- output contains public keys but not numeric secret arrays;
- output contains no absolute personal path;
- program keypair is not regenerated.

- [ ] **Step 2: Run RED**

```powershell
node --test tests/devnet/state.test.mjs
```

- [ ] **Step 3: Implement silent identity creation**

Use `solana-keygen new --silent --no-bip39-passphrase --outfile ...`.
Before each creation:

- resolve containment under `.devnet/`;
- refuse overwrite;
- if file exists, derive and validate only its public key.

- [ ] **Step 4: Run GREEN locally with a temporary directory**

```powershell
npm run test:devnet:unit
```

- [ ] **Step 5: Initialize real devnet identities**

```powershell
node scripts/devnet/run.mjs init-identities `
  --rpc https://api.devnet.solana.com
```

Expected evidence: six public role identities including the existing canonical
program ID; no secret output.

**Expected evidence:** Public keys for deployment authority, program, sponsor,
maintainer, contributor and mint authority, with all key files ignored.

**Stop condition:** Existing key content is invalid, a role maps to the Phase 1
deterministic fixture, or any key path escapes `.devnet/`.

---

### Task 8: Implement explicit cluster attestation and bounded faucet policy

**Goal:** Separate read-only devnet attestation from the first external write.

**Files:**
- Create: `scripts/devnet/cluster.mjs`
- Create: `tests/devnet/cluster.test.mjs`
- Modify: `scripts/devnet/run.mjs`

**Interfaces:**
- `attestDevnet(connection, publicConfig): ClusterEvidence`
- `pollOnchainTime(connection, target, options)` returns `ClockEvidence`
- `planFaucetAttempts(balance, requiredLamports, policy): FaucetPlan`
- CLI:
  - `preflight-cluster`
  - `fund-authority`

**Execution class:**
- `preflight-cluster`: read-only devnet RPC.
- `fund-authority`: **first external devnet write**.

- [ ] **Step 1: Write failure-first cluster tests**

```javascript
test("attestation rejects the wrong genesis");
test("attestation does not read global Solana config");
test("clock polling returns only after onchain time reaches target");
test("clock polling times out after the configured bound");
test("faucet plan uses at most three attempts");
test("faucet plan never exceeds six devnet SOL total");
test("faucet plan stops when the exact required reserve is reached");
test("rate-limit exhaustion returns BLOCKED without alternate RPC");
```

- [ ] **Step 2: Run RED**

```powershell
node --test tests/devnet/cluster.test.mjs
```

- [ ] **Step 3: Implement read-only attestation**

Capture:

- resolved RPC URL;
- genesis hash;
- cluster version;
- epoch info;
- latest slot/block time;
- classic Token Program account owner/executable status.

Every RPC call uses the explicit URL passed from `config/devnet.json`.

- [ ] **Step 4: Implement bounded faucet policy**

Policy:

- compute required balance from deploy estimate plus a `0.25` devnet SOL
  operational reserve;
- at most three airdrop attempts;
- at most `2` devnet SOL per request;
- at most `6` devnet SOL requested in total;
- bounded backoff of 15 then 30 seconds;
- re-read balance after every attempt;
- stop `BLOCKED` on rate-limit exhaustion.

- [ ] **Step 5: Run GREEN**

```powershell
npm run test:devnet:unit
node scripts/devnet/run.mjs preflight-cluster `
  --rpc https://api.devnet.solana.com
```

Expected evidence: exact RPC/genesis/cluster identity, no transaction.

- [ ] **Step 6: External-write checkpoint**

Before `fund-authority`, report:

- source commit and dirty status;
- canonical program ID;
- deployment authority public key;
- required devnet SOL estimate;
- current balance;
- planned request count.

Do not proceed if the user has withdrawn write authority or any local gate is
red.

- [ ] **Step 7: Request bounded devnet SOL**

```powershell
node scripts/devnet/run.mjs fund-authority `
  --rpc https://api.devnet.solana.com
```

For each approved attempt the orchestrator executes the equivalent of:

```powershell
$deploymentPubkey = solana-keygen pubkey `
  .devnet/deployment-authority.devnet-keypair.json
solana airdrop $requestedSol $deploymentPubkey --url devnet
```

`$requestedSol` comes from the tested faucet plan. Passing the public recipient
prevents use of the global CLI keypair.

Expected evidence: airdrop signatures returned by the faucet/RPC when
available, attempt count, and final valueless devnet SOL balance.

**Expected evidence:** Exact devnet attestation plus a bounded faucet-attempt
record whose cumulative requested amount does not exceed six devnet SOL.

**Stop condition:** Wrong genesis, paid/private endpoint, more than three
attempts, more than six requested devnet SOL, or insufficient balance after the
bounded policy.

---

### Task 9: Build deployment preflight and existing-program recovery

**Goal:** Decide safely between initial deploy, recovered deploy, or hard stop.

**Files:**
- Create: `scripts/devnet/deploy.mjs`
- Create: `tests/devnet/deploy.test.mjs`
- Modify: `scripts/devnet/run.mjs`

**Interfaces:**
- `buildDeployCommand(input): string[]`
- `classifyProgramAccount(observed, expected): DeployDisposition`
- `recoverDeployment(observed, binaryEvidence): DeploymentRecovery`
- CLI:
  - `deploy-preflight`
  - `deploy-program`
  - `recover-deployment`

**Execution class:**
- preflight/recovery queries: read-only devnet RPC.
- deploy: devnet write.

- [ ] **Step 1: Write failure-first deployment tests**

```javascript
test("deploy command includes explicit url, fee payer, program keypair and upgrade authority");
test("deploy command includes explicit max-len equal to local byte length");
test("deploy command never includes --final");
test("deploy command never falls back to default keypair");
test("absent account selects initial deploy");
test("matching executable program selects recovery without redeploy");
test("existing program with another authority is BLOCKED");
test("existing non-executable account at the canonical ID is BLOCKED");
test("uncertain confirmation queries the canonical program before retry");
test("binary mismatch never selects automatic upgrade");
```

- [ ] **Step 2: Run RED**

```powershell
node --test tests/devnet/deploy.test.mjs
```

- [ ] **Step 3: Implement local deployment preflight**

Inputs:

- optimized binary length and SHA-256;
- canonical program ID derived from the keypair;
- deployment authority public key;
- generated IDL address;
- devnet balance;
- `getMinimumBalanceForRentExemption` estimates;
- `solana program show --url devnet --output json` result.

Estimate program rent from the actual binary length and upgradeable-loader
account requirements. Record the estimate; do not hardcode a claim that all
programs cost the same.

- [ ] **Step 4: Handle an already-existing canonical program ID**

Classifications:

- absent: initial deployment allowed;
- executable, expected loader, expected authority, exact binary match:
  recovered success; do not redeploy;
- executable with uncertain/missing prior signature but exact match:
  recovered success with provenance marked `recovered`;
- executable with different authority or binary:
  `BLOCKED`;
- closed/non-executable/other owner:
  `BLOCKED`.

- [ ] **Step 5: Run GREEN**

```powershell
npm run test:devnet:unit
node scripts/devnet/run.mjs deploy-preflight `
  --rpc https://api.devnet.solana.com
```

Expected evidence: disposition, rent estimate, balance requirement, binary
hash, and no write.

- [ ] **Step 6: Deploy with explicit identities**

The orchestrator resolves measured/public values and executes the equivalent of:

```powershell
$binary = 'target\sbf-solana-solana\release\oss_bounty_escrow.so'
$binaryLength = (Get-Item $binary).Length
solana program deploy `
  --url devnet `
  --use-rpc `
  --keypair .devnet/deployment-authority.devnet-keypair.json `
  --fee-payer .devnet/deployment-authority.devnet-keypair.json `
  --program-id .devnet/program.devnet-keypair.json `
  --upgrade-authority .devnet/deployment-authority.devnet-keypair.json `
  --max-len $binaryLength `
  --output json `
  $binary
```

The command does not print key contents.

- [ ] **Step 7: Recover uncertain deployment confirmation**

If CLI output is lost or returns an uncertain error:

1. save the error/output fragment;
2. query canonical program ID;
3. verify executable, loader, ProgramData, authority, deploy slot;
4. dump and compare bytes;
5. mark recovered only on complete match;
6. otherwise stop without a second deploy.

**Expected evidence:** deploy or recovered provenance, signature if known,
program ID, ProgramData address, authority, slot, and Explorer URL only for a
real signature.

**Stop condition:** Authority mismatch, binary mismatch, wrong loader,
insufficient funds, ambiguous account state, or temptation to blindly rerun.

---

### Task 10: Verify onchain executable bytes without ambiguous prefix matching

**Goal:** Compare the local artifact to `solana program dump` with loader allocation semantics handled explicitly.

**Files:**
- Create: `scripts/devnet/binary.mjs`
- Create: `tests/devnet/binary.test.mjs`
- Modify: `scripts/devnet/deploy.mjs`

**Interfaces:**
- `compareProgramBytes(localBytes, dumpBytes, reportedDataLength): BinaryEvidence`
- `hashBytes(bytes): string`

`BinaryEvidence` includes:

```javascript
{
  localLength,
  onchainRawLength,
  reportedDataLength,
  localRawSha256,
  onchainRawSha256,
  onchainCanonicalLength,
  onchainCanonicalSha256,
  paddingLength,
  paddingAllZero,
  exactExecutableMatch
}
```

**Execution class:** Read-only devnet RPC plus local file output under `.devnet/`.

- [ ] **Step 1: Write failure-first binary tests**

```javascript
test("accepts byte-for-byte equal local and dump bytes");
test("accepts longer dump only when the full local bytes match and every extra byte is zero");
test("requires reported ProgramData length to equal raw dump length");
test("rejects a one-byte executable mismatch");
test("rejects a nonzero padding byte");
test("rejects an onchain dump shorter than the local artifact");
test("does not trim zeros that are inside the known local artifact length");
test("records distinct raw and canonical hashes when allocation padding exists");
```

- [ ] **Step 2: Run RED**

```powershell
node --test tests/devnet/binary.test.mjs
```

- [ ] **Step 3: Implement exact dump semantics**

Agave 2.2.20 `process_dump`:

- resolves the ProgramData account;
- removes only `UpgradeableLoaderState::size_of_programdata_metadata()`;
- writes the complete remaining ProgramData allocation.

Canonical comparison:

1. record local and raw dump lengths/hashes;
2. require `reportedDataLength === dumpBytes.length`;
3. if lengths equal, require byte-for-byte equality;
4. if dump is longer:
   - require `dump[0:localLength]` byte-for-byte equal to the entire local file;
   - require every byte after `localLength` to be `0x00`;
   - define canonical onchain bytes as exactly the first `localLength` bytes;
5. reject shorter dumps, prefix mismatches, nonzero tails, or reported-length
   mismatches.

No generic `startsWith`, fuzzy prefix, ELF-section-only, or whitespace-style
comparison is permitted.

- [ ] **Step 4: Run GREEN**

```powershell
npm run test:devnet:unit
```

- [ ] **Step 5: Dump and compare**

```powershell
$programId = solana-keygen pubkey .devnet/program.devnet-keypair.json
solana program dump `
  --url devnet `
  $programId `
  .devnet\onchain-program.raw.so
```

The orchestrator supplies the actual public ID and fetches reported Data Length
from `solana program show`.

Expected: because deployment explicitly sets `--max-len` to local length, raw
and local lengths should normally match. Padding handling remains a verified
fallback, not an assumed success.

**Expected evidence:** Local/raw/canonical lengths and SHA-256 values, explicit
padding length, and `exactExecutableMatch: true`.

**Stop condition:** Any executable mismatch or unproven padding.

---

### Task 11: Create classic SPL DEVTEST mint and actor token accounts

**Goal:** Set up the valueless test token without metadata scope expansion.

**Files:**
- Create: `scripts/devnet/evidence-client.mjs`
- Create: `tests/devnet/evidence-client.test.mjs`
- Modify: `scripts/devnet/run.mjs`
- Modify runtime: `.devnet/state.json`

**Interfaces:**
- `ensureDevtestMint(context, state): MintEvidence`
- `ensureActorTokenAccounts(context, state): TokenAccountEvidence`
- `ensureSponsorBalance(context, state, amount): MintToEvidence`

**Execution class:** Devnet writes for mint/account creation and minting.

- [ ] **Step 1: Write failure-first mint tests**

```javascript
test("uses TOKEN_PROGRAM_ID and never TOKEN_2022_PROGRAM_ID");
test("creates a six-decimal mint");
test("does not construct Metaplex or metadata instructions");
test("treats DEVTEST as an evidence label, not an onchain mint field");
test("reuses an existing mint only after owner, decimals and authority checks");
test("reuses token accounts only when mint and actor owner match");
test("mints only the required demonstration amount");
```

- [ ] **Step 2: Run RED**

```powershell
node --test tests/devnet/evidence-client.test.mjs
```

- [ ] **Step 3: Implement resumable setup**

Use existing dependencies:

- `createMint` with classic `TOKEN_PROGRAM_ID`;
- six decimals;
- separate mint authority public key;
- deployment authority as fee payer;
- sponsor and contributor classic token accounts;
- mint enough for two obligations plus a small non-value reserve.

Do not call any metadata program.

- [ ] **Step 4: Run GREEN**

```powershell
npm run test:devnet:unit
```

- [ ] **Step 5: Execute setup**

```powershell
node scripts/devnet/run.mjs setup-devtest `
  --rpc https://api.devnet.solana.com
```

Expected evidence: mint, decimals, Token Program owner, authorities, supply,
token accounts, transaction signatures, slots and Explorer links.

**Expected evidence:** A classic Token Program mint with six decimals, no
metadata account/instruction, actor token accounts and exact valueless supply.

**Stop condition:** Mint owned by Token-2022/another program, unexpected
decimals/authority, metadata instruction, or mismatched recovered account.

---

## Gate D — Evidence Flows

### Task 12: Classify negative and successful transaction evidence accurately

**Goal:** Prevent fake signatures/Explorer links and distinguish simulation from landed transactions.

**Files:**
- Create: `scripts/devnet/evidence-classification.mjs`
- Create: `tests/devnet/evidence-classification.test.mjs`
- Modify: `scripts/devnet/evidence-client.mjs`

**Interfaces:**
- `classifySimulation(result): SimulationRejectionEvidence`
- `classifyLandedTransaction(signature, tx): LandedTransactionEvidence`
- `explorerTransactionUrl(signature, cluster): string | null`

Evidence variants:

```javascript
{
  kind: "simulation_or_preflight_rejection",
  signature: null,
  slot: null,
  explorerUrl: null,
  rpcError,
  logs
}
```

```javascript
{
  kind: "confirmed_failed_onchain_transaction",
  signature,
  slot,
  explorerUrl,
  metaErr,
  logs
}
```

```javascript
{
  kind: "confirmed_success",
  signature,
  slot,
  explorerUrl,
  metaErr: null,
  logs
}
```

**Execution class:** Pure local classification; negative probes later use
read-only `simulateTransaction`.

- [ ] **Step 1: Write failure-first classification tests**

```javascript
test("simulation rejection has null signature, slot and explorer URL");
test("does not invent a signature from an RPC error message");
test("landed failure requires signature, slot and non-null meta.err");
test("rejects a claimed landed failure with missing transaction metadata");
test("success requires null meta.err");
test("Explorer URL is generated only for a nonempty real signature");
```

- [ ] **Step 2: Run RED**

```powershell
node --test tests/devnet/evidence-classification.test.mjs
```

- [ ] **Step 3: Implement exact discriminated evidence**

Negative-probe decision:

- build and sign the transaction required for realistic authorization;
- call `simulateTransaction` with explicit devnet connection;
- do not disable preflight;
- do not call `sendRawTransaction`;
- capture simulation error and program logs;
- record null signature/slot/Explorer fields.

- [ ] **Step 4: Run GREEN**

```powershell
npm run test:devnet:unit
```

**Expected evidence:** Evidence variants preserve null signature/slot/Explorer
for simulations and require `meta.err` for a claimed landed failure.

**Stop condition:** Any code creates an Explorer URL without a real signature
or labels a simulation as a confirmed onchain failure.

---

### Task 13: Execute and verify flow A — release

**Goal:** Prove exact funding and maintainer-authorized release using one independent escrow.

**Files:**
- Modify: `scripts/devnet/evidence-client.mjs`
- Modify: `scripts/devnet/run.mjs`
- Modify: `tests/devnet/evidence-client.test.mjs`
- Modify runtime: `.devnet/state.json`

**Interfaces:**
- `runReleaseFlow(context, state): ReleaseFlowEvidence`
- canonical external reference is generated from `runId` and literal
  `release-flow`; its hash must be nonzero.

**Execution class:** Devnet writes for initialize, fund and release; read-only
simulation for non-maintainer probe.

- [ ] **Step 1: Add failure-first resume/delta tests**

```javascript
test("release flow uses an escrow reference distinct from refund flow");
test("resumes after initialize without initializing again");
test("resumes after fund without funding again");
test("never replays Released");
test("requires sponsor delta and vault delta equal recorded amount");
test("requires contributor delta equal recorded amount");
test("requires vault principal zero after release");
test("simulates non-maintainer release without sending it");
```

- [ ] **Step 2: Run RED**

```powershell
node --test tests/devnet/evidence-client.test.mjs
```

- [ ] **Step 3: Implement the state-driven flow**

Use a recorded amount of `1_500_000` base units (`1.5 DEVTEST`) unless
preflight balance requires a smaller positive amount. Record both units.

Sequence:

1. initialize;
2. fetch `Initialized`;
3. fund;
4. fetch balances and `Funded`;
5. simulate release signed by sponsor/non-maintainer;
6. release signed by maintainer;
7. fetch balances, logs and `Released`.

- [ ] **Step 4: Run GREEN locally**

```powershell
npm run test:devnet:unit
```

- [ ] **Step 5: Execute on devnet**

```powershell
node scripts/devnet/run.mjs flow-release `
  --rpc https://api.devnet.solana.com
```

Expected evidence:

- three successful transaction signatures and Explorer links;
- negative simulation logs with null signature/slot/Explorer;
- sponsor `-amount`, vault `+amount` at funding;
- contributor `+amount`, vault principal `-amount` at release;
- decoded `Initialized`, `Funded`, `Released`.

**Expected evidence:** Three confirmed successful transactions, one accurately
classified non-maintainer simulation, exact token deltas and terminal
`Released`.

**Stop condition:** Wrong actor succeeds, any delta differs, state is
unexpected, or RPC uncertainty cannot be resolved from saved signatures.

---

### Task 14: Execute and verify flow B — expiry refund

**Goal:** Prove early refund rejection and sponsor refund at onchain time `>= expiry`.

**Files:**
- Modify: `scripts/devnet/evidence-client.mjs`
- Modify: `scripts/devnet/cluster.mjs`
- Modify: `scripts/devnet/run.mjs`
- Modify: `tests/devnet/evidence-client.test.mjs`
- Modify: `tests/devnet/cluster.test.mjs`
- Modify runtime: `.devnet/state.json`

**Interfaces:**
- `runRefundFlow(context, state): RefundFlowEvidence`
- `pollOnchainTime` defaults:
  - interval: 3 seconds;
  - progress update: at most every 12 seconds;
  - timeout: 210 seconds.

**Execution class:** Devnet writes for initialize, fund and refund; read-only
simulation for early refund; read-only onchain-clock polling.

- [ ] **Step 1: Add failure-first expiry tests**

```javascript
test("refund flow reference differs from release flow");
test("expiry is derived from observed onchain block time");
test("early refund is simulated before expiry and not sent");
test("poller does not resolve before observed time reaches expiry");
test("poller resolves at exact expiry");
test("poller returns BLOCKED at timeout");
test("refund resumes from Funded without replaying initialize or fund");
test("sponsor refund delta equals recorded principal");
test("terminal state is Refunded");
```

- [ ] **Step 2: Run RED**

```powershell
node --test tests/devnet/evidence-client.test.mjs tests/devnet/cluster.test.mjs
```

- [ ] **Step 3: Implement the bounded flow**

Sequence:

1. observe devnet block time;
2. choose expiry `observedTime + 120`;
3. initialize and fetch `Initialized`;
4. fund and fetch `Funded`;
5. simulate early refund and capture classified evidence;
6. poll block time until `>= expiry`;
7. refund with sponsor;
8. fetch balances, logs and `Refunded`.

- [ ] **Step 4: Run GREEN locally**

```powershell
npm run test:devnet:unit
```

- [ ] **Step 5: Execute on devnet**

```powershell
node scripts/devnet/run.mjs flow-refund `
  --rpc https://api.devnet.solana.com
```

Expected evidence:

- initialize, fund and refund signatures/Explorer links;
- early-refund simulation with no fake signature;
- pre-expiry and settlement onchain timestamps;
- sponsor refund increase equal recorded amount;
- decoded `Refunded`.

**Expected evidence:** Three confirmed successful transactions, one accurately
classified early-refund simulation, onchain expiry observations, exact sponsor
delta and terminal `Refunded`.

**Stop condition:** No block time, timeout, early simulation unexpectedly
succeeds, refund lands before expiry, or exact delta/state cannot be proven.

---

## Gate E — Durable Evidence Generation

### Task 15: Generate a sanitized evidence report

**Goal:** Convert verified state into durable Markdown without committing raw runtime data.

**Files:**
- Create: `scripts/devnet/report.mjs`
- Create: `tests/devnet/report.test.mjs`
- Create after live verification: `docs/DEVNET_EVIDENCE_2026-07-16.md`
- Modify: `README.md`
- Modify: `SECURITY.md`

**Interfaces:**
- `renderEvidenceReport(state, directRpcEvidence): string`
- `assertReportSanitized(markdown): void`

**Execution class:** Local-only rendering plus read-only devnet rechecks.

- [ ] **Step 1: Write failure-first report tests**

Use a complete synthetic state fixture and assert:

```javascript
test("includes source, cluster, program, binary, mint and actor evidence");
test("includes release and refund transaction tables");
test("labels negative probes as simulation/preflight rejection");
test("does not render Explorer links for null signatures");
test("includes raw and canonical binary lengths and hashes");
test("discloses retained upgrade authority");
test("states DEVTEST is an offchain label with no metadata account");
test("states token is valueless and program is unaudited/devnet-only");
test("states terminal accounts are not closed and dust recovery is deferred");
test("rejects keypair arrays, mnemonic text, bearer tokens and absolute personal paths");
```

- [ ] **Step 2: Run RED**

```powershell
node --test tests/devnet/report.test.mjs
```

- [ ] **Step 3: Implement sanitized rendering**

The report includes:

- capture time and source commit;
- RPC URL, genesis hash, cluster version;
- toolchain versions;
- program ID, ProgramData, authority and deploy provenance;
- local/raw/canonical byte lengths and hashes;
- DEVTEST mint and actor public keys;
- flow A/B transaction and delta tables;
- simulation evidence tables with null signature/slot/Explorer;
- direct terminal-state RPC reads;
- exact reproducible commands using repository-relative paths;
- limitations and upgrade-authority disclosure.

- [ ] **Step 4: Run GREEN**

```powershell
npm run test:devnet:unit
```

- [ ] **Step 5: Re-read live evidence directly**

Before rendering:

- fetch program account and ProgramData;
- fetch mint and token accounts;
- fetch both escrow accounts and vaults;
- fetch each real transaction by signature;
- re-run binary dump comparison;
- verify every real Explorer URL contains `cluster=devnet`;
- verify simulations have no Explorer transaction URL.

- [ ] **Step 6: Render the tracked report**

```powershell
node scripts/devnet/run.mjs render-report `
  --rpc https://api.devnet.solana.com `
  --output docs/DEVNET_EVIDENCE_2026-07-16.md
```

- [ ] **Step 7: Update README and SECURITY**

README receives a short “Devnet Prototype Evidence” section linking the report.
SECURITY receives only factual devnet signer/upgradeability and limitation
clarifications.

**Expected evidence:** sanitized report passes tests and direct RPC comparison.

**Stop condition:** Any report value cannot be traced to RPC/state, any secret
pattern appears, or a simulated rejection is presented as an onchain failure.

---

## Gate F — Regression and Publication

### Task 16: Run the complete Phase 2 publication gate

**Goal:** Verify source, live evidence, secrets, parked repos and CI migration before staging.

**Files:**
- Create: `scripts/devnet/publication-gate.mjs`
- Create: `tests/devnet/publication-gate.test.mjs`
- Modify: `scripts/devnet/run.mjs`
- Verification may require surgical correction files if a real failure is found.

**Interfaces:**
- `evaluatePublicationGate(input): PublicationVerdict`
- CLI:
  `node scripts/devnet/run.mjs publication-gate --rpc https://api.devnet.solana.com`

**Execution class:** Local/read-only RPC until later Git push.

- [ ] **Step 0: Write and observe the failure-first publication tests**

Tests must reject:

```javascript
test("rejects missing terminal escrow state");
test("rejects a missing real transaction signature");
test("rejects an Explorer URL on simulation evidence");
test("rejects binary mismatch");
test("rejects dirty parked repositories");
test("rejects staged .devnet or keypair paths");
test("rejects a non-success final verdict");
```

Run:

```powershell
node --test tests/devnet/publication-gate.test.mjs
```

Expected RED: module missing. Implement the minimal evaluator, rerun, and require
GREEN before the remaining publication steps.

- [ ] **Step 1: Run all local tests and builds fresh**

```powershell
cargo fmt --all -- --check
cargo test --workspace
npm run typecheck
npm run test:devnet:unit
.\scripts\build-sbf.ps1
.\scripts\test-local.ps1
git diff --check
```

Expected:

- Rust tests: at least 11 passing;
- local-validator integration: at least 26 passing;
- every devnet unit test passing;
- optimized SBF build passing.

- [ ] **Step 2: Re-run identity and binary verification**

```powershell
node scripts/devnet/program-identity.mjs verify `
  --config config/devnet.json `
  --program-keypair .devnet/program.devnet-keypair.json

node scripts/devnet/run.mjs verify-live-evidence `
  --rpc https://api.devnet.solana.com
```

Expected: canonical identity agreement, executable program, retained expected
authority, exact executable-byte match, correct terminal escrow states.

- [ ] **Step 3: Run secret/key hygiene checks**

Scan tracked and staged content for:

- private-key PEM headers;
- GitHub/API tokens;
- mnemonic/seed fields;
- arrays resembling Solana 64-byte keypairs;
- `.devnet/`, `*.devnet-keypair.json`, `state.json`, `.so`, ledgers and logs.

Verify:

```powershell
git status --ignored --short
git check-ignore -v --no-index .devnet/program.devnet-keypair.json
git diff --cached --name-only
```

Expected: runtime files ignored and none staged.

- [ ] **Step 4: Verify the five parked repositories**

Expected unchanged HEADs:

```text
Grainlify-Backend             5b89f48d09049f3a3498e0ed6a83d764e3941105
Grainlify-Frontend            ccff9c1deb353ca0c129b8e37181fc669e5bfb0b
superteam-rental-escrow       97210674d4c2113098ccd9f2248c86108872637d
Grainlify-Stellar-Contracts   a1ecfe59783438335a5bd46310b7b33ec129e69f
solana-yield-adapter-standard 00b6a4c3967de538359b454214473d9399d33810
```

All must have empty status.

- [ ] **Step 5: Review exact staged paths**

Stage only tracked implementation, tests, public config and sanitized docs.
Report:

```powershell
git diff --cached --name-status
git diff --cached --stat
git diff --cached --check
```

Do not stage `.devnet/`, target output, ledgers, signers or raw evidence.

- [ ] **Step 6: Create the live-evidence commit**

Commit:

```text
feat: add reproducible devnet escrow evidence
```

Do not amend the canonical-identity implementation commit.

- [ ] **Step 7: Verify commit structure**

Expected Phase 2 sequence:

1. `def0d161` — approved design;
2. plan docs commit;
3. `feat: migrate escrow to canonical devnet identity`;
4. `feat: add reproducible devnet escrow evidence`;
5. correction commits only if a verified failure requires them.

Implementation and live evidence are separate commits because:

- deployment must reference an immutable source/binary commit;
- external evidence should not be mixed with the identity/tooling migration;
- a failed devnet run can be recovered without rewriting implementation history.

- [ ] **Step 8: Push main only after both commits pass**

```powershell
git push origin main
```

No force push.

- [ ] **Step 9: Monitor Ubuntu CI**

CI must:

- install exact Solana/Anchor versions;
- run `anchor build`;
- verify generated IDL address;
- run `anchor test --skip-build --skip-deploy`;
- reach terminal `success`.

If CI fails:

1. read failed logs;
2. identify root cause;
3. apply the smallest correction;
4. repeat local verification;
5. create a separate correction commit;
6. push normally and monitor the new SHA.

**Expected evidence:** Fresh local test/build counts, verified live program and
terminal states, clean secret/staging checks, two Phase 2 implementation/evidence
commits, pushed final SHA and terminal-success Ubuntu CI URL.

**Stop condition:** Any local regression, secret exposure, live-state mismatch,
uncertain Explorer link, failed CI, dirty parked repo, or evidence not tied to
the final source SHA.

---

## Rollback and Recovery Strategy

- Never delete `.devnet/state.json`, `.devnet/history/`, raw RPC captures, or
  transaction logs during recovery.
- Every state write creates a prior-version backup.
- Start a new `runId` only when the prior run is terminally unusable; preserve
  the prior directory and mark its disposition.
- Never use `git reset --hard`, amend, force-push, or rewrite the design,
  implementation, or evidence commits.
- If code changes after deployment:
  - invalidate the recorded local binary hash;
  - rerun all local gates;
  - decide explicitly whether an upgrade is necessary;
  - record any upgrade as a separate transaction and commit;
  - never silently replace evidence for the original deploy.
- If a successful transaction was sent but local state was not saved, recover
  it from signature status, account state and balance deltas before continuing.
- If no signature is available after an uncertain send, inspect the expected
  account/state change before deciding whether another transaction is safe.

## Time, Devnet SOL and RPC Budget

These are operational estimates, not valuable-currency accounting.

- Local implementation and TDD: approximately 3–5 hours.
- Full Windows builds/regression cycles: approximately 5–15 minutes per cycle.
- Public faucet and deployment: approximately 10–40 minutes depending on rate
  limits and upload retries.
- Flow A: approximately 1–3 minutes.
- Flow B: approximately 3–6 minutes including onchain expiry polling.
- Evidence rendering and final verification: approximately 20–40 minutes.
- Ubuntu CI: approximately 6–12 minutes per run.

Devnet SOL policy:

- compute actual deployment rent from measured binary length;
- keep only a `0.25` devnet SOL operational reserve beyond the computed need;
- no single faucet request above `2` devnet SOL;
- no more than three attempts;
- hard cap of `6` requested devnet SOL for Phase 2;
- if this cap is insufficient, stop `BLOCKED` instead of sourcing another
  wallet or network.

RPC-call estimate:

- cluster/preflight reads: 20–40;
- deployment upload and confirmation: size-dependent, commonly the largest
  share;
- mint/accounts: 15–30;
- flow A: 20–35 including simulation and captures;
- flow B: 40–90 including bounded clock polling;
- final direct verification: 30–60.

Expected total is roughly 150–500 RPC interactions plus deployment chunk
traffic. The scripts must avoid unbounded polling and repeated negative probes.

## Plan Completion Criteria

The implementation is complete only when:

- every task's RED failure was observed for the intended missing behavior;
- every corresponding GREEN command passes;
- the first external write occurred only after Gate C1 passed;
- program deployment and executable bytes are verified;
- DEVTEST setup and both escrow flows are complete;
- negative evidence is classified without invented signatures;
- the sanitized report is committed;
- secrets/runtime artifacts remain ignored;
- implementation and live evidence are separate commits;
- `main` is pushed without force;
- Ubuntu CI for the final SHA reaches terminal success.
