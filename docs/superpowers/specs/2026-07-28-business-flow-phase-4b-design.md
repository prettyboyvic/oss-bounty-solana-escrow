# Business-Flow Planner, Manifest, and Reconciliation Repair Design

## Scope

Phase 4B repairs only the devnet client tooling, deterministic tests, and
operator documentation for the business-flow acceptance matrix. It aligns the
funding planner with the concrete top-level executor, replaces the incomplete
authorization manifest with a fail-closed versioned contract, closes the
durable-evidence gap before transaction submission, and adds read-only
reconciliation for interrupted or uncertain executions.

The phase does not request an airdrop, transfer SOL, create any devnet account,
mint tokens, send a transaction, run live simulation, execute or resume a
business flow, change Rust or IDL semantics, deploy or upgrade the program,
use the upgrade authority, close an account, reclaim rent, or persist secret
material. All tests use fake RPC, adapters, clocks, and filesystem fixtures.

The repair retains the current trust model: sponsor pays the setup,
initialization, funding, refund, and cancel transactions; maintainer pays and
signs the release transaction; mint authority signs only `mintTo`; contributor
does not sign a live send.

## Confirmed baseline and defect

At repository SHA
`d6ea74ef1ed2fdea3af223760ca2c400682c72d9`, the concrete driver contains
twelve sends and three simulations. The planner predates that driver and
models seven setup writes, one escrow, three token accounts, and only sponsor
funding. The concrete driver instead creates one mint, two associated token
accounts, three escrow accounts, and three vault token accounts. It sends
eleven sponsor-paid transactions and one maintainer-paid transaction.

The root cause is duplicated execution knowledge: planner and executor each
hard-code a different model. Phase 4B removes that duplication rather than
patching the current constants independently.

## Selected architecture

The repair uses a hybrid architecture:

1. A canonical, serializable execution specification owns step identity,
   ordering, payer/signer roles, account creation, rent ownership, verification
   policy, simulation policy, wait boundaries, and ceiling contribution.
2. A transaction factory materializes real instruction arrays and structural
   message proofs from the canonical step specification and a bound execution
   context.
3. The planner and executor consume those same two sources.
4. The orchestrator remains imperative for chain-time expiry waiting,
   post-state reads, token deltas, stop-on-first-failure behavior, and receipt
   updates.

This avoids a risky state-machine rewrite while making it impossible for the
planner to silently omit a send, payer, signer, rent account, or ceiling
contribution that the executor accepts.

A planner-only patch was rejected because it would preserve the cause of the
drift. A fully declarative state-machine rewrite was rejected because expiry,
negative simulations, and post-state verification would expand the repair far
beyond the smallest safe change.

## Canonical execution specification

The new execution-spec module exposes a deeply immutable canonical public
data value and a domain-separated SHA-256 hash. The hashed body is data-only:
it contains no JavaScript functions, closures, clocks, blockhashes, balances,
secrets, or environment-dependent data.

Each event contains:

- stable event and step ID;
- total order and flow ownership;
- kind: `SEND`, `SIMULATE`, or `WAIT`;
- instruction count;
- fee-payer role;
- required non-payer signer roles;
- created account classes and counts;
- rent-payer role;
- post-state verification policy;
- simulation expected-error policy;
- expiry wait boundary;
- send, simulation, and ceiling contributions.

Imperative builders and verifiers are referenced from the hashed body only by
stable IDs such as `instructionBuilderId`, `postStateVerifierId`,
`simulationDecoderId`, and `waitPolicyId`. Their implementations live in a
registry outside the hashed body. Startup validation requires exactly one
registered implementation for every enabled stable ID and rejects missing,
duplicate, or unreferenced entries. Neither function source text nor closure
state is serialized or hashed.

For all three enabled flows, the canonical contract contains:

- twelve `SEND` events;
- three `SIMULATE` events;
- one refund-expiry `WAIT` event;
- one mint, two ATA, three escrow, and three vault creations;
- eleven sponsor-paid sends;
- one maintainer-paid send;
- full send ceiling twelve;
- simulation ceiling three.

The execution API accepts a step ID rather than caller-supplied payer and signer
roles. It looks up those roles in the enabled canonical spec. Unknown,
duplicate, disabled, or out-of-order send/simulation IDs fail before adapter
access. Completion asserts that every enabled canonical event reached exactly
one terminal local outcome. Contract tests instrument the adapter and prove
that no hidden send or simulation can occur outside the specification.

The execution-spec hash covers instruction schema versions and expected
instruction discriminators/account-role ordering. It is the client-side
instruction-schema identity. The deployed-binary hash independently binds the
on-chain implementation.

## Canonical acceptance references

Execution ID is used only as the uniqueness input for the acceptance matrix.
It does not change the program's external-reference semantics or the general
client PDA helpers.

