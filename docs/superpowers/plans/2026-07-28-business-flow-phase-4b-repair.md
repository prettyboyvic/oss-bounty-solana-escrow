# Phase 4B Business-Flow Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the drifted Phase-4B planner/executor contracts with one canonical execution specification, deterministic public mint derivation, manifest v2, exact read-only reconciliation, and a persistence-capability gate that keeps live execution disabled until a backend is separately proven.

**Architecture:** Pure data and transaction factories define the authorized matrix, funding model, and message identities. The imperative orchestrator consumes only registered spec steps. Persistence and send are separated behind a closed capability interface; the initial production allowlist is empty, so execute fails before mutation, signer loading, simulation, blockhash acquisition, or send while planning and reconciliation remain usable.

**Tech Stack:** Node.js 24.15.0 ESM, `@solana/web3.js` 1.98.4 legacy `Transaction`, `@solana/spl-token` 0.4.13 classic Token Program, native `node:crypto`, `node:test`, canonical JSON helpers.

## Global Constraints

- Devnet remains absolutely read-only during implementation and verification: no faucet, transaction send, live simulation, close, reclaim, or authorization-state mutation.
- Do not modify Rust or IDL and do not persist a mint private key, raw signed transaction, secret seed, keypair bytes, signer path, or unredacted environment data.
- `R4_BUSINESS_FLOW_MANIFEST_V2` execution IDs match `^[a-z0-9][a-z0-9-]{0,63}$`; this does not alter upload-tooling execution-ID contracts or historical `uniquenessToken` semantics.
- All transaction messages are legacy messages. Versioned messages fail closed.
- The production persistence-descriptor allowlist remains empty in this plan. Enabling a backend requires a separate design, proof suite, authorization, and publication decision.
- Missing/unknown/stale capability evidence must fail before local mutation, signer loading, simulation, live blockhash acquisition, or send-adapter access.
- Manifest v1, draft/stale/funding mismatch, and schema/hash mismatch fail before operation lock, execution-ID reservation, receipt directory, or evidence creation.
- No retry, replay, resume, execution-ID reuse, or inference from blockhash expiry is permitted.
- Use TDD for every task: observe the focused test fail before writing production code, then run the focused and cumulative suites.

---

## File and responsibility map

- `scripts/devnet/business-flow-spec.mjs`: canonical data-only execution spec, stable registry IDs, spec validation, and spec hash.
- `scripts/devnet/business-flow-identity.mjs`: manifest-v2 execution-ID validation, canonical reference/mint/ATA derivation, and collision identities.
- `scripts/devnet/business-flow-transaction-factory.mjs`: registry-backed instruction construction, normalized templates, exact legacy messages, public signature proof, and fee-message construction.
- `scripts/devnet/business-flow-persistence-capability.mjs`: closed descriptor schema and fail-closed live-send capability decision; no approved production descriptor.
- `scripts/devnet/business-flow-evidence.mjs`: canonical evidence schemas, hash-chain validation, monotonic transition validation, and sanitized recovery classifications. It does not claim a production durable backend.
- `scripts/devnet/business-flow-reconciliation.mjs`: read-only exact-signature/status/body/post-state reconciliation.
- `scripts/devnet/business-flow-instructions.mjs`: deterministic create-with-seed builder/decoder and existing escrow/token builders.
- `scripts/devnet/business-flow-runner.mjs`: manifest v2, per-identity quote/funding planner, authorization, and pre-mutation validation.
- `scripts/devnet/business-flow-adapter.mjs`: split read, prepare/sign, simulate, and capability-protected submit surfaces; remove monolithic public `send`.
- `scripts/devnet/business-flow-execution.mjs`: imperative ordered orchestration over canonical step IDs and explicit lifecycle interfaces.
- `scripts/devnet/business-flow-cli.mjs`: read-only plan/reconcile routing and execute capability gate before signer loading.
- `docs/BUSINESS_FLOW_RUNNER.md`: operator contracts and unsupported live-execute behavior.

## Phase 1: Pin the local proof gates

### Task 1: Deterministic mint identity and SDK non-enforcement

**Files:**
- Create: `scripts/devnet/business-flow-identity.mjs`
- Modify: `scripts/devnet/business-flow-instructions.mjs`
- Create: `tests/devnet/business-flow-identity.test.mjs`
- Modify: `tests/devnet/business-flow-instructions.test.mjs`