For each enabled flow, the planner derives:

```text
referenceDomain = "R4_BUSINESS_FLOW_REFERENCE_V2"
referenceLabel =
  referenceDomain + ":" + executionId + ":" + flow
referenceHash = sha256(UTF8(referenceLabel))
escrow = findProgramAddress(
  ["escrow", sponsor, referenceHash],
  programId
)
vault = findProgramAddress(
  ["vault", escrow],
  programId
)
```

The manifest binds the domain, encoding, execution ID, flow, complete
reference label, reference hash, sponsor, program ID, escrow, and vault for
every instance. Existing general-purpose `externalReference`,
`deriveEscrowPda`, and `deriveVaultPda` semantics remain unchanged.

## Deterministic mint derivation

The ephemeral mint keypair is replaced by a System Program
create-with-seed account. No mint private key exists.

The canonical derivation is:

```text
algorithm = "SOLANA_CREATE_WITH_SEED_SHA256_V1"
domain = "R4_BUSINESS_FLOW_MINT_V2"
encoding = "UTF-8"
digestInput =
  domain + NUL +
  genesisHash + NUL +
  programIdBase58 + NUL +
  executionId + NUL +
  sponsorBase58 + NUL +
  classicTokenProgramBase58
digest = lowercaseHex(sha256(UTF8(digestInput)))
seed = "bfm2-" + first27Characters(digest)
mint = PublicKey.createWithSeed(
  sponsor,
  seed,
  classicTokenProgram
)
```

`seed` is exactly 32 ASCII and UTF-8 bytes: the five-byte `bfm2-` prefix and
twenty-seven lowercase hexadecimal characters, representing 108 truncated
hash bits. A canonical Phase-4B business-flow manifest-v2 execution ID is one
to 64 ASCII bytes matching `^[a-z0-9][a-z0-9-]{0,63}$`. Uppercase,
whitespace, path separators, non-ASCII, empty, or longer values are rejected
rather than normalized.

This contract is scoped to `R4_BUSINESS_FLOW_MANIFEST_V2`. It does not redefine
the upload tooling's existing `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` execution-ID
contract. It is also distinct from the historical business-flow
`uniquenessToken`: that token may be an ISO timestamp and is not accepted as a
manifest-v2 execution ID without separately satisfying the new contract.
Existing business-flow fixtures (`exec-1`, `matrix-1`, `u1`, and `u2`) remain
valid. Historical receipts and upload evidence retain their original schema
and validation rules.

Application validation, not the Solana SDK builder, enforces the seed and
address contract. Before instruction construction the implementation:

- validates the execution ID without normalization;
- recomputes the UTF-8 digest preimage from manifest-bound fields;
- requires a lowercase-hex digest and exactly 32 ASCII/UTF-8 seed bytes;
- computes the mint with `PublicKey.createWithSeed`;
- rejects any caller-supplied seed, base, owner, or mint that differs.

After construction it decodes the System instruction and requires the same
base, seed bytes, owner, derived mint, space, lamports, and signer/writable
metas. It then compiles the legacy message and requires sponsor as fee payer
and sole required signer, and the derived mint as writable non-signer. The
pinned `@solana/web3.js` builder accepts oversized seeds and an unrelated
`newAccountPubkey`; therefore successful SDK construction is never validation
evidence.

The 108-bit truncation has a negligible but non-zero collision probability;
it is not treated as uniqueness proof. Preflight recomputes the complete
derivation tuple and fails closed on a reused execution ID, a tuple/address
conflict, or any existing derived account. It does not choose a nonce,
alternate seed, or replacement address. A collision is
`MINT_DERIVATION_COLLISION` and permanently blocks that execution ID. The seed
and all its inputs are public, non-secret data and may be persisted; they are
never used as signer material.

The seed does not depend on plan hash, manifest hash, funding snapshot, quote
blockhash, or derived ATA addresses. The manifest is built after all addresses
are derived, and its hash is computed outside the manifest body. This ordering
prevents a circular dependency.

Manifest v2 binds:

- algorithm and version;
- derivation domain and encoding;
- genesis hash and Program ID;
- execution ID;
- sponsor base;
- System Program ID;
- classic Token Program ID as target owner;
- canonical seed;
- derived mint;
- sponsor ATA and contributor ATA;
- ATA Program ID and its classic-token derivation inputs.

`setup:create_mint` contains exactly two instructions:

1. `SystemProgram.createAccountWithSeed` with sponsor as `fromPubkey` and
   `basePubkey`, the derived mint as a writable non-signer, mint rent, mint
   size, and classic Token Program owner.
2. classic `initializeMint2` for six decimals, the bound mint authority, and no
   freeze authority.