**Interfaces:**
- Produces: `assertBusinessFlowExecutionId(value)`, `deriveBusinessFlowMint(input)`, `buildCreateMintWithSeedInstructions(input)`, and `decodeAndVerifyCreateMintWithSeed(input)`.
- `deriveBusinessFlowMint` returns `{ algorithm, domain, encoding, executionId, genesisHash, programId, sponsorBase, tokenProgram, seed, mint }`.

- [ ] **Step 1: Write failing execution-ID and derivation tests**

```js
assert.equal(assertBusinessFlowExecutionId("exec-1"), "exec-1");
for (const value of ["", "Exec-1", "a_b", "a.b", "../x", "é", "a".repeat(65)]) {
  assert.throws(() => assertBusinessFlowExecutionId(value), /business-flow execution ID/);
}
const first = await deriveBusinessFlowMint(FIXTURE);
const second = await deriveBusinessFlowMint({ ...FIXTURE });
assert.deepEqual(first, second);
assert.equal(Buffer.byteLength(first.seed, "utf8"), 32);
assert.notEqual((await deriveBusinessFlowMint({ ...FIXTURE, programId: OTHER_PROGRAM })).mint, first.mint);
assert.notEqual((await deriveBusinessFlowMint({ ...FIXTURE, genesisHash: OTHER_GENESIS })).mint, first.mint);
```

- [ ] **Step 2: Run the identity test and confirm the missing-module failure**

Run: `node --test tests/devnet/business-flow-identity.test.mjs`

Expected: FAIL because `business-flow-identity.mjs` and its exports do not exist.

- [ ] **Step 3: Implement the canonical identity functions**

Use `createHash("sha256")`, `PublicKey.createWithSeed`, exact NUL-separated UTF-8 fields, the `bfm2-` prefix plus 27 lowercase hex characters, and classic Token Program owner. Reject rather than normalize.

- [ ] **Step 4: Add failing builder-guard and decode tests**

Tests must show that raw `SystemProgram.createAccountWithSeed` accepts a 33-byte seed and unrelated new account, while `buildCreateMintWithSeedInstructions` rejects both before calling an injected builder. The valid fixture must decode and assert sponsor base/from/payer, derived writable non-signer mint, classic owner, `MINT_SIZE`, lamports, six decimals, no freeze authority, one required signature, and compiled account order:

```js
assert.deepEqual(compiled.accountKeys.map(String), [
  sponsor.toBase58(),
  mint.toBase58(),
  SystemProgram.programId.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
]);
assert.equal(compiled.header.numRequiredSignatures, 1);
```

- [ ] **Step 5: Implement guarded construction and post-construction verification**

Decode the System instruction with `SystemInstruction.decodeCreateWithSeed`. Recompute the derived mint independently and compare every decoded field and compiled meta. Do not treat successful SDK construction as validation.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/devnet/business-flow-identity.test.mjs tests/devnet/business-flow-instructions.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 7: Commit**

```bash
git add scripts/devnet/business-flow-identity.mjs scripts/devnet/business-flow-instructions.mjs tests/devnet/business-flow-identity.test.mjs tests/devnet/business-flow-instructions.test.mjs
git commit -m "feat(devnet): derive deterministic business-flow mint"
```

### Task 2: Canonical execution spec and every supported legacy message shape

**Files:**
- Create: `scripts/devnet/business-flow-spec.mjs`
- Create: `scripts/devnet/business-flow-transaction-factory.mjs`
- Create: `tests/devnet/business-flow-spec.test.mjs`
- Create: `tests/devnet/business-flow-transaction-factory.test.mjs`
- Modify: `tests/devnet/business-flow-full-matrix.test.mjs`

**Interfaces:**
- Produces: `BUSINESS_FLOW_EXECUTION_SPEC`, `executionSpecHash()`, `validateExecutionRegistry(registry)`, `buildStepInstructions(stepId, context, registry)`, `normalizedMessageTemplate(stepId, context)`, and `prepareExactLegacyTransaction(stepId, context, signers)`.
- `prepareExactLegacyTransaction` returns only public durable fields plus in-memory `transaction`/`wireBytes`; callers must discard the latter after the one submit boundary.

- [ ] **Step 1: Write failing canonical-spec contract tests**