Sponsor is the only required signature and is also fee payer. Tests decode the
System instruction and compiled message to prove its exact metas, base,
derived address, seed, owner, space, lamports, fee payer, and signer count.
Representative pinned-SDK evidence observed compiled account ordering of
sponsor, derived mint, System Program, and classic Token Program. Contract
tests pin this supported transaction shape and fail on any ordering or
legacy-message drift.

## Transaction factory and structural message identity

The transaction factory materializes each enabled step from:

- canonical execution specification;
- manifest-bound public identities and addresses;
- amount and decimals;
- chain-time-derived expiry values;
- rent values;
- a supplied recent blockhash.

It returns instructions plus two related proofs.

The normalized message-template identity used by planning and fee quotation
contains:

- template schema/domain/version and execution-spec hash;
- step ID and order;
- fee-payer public key;
- ordered required signer public keys;
- ordered instruction program IDs;
- ordered account public keys and signer/writable flags per instruction;
- instruction discriminator, data length, and the canonical schema of dynamic
  fields;
- the manifest-bound expiry-policy identity rather than a wall-clock-derived
  expiry value;
- relevant mint, ATA, escrow, and vault addresses.

The normalized identity deliberately excludes recent blockhash, last valid
block height, signatures, concrete expiry values, and exact bytes for dynamic
instruction fields. It replaces runtime release/refund expiry bytes with
typed policy markers. Its
domain-separated hash is the message/spec identity used by the funding quote.
The quote still builds a real unsigned message with valid concrete expiry
values so RPC observes the exact signature count, message size, accounts, and
instructions. The normalized template identity prevents ordinary chain-time
advancement from invalidating the quote while preserving the expiry policy,
field type, field position, and serialized size.

The exact `PREPARED` message identity binds every normalized field plus:

- the fresh recent blockhash and last valid block height;
- concrete release/refund expiry values;
- exact ordered account addresses and compiled account indexes;
- exact instruction bytes and their SHA-256 values;
- serialized legacy-message bytes and their SHA-256;
- every required public signer and persisted signature;
- the canonical transaction signature, which is the fee-payer signature.

The normalized template hash cannot substitute for proof of these exact
values. Reconciliation rebuilds and compares the exact prepared identity.
This permits live execution to use fresh chain time and blockhash without
weakening the authorized builder, payer, signer, account, amount, decimal, or
expiry-policy contract.

## Funding planner

Plan mode exposes only read methods. It reads finalized:

- genesis, slot, and block time;
- Program and ProgramData accounts;
- four identity balances;
- rent exemption for mint, token-account, and escrow sizes;
- a latest blockhash used only for fee quotation;
- `getFeeForMessage` for every one of the twelve unsigned messages.

The planner fails closed if any rent, balance, slot/time, blockhash, or fee
quote is absent or malformed; a message cannot be built; an expected payer or
signer is absent; account inventory differs from the execution spec; or send
and simulation ceilings differ from the spec.

Funding is computed per identity:

```text
minimumRequired =
  rentPaidByIdentity +
  sum(quotedFeesForIdentity)

recommendedFunding =
  minimumRequired +
  deterministicHeadroom

deficit = max(0, recommendedFunding - finalizedBalance)
```

The headroom rule is exact:

```text
if minimumRequired == 0:
  deterministicHeadroom = 0
else:
  deterministicHeadroom = max(
    ceil(minimumRequired * 100 / 10_000),
    maximumQuotedFeePaidByIdentity
  )
```

This is the greater of one percent of the identity's minimum requirement and
one largest quoted transaction fee paid by that identity. It covers bounded
quote/rent movement and one pre-send message rebuild. It does not fund a second
send attempt, retry, replay, or second execution.

The formula is applied independently to each identity. When an identity pays
no quoted fee, its largest quoted fee is zero. The explicit zero-minimum branch
dominates the `max`: an identity whose minimum is zero always has recommended
funding zero. After any separately authorized faucet action, all rents, fees,
balances, quote time/slot, template identities, TTL, and recommendations must
be rebuilt; a pre-faucet quote cannot authorize execution.

Mint authority and contributor remain explicitly evaluated even when their
minimum requirement is zero. The planner rejects any role that appears as a
fee payer or rent payer but lacks a funding result.

The funding snapshot binds:

- finalized slot and block time;
- local observation time;
- quote expiry time and TTL;
- quote blockhash as observation evidence, not an execution blockhash;
- every rent value and account count;
- every step's message-template hash, required signature count, fee payer,
  and quoted fee;
- per-identity rent, fees, minimum, deterministic headroom, recommended
  funding, observed balance, and deficit;
- aggregate send and simulation ceilings;
- execution-spec hash.

The default quote TTL is five minutes. Authorization is ineligible when the
snapshot is expired or any identity is below its recommended funding.

Before any persistent live-execution mutation, a future live preflight obtains
fresh finalized balances, rents, slot/time, a new quote-only blockhash, and
fees for all twelve messages. Message-template hashes must match the manifest. If a
rent or fee changes, or a recommended balance is no longer sufficient, the
preflight fails and requires a newly reviewed plan and authorization. It never
silently amends an authorized funding snapshot.

The quote blockhash is never reused for a send. Every send obtains a fresh
blockhash that is stored only in that step's durable `PREPARED` evidence.

## Plan and manifest v2

The canonical manifest schema is
`R4_BUSINESS_FLOW_MANIFEST_V2`. Its immutable body binds:

- schema and version;
- repository HEAD SHA;
- exact devnet RPC endpoint identity;
- genesis hash;
- Program ID, ProgramData address, upgradeable loader, retained upgrade
  authority, and deployed executable SHA-256;
- execution-spec and instruction-schema hash;
- enabled flows, canonical event IDs, full send ceiling, simulation count, and
  negative-check policy;
- sponsor, maintainer, contributor, and mint-authority public keys;
- canonical reference derivations and every escrow/vault address;
- complete mint/ATA derivation strategy and addresses;
- amount, decimals, and expiry-policy constants;
- complete funding snapshot;
- execution ID;
- creation time, expiry time, and TTL;
- authorization domain and required live-acknowledgement literal.

The plan hash is:

```text
planHash =
  sha256(
    "R4_BUSINESS_FLOW_PLAN_V2" + NUL +
    canonicalJson(manifestBody)
  )
```

`planHash` is an adjacent plan field, not a member of `manifestBody`. The
authorization schema `R4_BUSINESS_FLOW_AUTHORIZATION_V2` binds that exact hash,
execution ID, repository SHA, execution-spec hash, full ceiling, all identity
assertions, manifest expiry, and the literal devnet acknowledgement.

At zero or insufficient funding, plan mode returns
`DRAFT_BLOCKED_FUNDING`, `authorizationEligible: false`, and a
domain-separated `draftPlanHash`. It does not emit a live-authorizable
`planHash`. Pure functions and fake-RPC tests may construct funded manifest
fixtures, but a real live-authorizable manifest is generated only after a
separately authorized faucet phase and a finalized funding snapshot.

Manifest v1, missing or unknown schema, any schema mismatch, draft plan, stale
plan, mismatched manifest/spec/message-template/funding hash or value, and
malformed authorization are rejected before:

- execution-ID reservation;
- operation-lock, receipt-directory, or execution-directory creation;
- `PREPARED`, receipt, or any other evidence creation;
- signer loading;
- blockhash acquisition for sending;
- any authorization-state mutation;
- simulation or send access.

Historical v1 artifacts may be parsed only by an explicitly historical,
read-only inspection path. They can never authorize execution.

## Live preflight and collision policy

All deterministic/schema checks and bounded read-only RPC revalidation complete
before execution-ID reservation or any other persistent mutation.

Preflight rejects:

- repository, genesis, endpoint, Program, ProgramData, loader, authority,
  executable-byte, instruction-schema, or execution-spec drift;
- stale funding snapshot or live re-quote mismatch;
- insufficient sponsor or maintainer balance;
- identity, reference, seed, mint, ATA, escrow, vault, amount, decimal, expiry,
  or ceiling mismatch;
- reused execution ID;
- an existing prepared/pending record;
- any unexplained planned mint, ATA, escrow, or vault account collision.

An existing mint is never reused by live execute. Reconciliation may classify
it as exact evidence for the interrupted execution only when the exact
finalized create-mint transaction and all manifest bindings are proven. That
classification does not authorize resume, replay, or account reuse.

## Durable pre-send evidence

The current production adapter is migration input, not an implementation of
this lifecycle. Today `adapter.send()` builds, obtains a blockhash, signs, and
calls `sendRawTransaction` in one method; receipts are replace-style,
best-effort snapshots written after send/confirmation; receipt failures may be
swallowed; and execution-ID reservation precedes some on-chain rechecks. The
repair must split these boundaries and remove best-effort evidence handling.
Wrapping the current receipt helper does not satisfy this design.

The adapter separates preparation from submission:

```text
build instructions
-> get fresh live blockhash
-> build and sign in memory
-> derive signature and proofs
-> durable PREPARED
-> durable SEND_INTENT
-> sendRawTransaction once
-> confirm/status and verify
-> durable terminal evidence
```

An execution ID is reserved once after all pre-mutation gates pass. Operation
ownership, reservation, evidence journal creation, and every later transition
must use one capability-approved persistence and recovery model. The execution
ID remains consumed for every outcome, including zero-send abandonment.

Evidence is an append-only, monotonic state machine:

```text
ABSENT -> PREPARED -> SEND_INTENT -> TERMINAL
```