Assert the deeply frozen data-only body has 12 sends, 3 simulations, one wait, one mint, two ATA, three escrow, three vault, 11 sponsor-paid sends, one maintainer-paid send, and ceilings 12/3. Recursively reject functions and closures. Require exactly one registry entry for every stable builder/verifier/wait ID and reject missing, duplicate, extra, disabled, and unknown IDs.

- [ ] **Step 2: Run the spec test and confirm failure**

Run: `node --test tests/devnet/business-flow-spec.test.mjs`

Expected: FAIL because the canonical spec module is absent.

- [ ] **Step 3: Implement the immutable data-only spec and registry validation**

Keep builder/verifier functions outside the hashed object. Hash:

```js
createHash("sha256")
  .update(`R4_BUSINESS_FLOW_EXECUTION_SPEC_V1\0${canonicalJson(spec)}`)
  .digest("hex");
```

- [ ] **Step 4: Write failing transaction-factory parity tests**

For all 12 send IDs and 3 simulation IDs, assert:

- payer and ordered signer public keys;
- program IDs, ordered accounts, signer/writable flags, discriminators, data lengths, and relevant addresses;
- normalized template excludes blockhash, last-valid height, signatures, and concrete dynamic expiry bytes;
- exact prepared identity includes them;
- rebuilding with exact public fields produces byte-identical serialized message bytes;
- `Message.from(bytes)` proves a legacy header;
- every public signature verifies with native `node:crypto` Ed25519 SPKI;
- `Transaction.from(wire).serializeMessage()` equals the exact message;
- any fee payer, blockhash, expiry, account, instruction byte, signer, or order change breaks the proof.

- [ ] **Step 5: Implement the transaction factory and native signature verifier**

Use the Ed25519 SPKI prefix `302a300506032b6570032100` plus the 32-byte Solana public key. Do not add `tweetnacl`. Reject versioned messages and unsupported step IDs.

- [ ] **Step 6: Replace hand-maintained matrix accounting assertions with spec-derived assertions**

Keep the imperative flow behavior tests, but make expected payer/signer/order/inventory values originate from the canonical spec rather than a second literal matrix.

- [ ] **Step 7: Run focused proof gates**

Run: `node --test tests/devnet/business-flow-spec.test.mjs tests/devnet/business-flow-transaction-factory.test.mjs tests/devnet/business-flow-full-matrix.test.mjs`

Expected: PASS for every supported shape with zero failures.

- [ ] **Step 8: Commit**

```bash
git add scripts/devnet/business-flow-spec.mjs scripts/devnet/business-flow-transaction-factory.mjs tests/devnet/business-flow-spec.test.mjs tests/devnet/business-flow-transaction-factory.test.mjs tests/devnet/business-flow-full-matrix.test.mjs
git commit -m "feat(devnet): define canonical business-flow transaction spec"
```

### Task 3: Persistence capability gate with an empty production allowlist

**Files:**
- Create: `scripts/devnet/business-flow-persistence-capability.mjs`
- Create: `tests/devnet/business-flow-persistence-capability.test.mjs`
- Modify: `scripts/devnet/business-flow-cli.mjs`
- Modify: `tests/devnet/business-flow-cli-safety.test.mjs`

**Interfaces:**
- Produces: `PERSISTENCE_CAPABILITY_SCHEMA`, `evaluatePersistenceCapability(observation, allowlist)`, and `assertLiveSendCapability(input)`.
- Production calls use an empty frozen allowlist. Test-only descriptors are dependency-injected and cannot be selected by CLI flags or environment variables.

- [ ] **Step 1: Write failing closed-schema capability tests**

Require separate booleans/IDs for atomic visibility, exclusive publication, integrity, process recovery, and power-loss durability, plus shared ownership/reservation/evidence semantics. Reject extra keys, partial claims, mismatched runtime/filesystem/backend identity, stale proof-suite or repository provenance, and mixed durability models.

- [ ] **Step 2: Run the capability test and confirm failure**

Run: `node --test tests/devnet/business-flow-persistence-capability.test.mjs`

Expected: FAIL because the capability module is absent.

- [ ] **Step 3: Implement the pure evaluator with no approved production descriptor**

The unsupported result must be sanitized and exact:

```js
{
  allowed: false,
  code: "LIVE_SEND_DISABLED_PERSISTENCE_CAPABILITY",
  missing: ["approvedDescriptor"],
  mutationAttempted: false,
  signerAccessed: false,
  simulationAttempted: false,
  blockhashRequested: false,
  sendAttempted: false,
}
```

- [ ] **Step 4: Write failing CLI-order tests**

Inject counters for manifest reads, operation lock, directory creation, reservation, signer loader, RPC construction, simulation, blockhash, and send. Valid live acknowledgement with no descriptor must reach only public plan/auth parsing and capability evaluation; every later counter remains zero. Environment variables and CLI arguments cannot inject a descriptor.

- [ ] **Step 5: Move the capability gate ahead of all execution-side dependencies**

Keep plan and reconcile routing independent. The execute route must not construct the production adapter or call `loadSigners` before the gate.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/devnet/business-flow-persistence-capability.test.mjs tests/devnet/business-flow-cli-safety.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 7: Commit**

```bash
git add scripts/devnet/business-flow-persistence-capability.mjs scripts/devnet/business-flow-cli.mjs tests/devnet/business-flow-persistence-capability.test.mjs tests/devnet/business-flow-cli-safety.test.mjs
git commit -m "feat(devnet): gate live business flow on persistence proof"
```

## Phase 2: Replace planner and authorization drift

### Task 4: Manifest v2 and fail-before-mutation validation

**Files:**
- Modify: `scripts/devnet/business-flow-runner.mjs`
- Modify: `scripts/devnet/business-flow-execution.mjs`
- Modify: `tests/devnet/business-flow-runner.test.mjs`
- Modify: `tests/devnet/business-flow-execution.test.mjs`

**Interfaces:**
- Produces: `buildManifestV2(fields)`, `manifestV2Hash(body)`, `authorizeManifestV2(plan, authorization)`, and `validatePreMutationInputs(input)`.
- Historical v1 parsing is exposed only through a named read-only inspection function.

- [ ] **Step 1: Write failing manifest-v2 canonicalization and tamper tests**

Bind repository SHA, endpoint/genesis/program/program-data/loader/authority/executable hash, spec hash, stable registry IDs, all identities, canonical references, mint derivation, ATA inputs, amounts/decimals/expiry policy, funding snapshot, execution ID, TTL, and acknowledgement domain. Assert `planHash` is adjacent to, not inside, the manifest body.

- [ ] **Step 2: Write failing pre-mutation ordering tests**

For v1, unknown schema, draft, expired TTL, bad manifest/spec/template/funding hash, invalid execution ID, identity mismatch, and malformed authorization, inject mutation/signer/RPC counters and assert all remain zero.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `node --test tests/devnet/business-flow-runner.test.mjs tests/devnet/business-flow-execution.test.mjs`

Expected: FAIL on v2 schema and pre-mutation ordering assertions.

- [ ] **Step 4: Implement v2 canonicalization and one validation entry point**

Remove authorization dependence on v1. Preserve v1 only in read-only historical inspection. Move reservation and operation ownership after deterministic validation, read-only revalidation, funding re-quote, collision checks, and persistence capability approval.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/devnet/business-flow-runner.test.mjs tests/devnet/business-flow-execution.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 6: Commit**

```bash
git add scripts/devnet/business-flow-runner.mjs scripts/devnet/business-flow-execution.mjs tests/devnet/business-flow-runner.test.mjs tests/devnet/business-flow-execution.test.mjs
git commit -m "feat(devnet): bind business-flow manifest v2"
```

### Task 5: Exact per-identity funding planner

**Files:**
- Modify: `scripts/devnet/business-flow-runner.mjs`
- Modify: `scripts/devnet/business-flow-transaction-factory.mjs`
- Modify: `tests/devnet/business-flow-runner.test.mjs`

**Interfaces:**
- Produces: `quoteExecutionFunding(input, readOnlyRpc)`, returning quote slot/time/TTL/blockhash evidence, per-step template hash/fee/signature count/payer, inventory, and four identity totals.

- [ ] **Step 1: Write failing quote and accounting tests**

Use fake finalized reads and `getFeeForMessage` for all 12 messages. Assert sponsor pays 11 fees plus all rent, maintainer pays one fee, contributor and mint authority remain explicit zero-minimum results, and:

```js
headroom = minimum === 0
  ? 0
  : Math.max(Math.ceil(minimum / 100), largestQuotedFee);
recommended = minimum + headroom;
```