Each transition is a separate immutable canonical record. `PREPARED` is
created exclusively and binds the immutable identity projection.
`SEND_INTENT` hash-links to `PREPARED`; terminal evidence hash-links to
`SEND_INTENT`. Repeating a transition is idempotent only when its canonical
bytes are identical. A different record at an occupied transition is an
integrity conflict: there is no last-write-wins behavior. State cannot
downgrade, the message hash and signatures cannot change after `PREPARED`,
and `SEND_INTENT` cannot be deleted or replaced.

The concrete backend is not selected by this spec. Every transition records
the previous evidence hash and its own domain-separated integrity hash. A
missing predecessor, broken hash chain, noncanonical encoding, duplicate
conflict, partial write, or attempted mutation fails closed before adapter
access.

Persistence claims are separate and independently tested:

- atomic visibility: readers see either no complete transition or one complete
  canonical transition;
- exclusive publication: competing writers cannot both claim one transition;
- data integrity: truncation, corruption, mutation, and chain forks are
  detected;
- process-crash recovery: restart reconstructs one monotonic prefix without
  trusting temporary or partial data;
- power-loss durability: an acknowledged transition and its ownership/
  reservation relationship survive the documented storage failure model.

File flush, rename, hard-link publication, and integrity re-read can establish
some of these properties but do not collectively imply power-loss durability
of a directory entry. In particular, the current Windows host returns `EPERM`
for directory fsync and the existing helper ignores it. Windows or any other
platform is not enabled merely because atomic visibility tests pass.

## Persistence capability gate

Before signer loading, live blockhash acquisition, simulation, or any network
send capability becomes reachable, the runtime evaluates a closed,
backend-specific capability proof. Platform name is diagnostic only and never
grants eligibility.

The proof descriptor binds:

- descriptor schema/version and stable backend implementation ID;
- runtime, operating-system, filesystem, mount/device, and backend-version
  observations needed to match the tested environment;
- atomic visibility and exclusive-publication test identities;
- integrity/framing and monotonic recovery algorithm versions;
- process-crash and power-loss durability claims with their exact scope;
- the common durability relationship among operation ownership/lock,
  execution-ID reservation, `PREPARED`, `SEND_INTENT`, terminal evidence, and
  append/journal recovery;
- a domain-separated proof-suite identity and build/repository provenance.

The runtime does not self-certify by running a happy-path rename test. It
accepts only a statically allowlisted descriptor whose complete deterministic
capability suite passed for the matching backend/environment. Missing,
unknown, stale, partially matching, or internally inconsistent capability
evidence returns `LIVE_SEND_DISABLED_PERSISTENCE_CAPABILITY` before any
mutation, signer, simulation, blockhash-for-send, or send adapter access.
Sanitized diagnostics identify the missing capability and descriptor fields.

All lifecycle records must share the approved model. It is invalid, for
example, to durably append `SEND_INTENT` while reservation or operation
ownership depends on an unproven replace-style directory entry. Evidence write
or verification failure is terminal and is never downgraded to best effort.

This Phase-4B implementation may ship with no approved production backend.
That is a valid fail-closed result: plan and read-only reconciliation remain
available, while execute is hard-disabled. A later workstream may spike an
existing-file framed append journal, a transactional backend with a documented
Windows durability contract, or another defensible primitive. Selection
requires its own proof and design amendment; this spec does not preselect one.

Each record is canonical and sanitized. The immutable evidence projection
contains:

- schema/version, execution ID, step ID, and ordinal;
- plan hash and execution-spec hash;
- state: `PREPARED`, `SEND_INTENT`, or a terminal state;
- attempt number, exactly one;
- derived transaction signature;
- SHA-256 of serialized message bytes;
- SHA-256 of serialized signed transaction bytes;
- the complete prepared exact-message proof;
- fee-payer and ordered public signer keys;
- fresh recent blockhash and last valid block height;
- relevant public addresses;
- creation and transition timestamps.

Raw signed transaction bytes exist only in memory between build/sign and the
single send call. The durable record never contains raw transaction bytes,
secret keys, seed phrases, keypair arrays, private signer paths, or
unredacted environment data.

On an enabled backend, `SEND_INTENT` must be durable before
`sendRawTransaction` is invoked. The only
production send entry point accepts a verified durable `SEND_INTENT` handle,
not merely transaction bytes. A write or re-read/integrity failure prevents
send. Architecture tests inject a send adapter that asserts the durable record
exists before the first network-call boundary, and contract tests prove no
other send surface is reachable. The adapter never automatically resends
after a send call, exception, confirmation timeout, receipt failure, or
process restart.

If terminal evidence persistence fails after a confirmed send, the durable
`SEND_INTENT`, signature, message hash, and transaction hash remain sufficient
inputs for read-only reconciliation. The failure remains explicit; it is not
swallowed or reported as terminal success.

## Exact transaction proof