Assert one missing/malformed fee, rent, balance, slot, time, blockhash, payer, signer, inventory item, or ceiling fails closed.

- [ ] **Step 2: Run the funding tests and confirm failure**

Run: `node --test --test-name-pattern="funding|quote|planner" tests/devnet/business-flow-runner.test.mjs`

Expected: FAIL because the current constant fee/reserve model cannot satisfy per-message quotes.

- [ ] **Step 3: Implement read-only message quotation from the transaction factory**

The quote blockhash is observation evidence only. Bind quote slot/time, local observation time, five-minute TTL, template/spec identity, and exact returned fees. Never expose send/sign methods on the planner RPC adapter.

- [ ] **Step 4: Add faucet-boundary tests without invoking a faucet**

Construct pre- and post-funding fake snapshots. Assert a pre-faucet quote cannot be reused and every fee/rent/balance/template/TTL field is rebuilt.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/devnet/business-flow-runner.test.mjs tests/devnet/business-flow-transaction-factory.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 6: Commit**

```bash
git add scripts/devnet/business-flow-runner.mjs scripts/devnet/business-flow-transaction-factory.mjs tests/devnet/business-flow-runner.test.mjs tests/devnet/business-flow-transaction-factory.test.mjs
git commit -m "feat(devnet): quote exact per-identity business-flow funding"
```

## Phase 3: Evidence and read-only reconciliation

### Task 6: Canonical evidence schema and monotonic recovery

**Files:**
- Create: `scripts/devnet/business-flow-evidence.mjs`
- Create: `tests/devnet/business-flow-evidence.test.mjs`
- Modify: `scripts/devnet/business-flow-adapter.mjs`
- Modify: `tests/devnet/business-flow-adapter.test.mjs`

**Interfaces:**
- Produces: `canonicalEvidenceHash(record)`, `validateEvidenceChain(records, capability)`, `nextEvidenceTransition(chain, record)`, and `classifyRecoveredEvidence(chain, capability)`.
- Persistence is injected. This task supplies no production-approved backend and makes no Windows durability claim.

- [ ] **Step 1: Write failing closed-schema and hash-chain tests**

Cover `ABSENT -> PREPARED -> SEND_INTENT -> TERMINAL`, exact-one attempt, predecessor hash, immutable message/signatures/addresses, idempotent byte-identical duplicate, conflicting duplicate, downgrade, deletion, truncation, noncanonical JSON, fork, reordered transition, extra field, and secret/raw-transaction rejection.

- [ ] **Step 2: Run the evidence test and confirm failure**

Run: `node --test tests/devnet/business-flow-evidence.test.mjs`

Expected: FAIL because the evidence module is absent.

- [ ] **Step 3: Implement pure evidence validation and recovery classification**

Unsupported capability plus `PREPARED_NO_SEND_INTENT` returns:

```js
{
  stepState: "PREPARED_NO_SEND_INTENT",
  overall: "BLOCKED_UNKNOWN",
  retryAllowed: false,
  abandonAllowed: false,
  missingCapability: true,
}
```

- [ ] **Step 4: Split adapter preparation from submission**

Replace public monolithic `send` with:

- `prepareSigned(step)` returning public proof plus in-memory wire bytes;
- `submitPrepared({ durableIntentHandle, wireBytes })`, which validates an injected approved handle before one `sendRawTransaction`;
- read-only status/account methods.

Do not add a production durable handle provider. Evidence write failures must propagate instead of being swallowed.

- [ ] **Step 5: Add architecture tests proving submit ordering**

Invalid, absent, stale, wrong-step, wrong-message, or unsupported handles must produce zero `sendRawTransaction` calls. A test-only approved handle may call the injected fake send exactly once; no retry exists.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/devnet/business-flow-evidence.test.mjs tests/devnet/business-flow-adapter.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 7: Commit**

```bash
git add scripts/devnet/business-flow-evidence.mjs scripts/devnet/business-flow-adapter.mjs tests/devnet/business-flow-evidence.test.mjs tests/devnet/business-flow-adapter.test.mjs
git commit -m "feat(devnet): define monotonic business-flow evidence"
```

### Task 7: Exact-signature read-only reconciliation