Reconciliation does not require persisted raw transaction bytes or depend on
RPC returning a byte-identical legacy transaction body. Its primary proof
chain is:

1. Rebuild the exact legacy message from the manifest, canonical execution
   spec, transaction factory, and immutable `PREPARED` fields.
2. Require the rebuilt serialized-message hash to equal the prepared hash and
   cryptographically verify every persisted Ed25519 signature against those
   exact message bytes and its public signer. The first signature is the
   canonical transaction/fee-payer signature.
3. Query that exact fee-payer signature on chain and classify its status and
   finality without substituting an address or inferred transaction.
4. Verify the expected post-state and all relevant addresses against the
   manifest and step verifier.

Fee payer, ordered public signers, blockhash, expiry, program IDs, account
metas, exact instruction bytes and hashes, relevant addresses, plan hash,
execution-spec hash, step ID, and ordinal must all match. A valid signature
over the exact reconstructed message, queried under that same signature,
cryptographically binds the on-chain observation to the prepared transaction.

When RPC supplies the transaction body, reconciliation additionally decodes
its raw/base64 or structured legacy message and compares header, account keys,
blockhash, compiled instructions, and data hashes. This is
defense-in-depth, not the sole PASS predicate. The signed-transaction hash is
also corroborating local evidence because structured RPC responses may not
reproduce original wire encoding byte for byte.

A missing or pruned transaction body therefore does not itself defeat the
primary proof chain. Missing/malformed prepared evidence, failed signature
verification, a conflicting body, unsafe SDK reconstruction, or inability to
query the exact signature does fail closed.

## Read-only reconciliation

The reconciliation command requires explicit plan, authorization, execution
ID, and receipt paths. It does not scan arbitrary executions or infer a target.
Its production RPC adapter exposes only:

- genesis, slot, and block time reads;
- account reads;
- signature status and transaction reads.

It exposes no signer loading, blockhash-for-send, simulation, send,
confirmation mutation, airdrop, close, or resume method. Reconciliation does
not modify execution-ID state, receipts, prepared records, authorization
state, or on-chain accounts. Its canonical report is returned to stdout; an
operator may redirect it to a separate non-authoritative file.

Per-step reconciliation distinguishes:

- `NOT_PREPARED`;
- `PREPARED_NO_SEND_INTENT`;
- `SIGNATURE_ABSENT`;
- `OBSERVED_PROCESSED`;
- `OBSERVED_CONFIRMED`;
- `RPC_UNAVAILABLE`;
- `FINALIZED_SUCCESS_EXACT`;
- `FINALIZED_SUCCESS_BODY_UNAVAILABLE`;
- `CONFIRMED_FAILED_EXACT`;
- `CONFIRMED_FAILED_BODY_UNAVAILABLE`;
- `POST_STATE_MISMATCH`;
- `EVIDENCE_INCONSISTENT`.

`OBSERVED_PROCESSED` and `OBSERVED_CONFIRMED` mean the exact signature is
visible but is not finalized; both remain unknown terminally and never
authorize progress. Finalized `err == null` is a success classification only
after the primary proof chain and post-state match. The `EXACT` variant records
that the optional RPC body also matched; `BODY_UNAVAILABLE` records that the
body was unavailable or pruned but the cryptographic signature/status and
post-state proof chain remained complete.

A finalized signature with `err != null` is a `CONFIRMED_FAILED_*` variant
after the exact prepared signature is proven. Reconciliation verifies the
failure post-state policy; a failed transaction is never safe-to-abandon and
never authorizes retry. `POST_STATE_MISMATCH` covers any finalized status whose
required success/failure post-state is inconsistent. Malformed, tampered,
hash-chain-conflicting, or cryptographically invalid local evidence is
`EVIDENCE_INCONSISTENT` before its contents are trusted.

`RPC_UNAVAILABLE` means the read failed or could not be completed.
`SIGNATURE_ABSENT` means the RPC read completed successfully and returned no
status for the exact signature. They are never conflated. After
`SEND_INTENT`, either result remains unknown because absence and blockhash
expiry cannot prove that no send occurred.

Overall outcomes are:

- `COMPLETE`: every enabled send is finalized successful, every required
  post-state matches, and all evidence is consistent.
- `SAFE_TO_ABANDON`: no step has `SEND_INTENT`; there are no step records, or
  the only step record is a valid `PREPARED` record; no earlier step is
  confirmed or unknown; all planned accounts are absent; RPC reads completed;
  and the exact persistence descriptor proves both that the production code
  could not call send before durable `SEND_INTENT` and that acknowledged
  `SEND_INTENT` evidence could not disappear under its supported crash model.
  Without the complete capability proof, including on the current unsupported
  Windows configuration, `PREPARED_NO_SEND_INTENT` is always
  `BLOCKED_UNKNOWN`, not safe abandonment. The execution ID remains
  permanently consumed.
- `PARTIAL_CONFIRMED`: one or more exact sends are finalized successful or
  failed, remaining steps were not started, and there is no conflicting
  evidence. No resume or replay is proposed.
- `BLOCKED_UNKNOWN`: RPC is unavailable; an exact signature is absent after
  `SEND_INTENT`; a signature is only processed/confirmed; or the primary
  cryptographic proof chain is unavailable. Transaction-body unavailability
  alone is not sufficient when that primary chain remains sound.
- `EVIDENCE_INCONSISTENT`: plan, authorization, record, signature,
  transaction, address, ordering, or post-state evidence conflicts.

Blockhash expiry is never proof that a transaction was not sent or processed.
If `SEND_INTENT` is durable and the process dies before the actual network
call, reconciliation still returns `BLOCKED_UNKNOWN`. This is a deliberate
exactly-once safety trade-off: the execution may be abandoned forever, cannot
resume, cannot reuse its execution ID, and cannot be replayed.

If recovery finds `PREPARED` without `SEND_INTENT` under an absent, stale, or
unsupported persistence descriptor, it reports the missing capability and
returns `BLOCKED_UNKNOWN`. It never reasons from a missing file alone, never
automatically abandons, and never retries.

## Mint reconciliation

Mint observation is classified independently from overall execution:

- `MINT_ABSENT`: account read completed and the derived address is absent.
- `MINT_VALID`: exact finalized `setup:create_mint` proof exists and the
  account matches every invariant.
- `MINT_MISMATCHED`: account exists but address, owner, data length,
  initialization, mint authority, freeze authority, decimals, rent, or exact
  transaction proof differs.
- `MINT_RPC_UNKNOWN`: account or transaction proof could not be read
  conclusively.

`MINT_VALID` requires:

- exact derived address;
- classic Token Program owner;
- classic mint data size;
- initialized state;
- six decimals;
- bound mint authority;
- no freeze authority;
- at least the authorized rent value;
- exact finalized create-with-seed and initialize-mint instruction proof.

ATA reconciliation similarly checks the bound address, classic Token Program
owner, data size, mint, token owner, and exact creation proof. Escrow and vault
checks use the committed decoders and manifest-bound program/token identities.

## Crash-window guarantees

Deterministic tests inject failures at every boundary:

- after execution validation but before reservation;
- after reservation but before build;
- after build/sign but before `PREPARED`;
- after `PREPARED` but before `SEND_INTENT`;
- after `SEND_INTENT` but before the send call;
- send throw after possible submission;
- signature present with confirmation unknown;
- finalized failed transaction;
- finalized success before terminal receipt;
- terminal receipt write failure;
- prepared-record tampering;
- plan/spec/signature/message/account/instruction mismatch;
- process restart with partial evidence.

Every case asserts one send attempt at most, no blind resend, no next-step
advancement after uncertainty, no execution-ID reuse, and no secret material.

## Implementation proof gates

The implementation plan begins by pinning the two successful local proofs and
the conservative capability-gate behavior before any broader production
refactor:

1. Construct and decode `SystemProgram.createAccountWithSeed` locally to prove
   explicit application rejection of oversized/noncanonical seeds and wrong
   derived addresses before builder access, followed by decoded base, seed,
   owner, address, metas, sponsor fee payer, and one-signature legacy-message
   assertions. A separate negative fixture pins that the SDK builder itself
   accepts invalid seed/address inputs and therefore cannot be the validator.
2. Construct and sign every supported legacy transaction shape locally, rebuild
   their exact message from persisted public fields, verify all Ed25519
   signatures with native `node:crypto`, and exercise fake RPC responses with
   and without transaction bodies to prove the signature/status/post-state
   chain. No direct `tweetnacl` dependency is required.
3. With no production descriptor allowlisted, prove execute returns
   `LIVE_SEND_DISABLED_PERSISTENCE_CAPABILITY` before mutation, signer,
   simulation, blockhash, or send access. Injected architecture tests also
   prove the only send entry point requires a capability-approved durable
   `SEND_INTENT` handle and that unsupported recovery maps
   `PREPARED_NO_SEND_INTENT` to `BLOCKED_UNKNOWN`.

These spikes use deterministic fixtures and fake RPC only: no faucet, send,
live simulation, or devnet mutation. The first two representative proofs have
passed against Node 24.15.0, `@solana/web3.js` 1.98.4, and
`@solana/spl-token` 0.4.13; implementation converts them into regression gates
for every supported shape. If a regression gate or unsupported-capability
ordering proof fails, implementation stops with `PARTIAL`, this design is
reopened, and no remaining Phase 4B task proceeds. A need for Rust/IDL changes
or secret persistence is an immediate blocker.