**Files:**
- Create: `scripts/devnet/business-flow-reconciliation.mjs`
- Create: `tests/devnet/business-flow-reconciliation.test.mjs`
- Modify: `scripts/devnet/business-flow-cli.mjs`
- Modify: `tests/devnet/business-flow-cli-safety.test.mjs`

**Interfaces:**
- Produces: `reconcileBusinessFlow(input, readOnlyAdapter)` and a closed per-step/overall result schema.
- Adapter allowlist: genesis/slot/time/account reads, `getSignatureStatuses`, and optional `getTransaction`. No signer, blockhash-for-send, simulate, confirm mutation, send, airdrop, close, resume, or receipt write.

- [ ] **Step 1: Write failing primary-proof tests**

Rebuild exact legacy message from manifest/spec/PREPARED, compare its hash, verify every public Ed25519 signature, then query only the exact fee-payer signature. Mutation of any payer, signer, blockhash, expiry, account, program, instruction byte, address, step ID, ordinal, plan hash, or spec hash returns `EVIDENCE_INCONSISTENT`.

- [ ] **Step 2: Write the fake-RPC classification matrix**

Cover:

- processed and confirmed as observed nonterminal;
- finalized `err == null` with matching/mismatching post-state;
- finalized `err != null` with matching/mismatching failure-state policy;
- exact body present and matching;
- body unavailable/pruned while primary proof remains sufficient;
- conflicting body;
- completed status read returning absent;
- RPC unavailable;
- tampered/broken evidence;
- `SEND_INTENT` plus absent status;
- blockhash expired;
- mint absent, valid, wrong owner/size/authority/freeze/decimals/rent;
- ATA and escrow/vault mismatch.

- [ ] **Step 3: Run the reconciliation test and confirm failure**

Run: `node --test tests/devnet/business-flow-reconciliation.test.mjs`

Expected: FAIL because reconciliation is absent.

- [ ] **Step 4: Implement the pure classification and post-state verifier registry**

RPC body comparison is defense-in-depth only. Body absence must not override a valid reconstructed-message/signature/status/post-state chain. RPC unavailable and signature absent remain distinct.

- [ ] **Step 5: Add the explicit read-only CLI route**

Require exact plan, authorization, execution ID, and evidence paths. Return the canonical report to stdout without modifying evidence or authorization state. Tests inject forbidden adapter methods one at a time and require rejection before any read.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/devnet/business-flow-reconciliation.test.mjs tests/devnet/business-flow-cli-safety.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 7: Commit**

```bash
git add scripts/devnet/business-flow-reconciliation.mjs scripts/devnet/business-flow-cli.mjs tests/devnet/business-flow-reconciliation.test.mjs tests/devnet/business-flow-cli-safety.test.mjs
git commit -m "feat(devnet): reconcile exact business-flow signatures read-only"
```

## Phase 4: Orchestrator parity and migration closure

### Task 8: Drive the imperative orchestrator exclusively from canonical step IDs

**Files:**
- Modify: `scripts/devnet/business-flow-execution.mjs`
- Modify: `tests/devnet/business-flow-execution.test.mjs`
- Modify: `tests/devnet/business-flow-full-matrix.test.mjs`

**Interfaces:**
- Produces: `executeCanonicalMatrix(context, lifecycle)` where lifecycle exposes capability-approved prepare/persist/submit/observe methods. Production execution remains unreachable with the empty allowlist.

- [ ] **Step 1: Write failing planner/executor parity tests**

Instrument every registry builder, simulation, wait, payer, signer, rent class, verifier, and ceiling contribution. Assert executor cannot call an unknown/disabled/duplicate/out-of-order step and completion rejects any omitted spec step.

- [ ] **Step 2: Write crash-boundary tests**

Inject failure before reservation, before build, before PREPARED, between PREPARED/SEND_INTENT, between SEND_INTENT/send, ambiguous send throw, finalized status before terminal evidence, terminal evidence failure, and restart. Assert at most one fake send, no next step after uncertainty, no retry/reuse, and exact classification.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `node --test tests/devnet/business-flow-execution.test.mjs tests/devnet/business-flow-full-matrix.test.mjs`

Expected: FAIL because the current imperative code supplies payer/signers directly and uses monolithic `adapter.send`.

- [ ] **Step 4: Refactor orchestration to look up every event from the canonical spec**