Enabling a concrete production persistence descriptor is outside this repair's
PASS criteria. It requires a separate backend proof workstream. Until then,
Phase 4B may PASS as a planner/manifest/reconciliation repair only with live
execute demonstrably hard-disabled by the capability gate.

## Required contract tests

Tests prove:

- canonical seed domain separation, UTF-8 length, encoding, stability, and
  execution-specific uniqueness, including genesis hash and Program ID;
- canonical execution-ID acceptance/rejection, 108-bit truncation, public seed
  treatment, deterministic collision detection, and fail-closed no-fallback
  behavior;
- application seed/address rejection before builder access, SDK
  non-enforcement fixture, decoded create-with-seed base, payer, owner,
  address, writable/signer metas, and one-signature message;
- deterministic mint and ATA derivation;
- mint collision and wrong owner, size, initialization, authority, freeze
  authority, decimals, and rent;
- exact twelve sends, three simulations, and full ceiling twelve;
- one mint, two ATA, three escrow, and three vault rent inventory;
- sponsor pays eleven sends and maintainer pays one;
- planner quotes every send exactly once and evaluates all four identities;
- executor cannot send or simulate an unknown, disabled, duplicate, or
  out-of-order step;
- planner cannot omit a payer, signer, rent account, balance, fee, or ceiling
  contribution;
- manifest canonicalization, tamper detection, schema-v1 rejection, repository
  and spec drift, funding TTL, and draft-plan rejection;
- all schema and authorization failures occur before persistent mutation;
- absent/unknown/stale persistence descriptors fail before mutation, signer,
  simulation, blockhash, or send access and emit sanitized diagnostics;
- capability tests treat atomic visibility, exclusive publication, integrity,
  process recovery, and power-loss durability as separate claims;
- operation ownership, execution-ID reservation, and every evidence transition
  reject mixed or partially proven durability models;
- append-only prepared-record atomicity, integrity hash chain, immutable
  signatures/message identity, monotonic state transitions, and evidence
  conflict rejection without last-write-wins;
- exact transaction/signature proof reconstruction with transaction body
  present, unavailable, and pruned;
- signature absent versus RPC unavailable, and processed/confirmed versus
  finalized status;
- finalized success with `err == null`, finalized failure with `err != null`,
  body-unavailable proof, post-state mismatch, tampered evidence, partial,
  conditionally safe abandonment, unknown, and inconsistent outcomes;
- production send is unreachable before durable `SEND_INTENT`;
- unsupported recovery never maps `PREPARED_NO_SEND_INTENT` to safe
  abandonment or retry;
- reconciliation exposes no send, simulation, resume, airdrop, close, or
  signer surface;
- CLI execute fails before send on every required drift or collision;
- no secret or raw signer material is persisted or emitted.

Existing tests are changed only where they pin behavior proven wrong by the
concrete executor or the approved deterministic-mint design. Each such change
is paired with a failing contract test before production code changes.

## Documentation and operator policy

Operator documentation distinguishes:

- read-only planner output;
- funded live-authorization manifest;
- finalized funding snapshot;
- durable prepared/send-intent evidence;
- terminal execution receipt;
- read-only reconciliation report.

It states explicitly:

- faucet authorization and live-execution authorization are separate;
- funding never authorizes execution;
- reconciliation never sends, simulates, resumes, retries, closes, reclaims,
  or changes authorization state;
- execution IDs are single-use for every outcome;
- partial, failed, unknown, or inconsistent execution stops;
- no mainnet SOL or real-asset wallet may be used;
- no blind retry is allowed.

## Publication and pass criteria

Publication is allowed only if the diff remains limited to client tooling,
tests, and documentation; no Rust or IDL semantic change is required; all
focused and full repository validation passes; secret and static scans are
clean; devnet received no write or simulation; and reconciliation remains
provably read-only.

Phase 4B can return
`BUSINESS_FLOW_PLANNER_MANIFEST_RECONCILIATION_PASS` only when:

- planner and executor derive from the same canonical spec;
- funding and fee quotation cover the exact transaction factory output for all
  identities;
- manifest v2 binds the reviewed execution and finalized funding identity;
- old/draft/stale manifests fail before persistent mutation;
- no live send is reachable without an approved persistence descriptor; when
  no descriptor is approved, execute is hard-disabled before mutation and
  signer access;
- any future enabled descriptor proves signature/message durability and the
  complete ownership/reservation/evidence relationship before send;
- every crash window has a deterministic fail-closed classification;
- read-only reconciliation is complete and tested;
- live execution gates fail before every unauthorized send.

If application validation cannot compensate for the pinned SDK's
create-with-seed non-enforcement, any supported transaction shape cannot be
reconstructed safely, capability gating can be bypassed, private-key
persistence becomes necessary, or a Rust/IDL semantic change is required,
implementation stops with `PARTIAL` or `BLOCKED`.