Keep expiry/state verification imperative through stable registry IDs. Remove caller-supplied payer/signer authority and the best-effort replace-style matrix receipt. Do not implement a production persistence backend.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/devnet/business-flow-execution.test.mjs tests/devnet/business-flow-full-matrix.test.mjs`

Expected: PASS with zero failures and zero production send access.

- [ ] **Step 6: Commit**

```bash
git add scripts/devnet/business-flow-execution.mjs tests/devnet/business-flow-execution.test.mjs tests/devnet/business-flow-full-matrix.test.mjs
git commit -m "refactor(devnet): execute canonical business-flow steps"
```

### Task 9: CLI, documentation, secret/static scans, and full validation

**Files:**
- Modify: `docs/BUSINESS_FLOW_RUNNER.md`
- Modify: `tests/devnet/business-flow-cli-safety.test.mjs`
- Modify: `tests/devnet/business-flow-runner.test.mjs`
- Modify: `tests/devnet/business-flow-full-matrix.test.mjs`

**Interfaces:**
- Documents the exact plan, draft funding, authorization, unsupported execute, evidence, and reconciliation contracts.

- [ ] **Step 1: Add failing end-to-end CLI contract tests**

Assert default plan and explicit reconcile are read-only. Execute with otherwise valid inputs must return `LIVE_SEND_DISABLED_PERSISTENCE_CAPABILITY` with zero filesystem mutation, signer read, simulation, blockhash, or send. Manifest v1 and every mismatch fail even earlier.

- [ ] **Step 2: Run CLI-focused tests and confirm any remaining failure**

Run: `node --test tests/devnet/business-flow-cli-safety.test.mjs tests/devnet/business-flow-runner.test.mjs`

Expected: PASS only after every production route honors the final contracts.

- [ ] **Step 3: Update operator documentation**

Document:

- 12 sends, 3 simulations, 11 sponsor fees, one maintainer fee;
- deterministic public seed and no mint private key;
- quote TTL and mandatory rebuild after separately authorized faucet;
- manifest v2 and scoped execution-ID regex;
- normalized versus exact prepared proof;
- reconciliation taxonomy and no retry/abandon inference;
- production descriptor allowlist empty;
- Windows is unsupported because capability proof is absent, not because of its name;
- backend enablement is a separate workstream and authorization boundary.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
node --test tests/devnet/business-flow-*.test.mjs
npm run test:devnet:unit
npm run typecheck
git diff --check
```

Expected: all tests pass, TypeScript reports no errors, and diff check is clean.

- [ ] **Step 5: Run scope and secret scans**

Run:

```bash
git diff --name-only origin/main
rg -n "BEGIN (RSA|OPENSSH|EC) PRIVATE|mnemonic|secretKey\\s*[:=]|rawSignedTransaction" scripts/devnet tests/devnet docs/BUSINESS_FLOW_RUNNER.md
git diff -- programs tests/idl.ts target/idl
```

Expected: only client tooling, tests, and documentation are changed; no actual secret material, Rust, committed IDL, or raw signed transaction persistence is introduced.

- [ ] **Step 6: Commit**

```bash
git add docs/BUSINESS_FLOW_RUNNER.md scripts/devnet tests/devnet
git commit -m "docs(devnet): close phase 4b repair contracts"
```

## Phase 5: Review and publication boundary

### Task 10: Independent review checkpoint

**Files:**
- Review only; fix only findings that trace directly to this plan.

**Interfaces:**
- Produces a publication verdict, not a live-execution authorization.

- [ ] **Step 1: Review spec-to-plan-to-diff coverage**

Map every design requirement to a test and implementation location. Confirm the production persistence allowlist is empty and no alternate environment/flag path can enable send.

- [ ] **Step 2: Re-run final verification after any review fixes**

Run:

```bash
npm run test:devnet:unit
npm run typecheck
git diff --check origin/main...HEAD
git status --short --branch
```

Expected: zero failures, clean diff check, and only intentional commits ahead of `origin/main`.

- [ ] **Step 3: Stop for operator publication authorization**

Report exact commits, files, test counts, scope scan, and:

```text
BUSINESS_FLOW_PLANNER_MANIFEST_RECONCILIATION_PASS
LIVE_SEND_DISABLED_PERSISTENCE_CAPABILITY
```

Do not push, faucet, simulate live, send, or enable a persistence descriptor without a new explicit operator decision.
