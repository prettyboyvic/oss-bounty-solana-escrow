// End-to-end tests for the top-level orchestration driver executeFullMatrix.
//
// These drive the complete acceptance matrix through a STATEFUL fake adapter and
// a deterministic fake clock. No real devnet connection, no real signing, no real
// time is ever used. The fake adapter maintains an in-memory ledger (escrow status
// machine + token balances) so that post-state verification exercises the real
// decoders and verify helpers exactly as the live path would.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { DEVNET_GENESIS_HASH, DEVNET_RPC_URL } from "../../scripts/devnet/safety.mjs";
import { buildPlan } from "../../scripts/devnet/business-flow-runner.mjs";
import { discriminator, ESCROW_STATUS } from "../../scripts/devnet/business-flow-instructions.mjs";
import { deriveBusinessFlowMint } from "../../scripts/devnet/business-flow-identity.mjs";
import {
  OUTCOME,
  createCanonicalExecutionContext,
  createCanonicalRuntimeEffects,
  executeFullMatrix,
} from "../../scripts/devnet/business-flow-execution.mjs";
import {
  BUSINESS_FLOW_EXECUTION_SPEC,
  executionSpecHash,
  selectExecutionEvents,
} from "../../scripts/devnet/business-flow-spec.mjs";
import {
  buildStepInstructions,
  createBusinessFlowExecutionRegistry,
} from "../../scripts/devnet/business-flow-transaction-factory.mjs";

const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const PROGRAM_ID = "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z";
const UPGRADE_AUTHORITY = "Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk";
const SPONSOR = "CY5KKnfh1TdSCmm3PuwCrCL5aGLEaqm8ZHiK8Q6AqDHq";
const MAINTAINER = "7xBirdhUMsm7KEnfvx7mvUSrhVzZoJhoc4jnCurQo8S6";
const CONTRIBUTOR = "DG2kRnmBhZVAusBUfG7eGqUHNXo2rQJ3Z1PCLrUURceT";
const MINT_AUTHORITY = "7auk8apjydhbbDkwyjD3EJQopmckUMyaa1JTNp8e6fz7";
const RENT = { mintRent: 1_461_600, tokenAccountRent: 2_039_280, escrowRent: 2_470_800 };
const AMOUNT = 1_000_000;

const DISC = {
  initialize_escrow: [...discriminator("global", "initialize_escrow")].join(","),
  fund_escrow: [...discriminator("global", "fund_escrow")].join(","),
  release: [...discriminator("global", "release")].join(","),
  refund: [...discriminator("global", "refund")].join(","),
  cancel: [...discriminator("global", "cancel")].join(","),
};

function discOf(ix) {
  return [...Buffer.from(ix.data).subarray(0, 8)].join(",");
}

function instructionShape(ix) {
  return {
    programId: ix.programId.toBase58(),
    data: Buffer.from(ix.data).toString("hex"),
    keys: ix.keys.map(({ pubkey, isSigner, isWritable }) => ({
      pubkey: pubkey.toBase58(),
      isSigner,
      isWritable,
    })),
  };
}

function runtimeFailure(code) {
  return `Program ${PROGRAM_ID} failed: custom program error: 0x${code.toString(16)}`;
}

function programDataAddress() {
  return PublicKey.findProgramAddressSync(
    [new PublicKey(PROGRAM_ID).toBuffer()],
    new PublicKey(UPGRADEABLE_LOADER),
  )[0].toBase58();
}

function makeReadOnlyRpc() {
  const pd = programDataAddress();
  return {
    getGenesisHash: async () => DEVNET_GENESIS_HASH,
    getAccountInfo: async (pk) => {
      const key = pk.toBase58();
      if (key === PROGRAM_ID) {
        const data = Buffer.alloc(36);
        data.writeUInt32LE(2, 0);
        new PublicKey(pd).toBuffer().copy(data, 4);
        return { owner: new PublicKey(UPGRADEABLE_LOADER), executable: true, data };
      }
      if (key === pd) {
        const data = Buffer.alloc(45);
        data.writeUInt32LE(3, 0);
        data.writeUInt8(1, 12);
        new PublicKey(UPGRADE_AUTHORITY).toBuffer().copy(data, 13);
        return { owner: new PublicKey(UPGRADEABLE_LOADER), executable: false, data };
      }
      return null;
    },
    getBalance: async (pk) => (pk.toBase58() === SPONSOR ? 5_000_000_000 : 1_000_000_000),
  };
}

async function freshPlan(nowMs = Date.now()) {
  return buildPlan(
    {
      rpcUrl: DEVNET_RPC_URL,
      expectedProgramId: PROGRAM_ID,
      identities: { sponsor: SPONSOR, maintainer: MAINTAINER, contributor: CONTRIBUTOR },
      flows: ["release", "refund", "cancel"],
      uniquenessToken: "full-matrix-test",
      amount: AMOUNT,
      rentReads: RENT,
      nowMs,
    },
    makeReadOnlyRpc(),
  );
}

function validAuthorization(plan, executionId = "matrix-1") {
  return {
    manifestHash: plan.manifestHash,
    expectedGenesisHash: DEVNET_GENESIS_HASH,
    expectedProgramId: PROGRAM_ID,
    executionId,
    transactionCeiling: plan.transactionCeiling,
    enabledFlows: ["release", "refund", "cancel"],
    identityAssertions: { sponsor: SPONSOR, maintainer: MAINTAINER, contributor: CONTRIBUTOR },
    acknowledgeDevnet: "R4_DEVNET_BUSINESS_FLOW",
  };
}

// --- Ledger encoders (mirror the on-chain layouts the decoders expect) ---
function encodeEscrow(statusIndex) {
  const buf = Buffer.alloc(227);
  buf.writeUInt8(statusIndex, 224); // status index offset in decodeEscrow
  return buf;
}
function encodeToken(amount) {
  const buf = Buffer.alloc(165);
  buf.writeBigUInt64LE(BigInt(amount), 64);
  return buf;
}
function encodeMint(decimals = 6) {
  const buf = Buffer.alloc(82);
  buf.writeUInt8(decimals, 44);
  buf.writeUInt8(1, 45);
  return buf;
}
const STATUS_INDEX = Object.fromEntries(ESCROW_STATUS.map((s, i) => [s, i]));

// A deterministic fake clock. sleep advances a virtual wall clock only.
function makeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

// Stateful fake adapter + ledger. `mode` tweaks failure injection.
function makeFakeAdapter({
  receiptDir,
  clock,
  chainAdvancesPerSecond = true,
  chainBase = 1_800_000_000,
  sendHook = null,
  confirmHook = null,
  signerOverrides = {},
} = {}) {
  const pd = programDataAddress();
  const escrows = new Map();
  const tokens = new Map();
  const tokenOwnedAccounts = new Map();
  const sends = [];
  const simulations = [];
  let sig = 0;

  const applyEscrowIx = (ix) => {
    const d = discOf(ix);
    const keys = ix.keys.map((k) => k.pubkey.toBase58());
    if (d === DISC.initialize_escrow) {
      escrows.set(keys[2], { status: STATUS_INDEX.Initialized, vault: keys[3], amount: AMOUNT });
      tokens.set(keys[3], 0n);
    } else if (d === DISC.fund_escrow) {
      const escrow = keys[3];
      const vault = keys[4];
      const sponsorToken = keys[2];
      const e = escrows.get(escrow);
      e.status = STATUS_INDEX.Funded;
      tokens.set(sponsorToken, (tokens.get(sponsorToken) ?? 0n) - BigInt(e.amount));
      tokens.set(vault, (tokens.get(vault) ?? 0n) + BigInt(e.amount));
    } else if (d === DISC.release) {
      const escrow = keys[2];
      const vault = keys[3];
      const contributorToken = keys[4];
      const e = escrows.get(escrow);
      e.status = STATUS_INDEX.Released;
      tokens.set(vault, (tokens.get(vault) ?? 0n) - BigInt(e.amount));
      tokens.set(contributorToken, (tokens.get(contributorToken) ?? 0n) + BigInt(e.amount));
    } else if (d === DISC.refund) {
      const escrow = keys[2];
      const vault = keys[3];
      const sponsorToken = keys[4];
      const e = escrows.get(escrow);
      e.status = STATUS_INDEX.Refunded;
      tokens.set(vault, (tokens.get(vault) ?? 0n) - BigInt(e.amount));
      tokens.set(sponsorToken, (tokens.get(sponsorToken) ?? 0n) + BigInt(e.amount));
    } else if (d === DISC.cancel) {
      escrows.get(keys[1]).status = STATUS_INDEX.Cancelled;
    }
  };

  const applyTokenIx = (ix) => {
    const pid = ix.programId.toBase58();
    if (pid === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) {
      tokens.set(ix.keys[1].pubkey.toBase58(), 0n); // created ATA starts empty
    } else if (pid === TOKEN_PROGRAM_ID.toBase58() && Buffer.from(ix.data)[0] === 20) {
      tokenOwnedAccounts.set(ix.keys[0].pubkey.toBase58(), encodeMint());
    } else if (pid === TOKEN_PROGRAM_ID.toBase58() && Buffer.from(ix.data)[0] === 7) {
      const dest = ix.keys[1].pubkey.toBase58();
      const amt = Buffer.from(ix.data).readBigUInt64LE(1);
      tokens.set(dest, (tokens.get(dest) ?? 0n) + amt);
    }
  };

  return {
    receiptDir,
    signerPublicKeys: {
      sponsor: SPONSOR,
      maintainer: MAINTAINER,
      contributor: CONTRIBUTOR,
      mintAuthority: MINT_AUTHORITY,
      feePayer: SPONSOR,
      ...signerOverrides,
    },
    _sends: sends,
    _simulations: simulations,
    _escrows: escrows,
    _tokens: tokens,

    async readAccount(address) {
      if (address === PROGRAM_ID) {
        const data = Buffer.alloc(36);
        data.writeUInt32LE(2, 0);
        new PublicKey(pd).toBuffer().copy(data, 4);
        return { owner: new PublicKey(UPGRADEABLE_LOADER), executable: true, data };
      }
      if (escrows.has(address)) return { data: encodeEscrow(escrows.get(address).status) };
      if (tokenOwnedAccounts.has(address)) {
        return {
          owner: new PublicKey(TOKEN_PROGRAM_ID),
          data: tokenOwnedAccounts.get(address),
        };
      }
      if (tokens.has(address)) {
        return {
          owner: new PublicKey(TOKEN_PROGRAM_ID),
          data: encodeToken(tokens.get(address)),
        };
      }
      return null;
    },
    async readBalance() {
      return 5_000_000_000;
    },
    async getMinimumBalanceForRentExemption() {
      return RENT.mintRent;
    },
    async getChainTime() {
      return chainAdvancesPerSecond ? chainBase + Math.floor(clock.now() / 1000) : chainBase;
    },
    async simulate({ instructions, feePayerRole, signerRoles }) {
      simulations.push({ instructions, feePayerRole, signerRoles });
      const d = discOf(instructions[0]);
      if (d === DISC.refund) {
        return { err: { InstructionError: [0, { Custom: 6008 }] }, logs: [runtimeFailure(6008)], unitsConsumed: 10 };
      }
      if (d === DISC.release) {
        if (signerRoles.includes("contributor")) {
          return { err: { InstructionError: [0, { Custom: 6005 }] }, logs: [runtimeFailure(6005)], unitsConsumed: 10 };
        }
        return { err: { InstructionError: [0, { Custom: 6007 }] }, logs: [runtimeFailure(6007)], unitsConsumed: 10 };
      }
      return { err: { InstructionError: [0, { Custom: 6000 }] }, logs: [], unitsConsumed: 1 };
    },
    async send({ instructions, feePayerRole, signerRoles }) {
      sends.push({
        disc: instructions[0] ? discOf(instructions[0]) : null,
        instructions,
        feePayerRole,
        signerRoles,
      });
      if (sendHook) {
        const hooked = sendHook(sends.length, { instructions, feePayerRole, signerRoles });
        if (hooked) return hooked; // hook may throw or return a custom result
      }
      for (const ix of instructions) {
        if (ix.programId.toBase58() === PROGRAM_ID) applyEscrowIx(ix);
        else applyTokenIx(ix);
      }
      sig += 1;
      return { signature: `sig-${sig}`, blockhash: "bh", lastValidBlockHeight: 1 };
    },
    async confirm(out) {
      if (confirmHook) return confirmHook(out);
      return { value: { err: null } };
    },
    async signatureStatus() {
      return { err: null };
    },
    writeReceipt() {},
  };
}

test("canonical execution context derives a deterministic value-only mint identity", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
  });
  const grant = validAuthorization(plan);
  const context = await createCanonicalExecutionContext({
    plan,
    grant,
    adapter,
    chainTimeSeconds: 1_800_000_000,
    mintLamports: RENT.mintRent,
  });
  const derivation = await deriveBusinessFlowMint({
    executionId: grant.executionId,
    genesisHash: DEVNET_GENESIS_HASH,
    programId: PROGRAM_ID,
    sponsorBase: SPONSOR,
  });

  assert.deepEqual(Object.keys(context), [
    "executionId",
    "genesisHash",
    "programId",
    "sponsor",
    "maintainer",
    "contributor",
    "mintAuthority",
    "mint",
    "mintSeed",
    "mintLamports",
    "decimals",
    "amount",
    "setupMintAmount",
    "sponsorToken",
    "contributorToken",
    "instances",
    "releaseExpiry",
    "refundExpiry",
    "expiryPolicyIds",
  ]);
  assert.equal(context.mint, derivation.mint);
  assert.equal(context.mintSeed, derivation.seed);
  assert.equal(context.refundExpiry, null);
  assert.equal("instructions" in context, false);
  assert.equal("keys" in context, false);
  assert.equal("data" in context, false);
  assert.equal("isSigner" in context, false);
});

test("executor instructions, metas, payer roles, and signer roles equal the canonical factory", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
  });
  const authorization = validAuthorization(plan);
  const out = await executeFullMatrix(plan, authorization, adapter, {
    nowMs: plan.createdAtMs + 1,
    clock,
    mintLamports: RENT.mintRent,
  });
  const derivation = await deriveBusinessFlowMint({
    executionId: authorization.executionId,
    genesisHash: DEVNET_GENESIS_HASH,
    programId: PROGRAM_ID,
    sponsorBase: SPONSOR,
  });
  const expectedContext = {
    ...(await createCanonicalExecutionContext({
      plan,
      grant: authorization,
      adapter,
      chainTimeSeconds: 1_800_000_000,
      mintLamports: RENT.mintRent,
    })),
    refundExpiry: 1_800_000_020n,
  };
  const selected = selectExecutionEvents(
    BUSINESS_FLOW_EXECUTION_SPEC,
    authorization.enabledFlows,
  );
  const registry = createBusinessFlowExecutionRegistry();

  assert.equal(out.mint, derivation.mint);
  assert.equal("mint" in adapter.signerPublicKeys, false);
  assert.equal(adapter._sends.length, selected.sendEvents.length);
  assert.equal(adapter._simulations.length, selected.simulationEvents.length);

  for (let index = 0; index < selected.sendEvents.length; index += 1) {
    const event = selected.sendEvents[index];
    const expected = await buildStepInstructions(event.id, expectedContext, registry);
    const actual = adapter._sends[index];
    assert.deepEqual(
      actual.instructions.map(instructionShape),
      expected.map(instructionShape),
      event.id,
    );
    assert.equal(actual.feePayerRole, event.feePayerRole, event.id);
    assert.deepEqual(
      actual.signerRoles,
      event.requiredNonPayerSignerRoles,
      event.id,
    );
  }
  for (let index = 0; index < selected.simulationEvents.length; index += 1) {
    const event = selected.simulationEvents[index];
    const expected = await buildStepInstructions(event.id, expectedContext, registry);
    const actual = adapter._simulations[index];
    assert.deepEqual(
      actual.instructions.map(instructionShape),
      expected.map(instructionShape),
      event.id,
    );
    assert.equal(actual.feePayerRole, event.feePayerRole, event.id);
    assert.deepEqual(
      actual.signerRoles,
      event.requiredNonPayerSignerRoles,
      event.id,
    );
  }

  const createMint = adapter._sends[0].instructions[0];
  assert.equal(
    Buffer.from(createMint.data).subarray(0, 4).toString("hex"),
    "03000000",
  );
  assert.equal(createMint.data.length, 124);
  assert.deepEqual(
    createMint.keys.map((key) => key.isSigner),
    [true, false],
  );
  const setupTransaction = new Transaction({
    feePayer: new PublicKey(SPONSOR),
    recentBlockhash: PROGRAM_ID,
  }).add(...adapter._sends[0].instructions);
  const setupMessage = setupTransaction.compileMessage();
  assert.equal(setupMessage.header.numRequiredSignatures, 1);
  assert.deepEqual(
    setupMessage.accountKeys
      .slice(0, setupMessage.header.numRequiredSignatures)
      .map((key) => key.toBase58()),
    [SPONSOR],
  );
});

test("refund expiry is derived immediately before refund initialize and reused unchanged", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
  });
  let chainReads = 0;
  adapter.getChainTime = async () => {
    chainReads += 1;
    if (chainReads === 1) return 1_800_000_000;
    if (chainReads === 2) return 1_800_000_100;
    return 1_800_000_121;
  };

  const baseline = createBusinessFlowExecutionRegistry();
  const baselineBuilders = Object.fromEntries(baseline.builders);
  const observed = [];
  const overrides = {};
  for (const event of BUSINESS_FLOW_EXECUTION_SPEC.events.filter(
    (candidate) =>
      candidate.flow === "refund" && candidate.kind !== "WAIT",
  )) {
    overrides[event.instructionBuilderId] = async (context) => {
      observed.push({ eventId: event.id, refundExpiry: context.refundExpiry });
      return baselineBuilders[event.instructionBuilderId](context);
    };
  }
  const registry = createBusinessFlowExecutionRegistry({
    builderOverrides: overrides,
  });
  const waitExpiries = [];
  const runtimeEffectsFactory = (input) => {
    const effects = createCanonicalRuntimeEffects(input);
    return {
      ...effects,
      wait(event, context) {
        waitExpiries.push(context.refundExpiry);
        return effects.wait(event, context);
      },
    };
  };

  const out = await executeFullMatrix(
    plan,
    validAuthorization(plan, "matrix-refund-timing"),
    adapter,
    {
      nowMs: plan.createdAtMs + 1,
      clock,
      mintLamports: RENT.mintRent,
      executionRegistry: registry,
      runtimeEffectsFactory,
    },
  );
  assert.equal(out.status, OUTCOME.COMPLETE);
  assert.equal(chainReads >= 3, true);
  assert.deepEqual(
    observed.map(({ eventId }) => eventId),
    [
      "refund:initialize",
      "refund:fund",
      "refund_before_expiry",
      "release_at_or_after_expiry",
      "refund:refund",
    ],
  );
  assert.deepEqual(
    [...new Set(observed.map(({ refundExpiry }) => refundExpiry))],
    [1_800_000_120n],
  );
  assert.deepEqual(waitExpiries, [1_800_000_120n]);

  const selected = selectExecutionEvents(
    BUSINESS_FLOW_EXECUTION_SPEC,
    ["release", "refund", "cancel"],
  );
  const refundInitializeIndex = selected.sendEvents.findIndex(
    (event) => event.id === "refund:initialize",
  );
  assert.equal(
    Buffer.from(
      adapter._sends[refundInitializeIndex].instructions[0].data,
    ).readBigInt64LE(48),
    1_800_000_120n,
  );
});

test("execution recheck rejects equal business roles before adapter or factory effects", async () => {
  const original = await freshPlan();
  const plan = structuredClone(original);
  plan.identities.maintainer = plan.identities.contributor;
  const authorization = validAuthorization(plan, "matrix-duplicate-roles");
  authorization.identityAssertions.maintainer =
    authorization.identityAssertions.contributor;
  const clock = makeClock();
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
  });
  let reads = 0;
  const readAccount = adapter.readAccount.bind(adapter);
  adapter.readAccount = async (...args) => {
    reads += 1;
    return readAccount(...args);
  };

  await assert.rejects(
    executeFullMatrix(plan, authorization, adapter, {
      nowMs: plan.createdAtMs + 1,
      clock,
      mintLamports: RENT.mintRent,
    }),
    /sponsor, maintainer, and contributor must be mutually distinct/,
  );
  assert.equal(reads, 0);
  assert.equal(adapter._sends.length, 0);
  assert.equal(adapter._simulations.length, 0);
});

test("selected event projection mismatch is rejected before adapter or replay access", async () => {
  const original = await freshPlan();
  const plan = structuredClone(original);
  plan.selectedEvents.eventIds = plan.selectedEvents.eventIds.slice(1);
  let adapterAccesses = 0;
  let replayAccesses = 0;
  const adapter = new Proxy(
    {},
    {
      get() {
        adapterAccesses += 1;
        throw new Error("adapter accessed before selection validation");
      },
    },
  );
  const replayIo = {
    existsSyncFn() {
      replayAccesses += 1;
      return false;
    },
    readFn() {
      replayAccesses += 1;
    },
    writeFn() {
      replayAccesses += 1;
    },
    mkdirFn() {
      replayAccesses += 1;
    },
  };

  await assert.rejects(
    executeFullMatrix(plan, validAuthorization(plan), adapter, {
      nowMs: plan.createdAtMs + 1,
      replayIo,
    }),
    /selected event projection mismatch/,
  );
  assert.equal(adapterAccesses, 0);
  assert.equal(replayAccesses, 0);
});

test("funding and manifest tampering is rejected before adapter or replay access", async () => {
  const original = await freshPlan();
  const fixtures = [
    {
      label: "plan funding",
      mutate(plan) {
        plan.funding.byIdentity.maintainer.requiredLamports = 0;
      },
    },
    {
      label: "manifest funding",
      mutate(plan) {
        plan.manifest.funding ??= structuredClone(plan.funding);
        plan.manifest.funding.byIdentity.maintainer.requiredLamports = 0;
      },
    },
    {
      label: "manifest content",
      mutate(plan) {
        plan.manifest.amount += 1;
      },
    },
  ];

  for (const fixture of fixtures) {
    const plan = structuredClone(original);
    fixture.mutate(plan);
    let adapterAccesses = 0;
    let replayAccesses = 0;
    const adapter = new Proxy(
      {},
      {
        get() {
          adapterAccesses += 1;
          throw new Error("adapter accessed before authorization validation");
        },
      },
    );
    const replayIo = {
      existsSyncFn() {
        replayAccesses += 1;
        return false;
      },
      readFn() {
        replayAccesses += 1;
      },
      writeFn() {
        replayAccesses += 1;
      },
      mkdirFn() {
        replayAccesses += 1;
      },
    };

    await assert.rejects(
      executeFullMatrix(
        plan,
        validAuthorization(original, `matrix-tamper-${fixture.label}`),
        adapter,
        { nowMs: original.createdAtMs + 1, replayIo },
      ),
      /(funding projection|manifest hash)/,
      fixture.label,
    );
    assert.equal(adapterAccesses, 0, fixture.label);
    assert.equal(replayAccesses, 0, fixture.label);
  }
});

test("a stop injected at every selected event prevents all later effect access", async () => {
  const plan = await freshPlan();
  const selected = selectExecutionEvents(
    BUSINESS_FLOW_EXECUTION_SPEC,
    ["release", "refund", "cancel"],
  );
  for (let stopIndex = 0; stopIndex < selected.events.length; stopIndex += 1) {
    const clock = makeClock();
    const adapter = makeFakeAdapter({
      receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
      clock,
    });
    const accessed = [];
    const stoppedAt = selected.events[stopIndex].id;
    const runtimeEffectsFactory = (input) => {
      const effects = createCanonicalRuntimeEffects(input);
      return {
        ...effects,
        async beforeEvent(event, context) {
          accessed.push(event.id);
          if (event.id === stoppedAt) {
            throw new Error(`INJECTED_STOP:${stoppedAt}`);
          }
          return effects.beforeEvent(event, context);
        },
      };
    };
    const out = await executeFullMatrix(
      plan,
      validAuthorization(plan, `matrix-stop-${stopIndex}`),
      adapter,
      {
        nowMs: plan.createdAtMs + 1,
        clock,
        mintLamports: RENT.mintRent,
        runtimeEffectsFactory,
      },
    );
    assert.equal(out.evidence.at(-1).eventId, stoppedAt);
    assert.equal(out.evidence.at(-1).state, "PRECONDITION_FAILED");
    assert.equal(out.evidence.at(-1).terminal, true);
    assert.equal(out.evidence.at(-1).expectationSatisfied, false);
    assert.deepEqual(
      accessed,
      selected.events.slice(0, stopIndex + 1).map((event) => event.id),
      stoppedAt,
    );
  }
});

test("executeFullMatrix runs the full happy-path sequence with exact accounting", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const dir = mkdtempSync(join(tmpdir(), "efm-"));
  const adapter = makeFakeAdapter({ receiptDir: dir, clock });

  const out = await executeFullMatrix(plan, validAuthorization(plan), adapter, {
    nowMs: plan.createdAtMs + 1,
    clock,
  });

  assert.equal(out.status, OUTCOME.COMPLETE);
  assert.equal(out.stopReason, null);
  assert.equal(out.ceiling.totalWrites, BUSINESS_FLOW_EXECUTION_SPEC.ceilings.sends);

  const expectedSends = BUSINESS_FLOW_EXECUTION_SPEC.events.filter(
    (event) => event.kind === "SEND",
  );
  assert.equal(adapter._sends.length, BUSINESS_FLOW_EXECUTION_SPEC.ceilings.sends);
  const order = out.steps.filter((s) => s.kind === "send").map((s) => s.id);
  assert.deepEqual(order, expectedSends.map((event) => event.id));

  const expectedSimulations = BUSINESS_FLOW_EXECUTION_SPEC.events.filter(
    (event) => event.kind === "SIMULATE",
  );
  assert.equal(out.simulations.length, BUSINESS_FLOW_EXECUTION_SPEC.ceilings.simulations);
  assert.deepEqual(
    out.simulations.map((s) => s.id),
    expectedSimulations.map((event) => event.id),
  );
  for (const s of out.simulations) assert.equal(s.status, "EXPECTED_ERROR");

  // All 12 sends confirmed success.
  for (const s of out.steps.filter((x) => x.kind === "send")) {
    assert.equal(s.outcome, OUTCOME.CONFIRMED_SUCCESS, `${s.id} should confirm`);
  }
});

test("authoritative matrix receipt evidence binds every canonical lifecycle state", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const receipts = [];
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
  });
  adapter.writeReceipt = (name, value) => receipts.push({ name, value });

  const out = await executeFullMatrix(
    plan,
    validAuthorization(plan, "matrix-receipt"),
    adapter,
    { nowMs: plan.createdAtMs + 1, clock },
  );
  const last = receipts.at(-1);
  assert.ok(receipts.length > 0);
  assert.deepEqual(
    [...new Set(receipts.map(({ name }) => name))],
    ["matrix-receipt.matrix.json"],
  );
  assert.deepEqual(last.value.evidence, out.evidence);
  assert.deepEqual(last.value.steps, out.steps);
  assert.deepEqual(last.value.simulations, out.simulations);

  const specHash = executionSpecHash();
  const terminalByEvent = new Map();
  for (const entry of out.evidence) {
    assert.equal(entry.executionSpecHash, specHash);
    assert.equal(entry.executionSpecSchema, BUSINESS_FLOW_EXECUTION_SPEC.schema);
    const event = BUSINESS_FLOW_EXECUTION_SPEC.events.find(
      ({ id }) => id === entry.eventId,
    );
    assert.ok(event, entry.eventId);
    assert.equal(entry.order, event.order);
    assert.equal(entry.kind, event.kind);
    assert.equal(entry.flow, event.flow);
    assert.equal(entry.feePayerRole, event.feePayerRole);
    assert.deepEqual(
      entry.requiredNonPayerSignerRoles,
      event.requiredNonPayerSignerRoles,
    );
    if (entry.kind === "SEND" && entry.terminal) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(entry, "signature"),
        true,
      );
    }
    if (entry.terminal) terminalByEvent.set(entry.eventId, entry);
  }

  for (const event of BUSINESS_FLOW_EXECUTION_SPEC.events) {
    const lifecycle = out.evidence
      .filter(({ eventId }) => eventId === event.id)
      .map(({ state }) => state);
    if (event.kind === "SEND") {
      assert.deepEqual(
        lifecycle,
        ["BUILT", "SUBMITTED", "CONFIRMED", "VERIFIED"],
        event.id,
      );
      const terminal = terminalByEvent.get(event.id);
      assert.equal(terminal.state, "VERIFIED");
      assert.equal(terminal.expectationSatisfied, true);
      assert.equal(typeof terminal.signature, "string");
    } else if (event.kind === "SIMULATE") {
      assert.deepEqual(lifecycle, ["BUILT", "EXPECTED_ERROR"], event.id);
      const terminal = terminalByEvent.get(event.id);
      assert.equal(terminal.expectationSatisfied, true);
      assert.equal(Number.isInteger(terminal.code), true);
      assert.equal(typeof terminal.name, "string");
    } else {
      assert.deepEqual(lifecycle, ["BUILT", "WAIT_REACHED"], event.id);
      assert.equal(terminalByEvent.get(event.id).expectationSatisfied, true);
    }
  }

  for (const entry of out.evidence.filter(({ state }) =>
    ["BUILT", "SUBMITTED", "CONFIRMED"].includes(state),
  )) {
    assert.equal(entry.terminal, false);
    assert.equal(entry.expectationSatisfied, false);
  }
});

test("authoritative evidence fields cannot be overridden by classifier payload", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
  });
  const runtimeEffectsFactory = (input) => {
    const effects = createCanonicalRuntimeEffects(input);
    return {
      ...effects,
      async classifySimulation(...args) {
        const classified = await effects.classifySimulation(...args);
        return {
          ...classified,
          eventId: "forged:event",
          state: "VERIFIED",
          terminal: false,
          expectationSatisfied: false,
          executionSpecHash: "forged",
        };
      },
    };
  };
  const out = await executeFullMatrix(
    plan,
    validAuthorization(plan, "matrix-override"),
    adapter,
    {
      nowMs: plan.createdAtMs + 1,
      clock,
      runtimeEffectsFactory,
    },
  );
  const entry = out.evidence.find(
    ({ eventId, state }) =>
      eventId === "unauthorized_release" && state === "EXPECTED_ERROR",
  );
  assert.ok(entry);
  assert.equal(entry.executionSpecHash, executionSpecHash());
  assert.equal(entry.terminal, true);
  assert.equal(entry.expectationSatisfied, true);
});

test("canonical send order and fee payers match the execution spec", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const adapter = makeFakeAdapter({ receiptDir: mkdtempSync(join(tmpdir(), "efm-")), clock });
  await executeFullMatrix(plan, validAuthorization(plan), adapter, { nowMs: plan.createdAtMs + 1, clock });

  const sends = BUSINESS_FLOW_EXECUTION_SPEC.events.filter(
    (event) => event.kind === "SEND",
  );
  assert.deepEqual(
    adapter._sends.map((send) => send.feePayerRole),
    sends.map((event) => event.feePayerRole),
  );
});

test("an unexpected simulation success fails closed before the terminal send", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const adapter = makeFakeAdapter({ receiptDir: mkdtempSync(join(tmpdir(), "efm-")), clock });
  // Force the unauthorized_release simulation to succeed unexpectedly.
  adapter.simulate = async ({ instructions, signerRoles }) => {
    const d = discOf(instructions[0]);
    if (d === DISC.release && signerRoles.includes("contributor")) return { err: null, logs: [], unitsConsumed: 1 };
    return { err: { InstructionError: [0, { Custom: 6000 }] }, logs: [] };
  };
  const out = await executeFullMatrix(plan, validAuthorization(plan), adapter, { nowMs: plan.createdAtMs + 1, clock });
  assert.equal(out.status, OUTCOME.STOPPED_ON_SIMULATION);
  assert.match(out.stopReason, /SIMULATION_UNEXPECTED_SUCCESS:unauthorized_release/);
  const evidence = out.evidence.find(
    ({ eventId, state }) =>
      eventId === "unauthorized_release" && state === "UNEXPECTED_SUCCESS",
  );
  assert.ok(evidence);
  assert.equal(evidence.terminal, true);
  assert.equal(evidence.expectationSatisfied, false);
  // The valid release must never have been sent.
  assert.equal(adapter._sends.some((s) => s.disc === DISC.release), false);
});

test("expiry wait uses chain time and a timeout stops without sending the refund", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  // Chain time never advances -> the bounded wait must TIMEOUT_STOP.
  const adapter = makeFakeAdapter({ receiptDir: mkdtempSync(join(tmpdir(), "efm-")), clock, chainAdvancesPerSecond: false });
  const out = await executeFullMatrix(plan, validAuthorization(plan), adapter, { nowMs: plan.createdAtMs + 1, clock });
  assert.equal(out.status, OUTCOME.STOPPED_ON_EXPIRY_TIMEOUT);
  assert.equal(out.stopReason, "REFUND_EXPIRY_WAIT_TIMEOUT");
  // Refund was never sent; refund:fund happened but refund:refund did not.
  const refundSends = adapter._sends.filter((s) => s.disc === DISC.refund);
  assert.equal(refundSends.length, 0);
  assert.ok(out.steps.some((s) => s.id === "refund:wait_expiry" && s.outcome === "TIMEOUT_STOP"));
  const evidence = out.evidence.find(
    ({ eventId, state }) =>
      eventId === "refund:wait_expiry" && state === "WAIT_TIMEOUT",
  );
  assert.ok(evidence);
  assert.equal(evidence.terminal, true);
  assert.equal(evidence.expectationSatisfied, false);
});

test("a confirmed transaction with a state mismatch stops the whole matrix", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const adapter = makeFakeAdapter({ receiptDir: mkdtempSync(join(tmpdir(), "efm-")), clock });
  // Break the ledger: initialize sets status but we corrupt it so verify sees wrong status.
  const realReadAccount = adapter.readAccount.bind(adapter);
  adapter.readAccount = async (address) => {
    const info = await realReadAccount(address);
    // Make the release escrow always look "Initialized" so release:fund's Funded check fails.
    if (adapter._escrows.has(address)) return { data: encodeEscrow(STATUS_INDEX.Initialized) };
    return info;
  };
  const out = await executeFullMatrix(plan, validAuthorization(plan), adapter, { nowMs: plan.createdAtMs + 1, clock });
  assert.equal(out.status, OUTCOME.STOPPED_ON_STATE_MISMATCH);
  assert.match(out.stopReason, /RELEASE_FAILED:fund/);
  // No step after the failing one.
  const ids = out.steps.map((s) => s.id);
  assert.equal(ids.includes("release:release"), false);
  assert.ok(
    out.evidence.some(
      ({ eventId, state }) =>
        eventId === "release:fund" && state === "VERIFICATION_FAILED",
    ),
  );
  assert.equal(
    out.evidence.some(
      ({ eventId, state }) =>
        eventId === "release:fund" && state === "VERIFIED",
    ),
    false,
  );
});

test("release precondition failure returns and persists terminal false-expectation evidence", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const receipts = [];
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
  });
  adapter.writeReceipt = (_name, value) => receipts.push(value);
  const targetId = "release:release";
  const selected = selectExecutionEvents(
    BUSINESS_FLOW_EXECUTION_SPEC,
    ["release", "refund", "cancel"],
  );
  const targetIndex = selected.events.findIndex(({ id }) => id === targetId);
  const sendsBeforeTarget = selected.events
    .slice(0, targetIndex)
    .filter(({ kind }) => kind === "SEND").length;
  const runtimeEffectsFactory = (input) => {
    const effects = createCanonicalRuntimeEffects(input);
    return {
      ...effects,
      async beforeEvent(event, context) {
        if (event.id === targetId) {
          throw new Error("release balance precondition unavailable");
        }
        return effects.beforeEvent(event, context);
      },
    };
  };

  const out = await executeFullMatrix(
    plan,
    validAuthorization(plan, "matrix-release-precondition"),
    adapter,
    {
      nowMs: plan.createdAtMs + 1,
      clock,
      runtimeEffectsFactory,
    },
  );

  assert.equal(out.status, OUTCOME.STOPPED_ON_STATE_MISMATCH);
  assert.equal(
    out.stopReason,
    "RELEASE_FAILED:release:STOPPED_ON_STATE_MISMATCH",
  );
  assert.equal(adapter._sends.length, sendsBeforeTarget);
  assert.equal(
    out.evidence.some(
      ({ order }) => order > selected.events[targetIndex].order,
    ),
    false,
  );
  assert.deepEqual(
    out.evidence
      .filter(({ eventId }) => eventId === targetId)
      .map(({ state }) => state),
    ["BUILT", "PRECONDITION_FAILED"],
  );
  assert.equal(out.evidence.at(-1).terminal, true);
  assert.equal(out.evidence.at(-1).expectationSatisfied, false);
  assert.equal(out.pendingStep, null);
  assert.deepEqual(receipts.at(-1).evidence, out.evidence);
  assert.equal(receipts.at(-1).finalStatus, out.status);
  assert.equal(receipts.at(-1).stopReason, out.stopReason);
});

test("instruction construction failure terminalizes without sending or accessing later events", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const receipts = [];
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
  });
  adapter.writeReceipt = (_name, value) => receipts.push(value);
  const targetId = "release:release";
  const selected = selectExecutionEvents(
    BUSINESS_FLOW_EXECUTION_SPEC,
    ["release", "refund", "cancel"],
  );
  const targetIndex = selected.events.findIndex(({ id }) => id === targetId);
  const sendsBeforeTarget = selected.events
    .slice(0, targetIndex)
    .filter(({ kind }) => kind === "SEND").length;
  const registry = createBusinessFlowExecutionRegistry({
    builderOverrides: {
      "release-escrow-v1": async () => {
        throw new Error("release instruction construction failed");
      },
    },
  });

  const out = await executeFullMatrix(
    plan,
    validAuthorization(plan, "matrix-release-construction"),
    adapter,
    {
      nowMs: plan.createdAtMs + 1,
      clock,
      executionRegistry: registry,
    },
  );

  assert.equal(out.status, OUTCOME.STOPPED_ON_STATE_MISMATCH);
  assert.equal(adapter._sends.length, sendsBeforeTarget);
  assert.deepEqual(
    out.evidence
      .filter(({ eventId }) => eventId === targetId)
      .map(({ state }) => state),
    ["CONSTRUCTION_FAILED"],
  );
  assert.equal(out.evidence.at(-1).terminal, true);
  assert.equal(out.evidence.at(-1).expectationSatisfied, false);
  assert.equal(
    out.evidence.some(
      ({ order }) => order > selected.events[targetIndex].order,
    ),
    false,
  );
  assert.deepEqual(receipts.at(-1).evidence, out.evidence);
  assert.equal(receipts.at(-1).finalStatus, out.status);
});

test("WAIT beforeEvent failure returns terminal precondition evidence before later effects", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const receipts = [];
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
  });
  adapter.writeReceipt = (_name, value) => receipts.push(value);
  const targetId = "refund:wait_expiry";
  const selected = selectExecutionEvents(
    BUSINESS_FLOW_EXECUTION_SPEC,
    ["release", "refund", "cancel"],
  );
  const targetIndex = selected.events.findIndex(({ id }) => id === targetId);
  const sendsBeforeTarget = selected.events
    .slice(0, targetIndex)
    .filter(({ kind }) => kind === "SEND").length;
  const runtimeEffectsFactory = (input) => {
    const effects = createCanonicalRuntimeEffects(input);
    return {
      ...effects,
      async beforeEvent(event, context) {
        if (event.id === targetId) {
          throw new Error("wait precondition unavailable");
        }
        return effects.beforeEvent(event, context);
      },
    };
  };

  const out = await executeFullMatrix(
    plan,
    validAuthorization(plan, "matrix-wait-precondition"),
    adapter,
    {
      nowMs: plan.createdAtMs + 1,
      clock,
      runtimeEffectsFactory,
    },
  );

  assert.equal(out.status, OUTCOME.STOPPED_ON_EXPIRY_TIMEOUT);
  assert.equal(
    out.stopReason,
    "REFUND_EXPIRY_WAIT_PRECONDITION_FAILED",
  );
  assert.equal(adapter._sends.length, sendsBeforeTarget);
  assert.deepEqual(
    out.evidence
      .filter(({ eventId }) => eventId === targetId)
      .map(({ state }) => state),
    ["BUILT", "PRECONDITION_FAILED"],
  );
  assert.equal(out.evidence.at(-1).terminal, true);
  assert.equal(out.evidence.at(-1).expectationSatisfied, false);
  assert.equal(
    out.evidence.some(
      ({ order }) => order > selected.events[targetIndex].order,
    ),
    false,
  );
  assert.deepEqual(receipts.at(-1).evidence, out.evidence);
  assert.equal(receipts.at(-1).finalStatus, out.status);
});

test("refund context preparation failure terminalizes before construction or send", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const receipts = [];
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
  });
  adapter.writeReceipt = (_name, value) => receipts.push(value);
  let chainTimeReads = 0;
  const getChainTime = adapter.getChainTime.bind(adapter);
  adapter.getChainTime = async () => {
    chainTimeReads += 1;
    if (chainTimeReads === 2) {
      throw new Error("refund expiry context unavailable");
    }
    return getChainTime();
  };
  const selected = selectExecutionEvents(
    BUSINESS_FLOW_EXECUTION_SPEC,
    ["release", "refund", "cancel"],
  );
  const targetId = "refund:initialize";
  const targetIndex = selected.events.findIndex(({ id }) => id === targetId);
  const sendsBeforeTarget = selected.events
    .slice(0, targetIndex)
    .filter(({ kind }) => kind === "SEND").length;

  const out = await executeFullMatrix(
    plan,
    validAuthorization(plan, "matrix-refund-context"),
    adapter,
    {
      nowMs: plan.createdAtMs + 1,
      clock,
    },
  );

  assert.equal(out.status, OUTCOME.STOPPED_ON_STATE_MISMATCH);
  assert.equal(adapter._sends.length, sendsBeforeTarget);
  assert.deepEqual(
    out.evidence
      .filter(({ eventId }) => eventId === targetId)
      .map(({ state }) => state),
    ["PRECONDITION_FAILED"],
  );
  assert.equal(out.evidence.at(-1).terminal, true);
  assert.equal(out.evidence.at(-1).expectationSatisfied, false);
  assert.equal(
    out.evidence.some(
      ({ order }) => order > selected.events[targetIndex].order,
    ),
    false,
  );
  assert.deepEqual(receipts.at(-1).evidence, out.evidence);
  assert.equal(receipts.at(-1).finalStatus, out.status);
});

test("a send throw is classified confirmation-unknown with no blind retry and no next step", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  let sendCount = 0;
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
    sendHook: (n) => {
      sendCount = n;
      if (n === 1) throw new Error("rpc timeout after possible submit");
      return null;
    },
  });
  const out = await executeFullMatrix(plan, validAuthorization(plan), adapter, { nowMs: plan.createdAtMs + 1, clock });
  assert.equal(out.status, OUTCOME.CONFIRMATION_UNKNOWN);
  assert.match(out.stopReason, /SETUP_FAILED:create_mint/);
  assert.equal(sendCount, 1, "must not blind-retry the throwing send");
  // Only the first send step is recorded; nothing after it.
  assert.equal(out.steps.length, 1);
  assert.equal(out.steps[0].outcome, OUTCOME.CONFIRMATION_UNKNOWN);
  assert.ok(
    out.evidence.some(
      ({ eventId, state }) =>
        eventId === "setup:create_mint" && state === "CONFIRMATION_UNKNOWN",
    ),
  );
  assert.equal(
    out.evidence.some(({ state }) => state === "VERIFIED"),
    false,
  );
});

test("confirmation failed evidence is terminal and never VERIFIED", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
    confirmHook: async () => ({
      value: { err: { InstructionError: [0, "InvalidArgument"] } },
    }),
  });
  const out = await executeFullMatrix(
    plan,
    validAuthorization(plan, "matrix-confirm-failed"),
    adapter,
    { nowMs: plan.createdAtMs + 1, clock },
  );
  const evidence = out.evidence.find(
    ({ eventId, state }) =>
      eventId === "setup:create_mint" && state === "CONFIRMATION_FAILED",
  );
  assert.ok(evidence);
  assert.equal(evidence.terminal, true);
  assert.equal(evidence.expectationSatisfied, false);
  assert.equal(out.status, OUTCOME.CONFIRMED_FAILED);
  assert.equal(
    out.stopReason,
    "SETUP_FAILED:create_mint:CONFIRMED_FAILED",
  );
  assert.equal(
    out.evidence.some(({ state }) => state === "VERIFIED"),
    false,
  );
});

test("submission failed evidence is terminal when no signature is returned", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
    sendHook: () => ({}),
  });
  const out = await executeFullMatrix(
    plan,
    validAuthorization(plan, "matrix-submission-failed"),
    adapter,
    { nowMs: plan.createdAtMs + 1, clock },
  );
  const evidence = out.evidence.find(
    ({ eventId, state }) =>
      eventId === "setup:create_mint" && state === "SUBMISSION_FAILED",
  );
  assert.ok(evidence);
  assert.equal(evidence.terminal, true);
  assert.equal(evidence.expectationSatisfied, false);
  assert.equal(out.status, OUTCOME.CONFIRMATION_UNKNOWN);
  assert.equal(
    out.stopReason,
    "SETUP_FAILED:create_mint:CONFIRMATION_UNKNOWN",
  );
  assert.equal(
    out.evidence.some(({ state }) => state === "SUBMITTED"),
    false,
  );
});

test("confirmation unknown evidence after submission never becomes VERIFIED", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
    confirmHook: async () => {
      throw new Error("confirmation unavailable");
    },
  });
  adapter.signatureStatus = async () => null;
  const out = await executeFullMatrix(
    plan,
    validAuthorization(plan, "matrix-confirm-unknown"),
    adapter,
    { nowMs: plan.createdAtMs + 1, clock },
  );
  assert.deepEqual(
    out.evidence.map(({ state }) => state),
    ["BUILT", "SUBMITTED", "CONFIRMATION_UNKNOWN"],
  );
  assert.equal(out.evidence.at(-1).terminal, true);
  assert.equal(out.evidence.at(-1).expectationSatisfied, false);
  assert.equal(out.status, OUTCOME.CONFIRMATION_UNKNOWN);
  assert.equal(
    out.stopReason,
    "SETUP_FAILED:create_mint:CONFIRMATION_UNKNOWN",
  );
});

test("processed, missing, and unknown signature statuses cannot recover thrown confirmation", async () => {
  const fixtures = [
    ["processed", { err: null, confirmationStatus: "processed" }],
    ["missing", { err: null }],
    ["unknown", { err: null, confirmationStatus: "rooted" }],
  ];

  for (const [label, signatureStatus] of fixtures) {
    const plan = await freshPlan();
    const clock = makeClock();
    const adapter = makeFakeAdapter({
      receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
      clock,
      confirmHook: async () => {
        throw new Error("confirmation unavailable");
      },
    });
    adapter.signatureStatus = async () => signatureStatus;
    const out = await executeFullMatrix(
      plan,
      validAuthorization(plan, `matrix-status-${label}`),
      adapter,
      { nowMs: plan.createdAtMs + 1, clock },
    );

    assert.deepEqual(
      out.evidence.map(({ state }) => state),
      ["BUILT", "SUBMITTED", "CONFIRMATION_UNKNOWN"],
      label,
    );
    assert.equal(out.status, OUTCOME.CONFIRMATION_UNKNOWN, label);
    assert.equal(
      out.evidence.some(({ state }) =>
        ["CONFIRMED", "VERIFIED"].includes(state),
      ),
      false,
      label,
    );
  }
});

test("confirmed and finalized signature statuses can recover thrown confirmation", async () => {
  for (const confirmationStatus of ["confirmed", "finalized"]) {
    const plan = await freshPlan();
    const clock = makeClock();
    const adapter = makeFakeAdapter({
      receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
      clock,
      confirmHook: async () => {
        throw new Error("confirmation unavailable");
      },
    });
    adapter.signatureStatus = async () => ({
      err: null,
      confirmationStatus,
    });
    const out = await executeFullMatrix(
      plan,
      validAuthorization(plan, `matrix-status-${confirmationStatus}`),
      adapter,
      { nowMs: plan.createdAtMs + 1, clock },
    );

    assert.equal(out.status, OUTCOME.COMPLETE, confirmationStatus);
    assert.equal(
      out.evidence.filter(({ state }) => state === "VERIFIED").length,
      BUSINESS_FLOW_EXECUTION_SPEC.ceilings.sends,
      confirmationStatus,
    );
  }
});

test("UNEXPECTED_ERROR simulation evidence is terminal and stops", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
  });
  adapter.simulate = async () => ({
    err: { InstructionError: [0, { Custom: 6000 }] },
    logs: [runtimeFailure(6000)],
    unitsConsumed: 1,
  });
  const out = await executeFullMatrix(
    plan,
    validAuthorization(plan, "matrix-unexpected-error"),
    adapter,
    { nowMs: plan.createdAtMs + 1, clock },
  );
  const evidence = out.evidence.find(
    ({ eventId, state }) =>
      eventId === "unauthorized_release" && state === "UNEXPECTED_ERROR",
  );
  assert.ok(evidence);
  assert.equal(evidence.name, "InvalidStatus");
  assert.equal(evidence.terminal, true);
  assert.equal(evidence.expectationSatisfied, false);
  assert.equal(out.status, OUTCOME.STOPPED_ON_SIMULATION);
  assert.equal(
    out.stopReason,
    "SIMULATION_UNEXPECTED_ERROR:unauthorized_release",
  );
});

test("INCONCLUSIVE simulation evidence stops before later events", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
  });
  adapter.simulate = async () => ({
    err: { InstructionError: [0, { Custom: 6999 }] },
    logs: [runtimeFailure(6999)],
    unitsConsumed: 1,
  });
  const out = await executeFullMatrix(
    plan,
    validAuthorization(plan, "matrix-inconclusive"),
    adapter,
    { nowMs: plan.createdAtMs + 1, clock },
  );
  const evidence = out.evidence.find(
    ({ eventId, state }) =>
      eventId === "unauthorized_release" && state === "INCONCLUSIVE",
  );
  assert.ok(evidence);
  assert.equal(evidence.terminal, true);
  assert.equal(evidence.expectationSatisfied, false);
  assert.equal(out.status, OUTCOME.STOPPED_ON_SIMULATION);
  assert.equal(
    out.stopReason,
    "SIMULATION_INCONCLUSIVE:unauthorized_release",
  );
  assert.equal(
    out.evidence.some(({ eventId }) => eventId === "release:release"),
    false,
  );
});

test("an inconclusive wait projects the expiry stop outcome", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
  });
  const runtimeEffectsFactory = (input) => {
    const effects = createCanonicalRuntimeEffects(input);
    return {
      ...effects,
      wait() {
        throw new Error("chain time unavailable");
      },
    };
  };
  const out = await executeFullMatrix(
    plan,
    validAuthorization(plan, "matrix-wait-inconclusive"),
    adapter,
    {
      nowMs: plan.createdAtMs + 1,
      clock,
      runtimeEffectsFactory,
    },
  );

  assert.equal(out.status, OUTCOME.STOPPED_ON_EXPIRY_TIMEOUT);
  assert.equal(out.stopReason, "REFUND_EXPIRY_WAIT_INCONCLUSIVE");
  assert.equal(out.evidence.at(-1).state, "INCONCLUSIVE");
  assert.equal(out.evidence.at(-1).kind, "WAIT");
});

test("the first terminal-stop receipt has derived outcome even if a later write fails", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const receipts = [];
  let terminalReceiptWritten = false;
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
    sendHook: () => {
      throw new Error("rpc timeout after possible submit");
    },
  });
  adapter.writeReceipt = (_name, value) => {
    if (terminalReceiptWritten) {
      throw new Error("later receipt write failed");
    }
    receipts.push(value);
    terminalReceiptWritten = value.evidence.at(-1)?.terminal === true;
  };

  const out = await executeFullMatrix(
    plan,
    validAuthorization(plan, "matrix-terminal-receipt"),
    adapter,
    { nowMs: plan.createdAtMs + 1, clock },
  );
  const terminalReceipts = receipts.filter(
    ({ evidence }) => evidence.at(-1)?.terminal,
  );

  assert.equal(out.status, OUTCOME.CONFIRMATION_UNKNOWN);
  assert.equal(terminalReceipts.length, 1);
  assert.equal(
    terminalReceipts[0].finalStatus,
    OUTCOME.CONFIRMATION_UNKNOWN,
  );
  assert.equal(
    terminalReceipts[0].stopReason,
    "SETUP_FAILED:create_mint:CONFIRMATION_UNKNOWN",
  );
});

test("the first complete receipt is projected before a later write can fail", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const selectedEventCount = BUSINESS_FLOW_EXECUTION_SPEC.events.length;
  const receipts = [];
  let completeReceiptWritten = false;
  const adapter = makeFakeAdapter({
    receiptDir: mkdtempSync(join(tmpdir(), "efm-")),
    clock,
  });
  adapter.writeReceipt = (_name, value) => {
    if (completeReceiptWritten) {
      throw new Error("later receipt write failed");
    }
    receipts.push(value);
    const terminalEventIds = new Set(
      value.evidence
        .filter(
          ({ terminal, expectationSatisfied }) =>
            terminal && expectationSatisfied,
        )
        .map(({ eventId }) => eventId),
    );
    completeReceiptWritten = terminalEventIds.size === selectedEventCount;
  };

  const out = await executeFullMatrix(
    plan,
    validAuthorization(plan, "matrix-complete-receipt"),
    adapter,
    { nowMs: plan.createdAtMs + 1, clock },
  );
  const completeReceipt = receipts.at(-1);

  assert.equal(out.status, OUTCOME.COMPLETE);
  assert.equal(completeReceipt.evidence.at(-1).state, "VERIFIED");
  assert.equal(completeReceipt.finalStatus, OUTCOME.COMPLETE);
  assert.equal(completeReceipt.stopReason, null);
});

test("the partial receipt records completed steps and the stop reason", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const dir = mkdtempSync(join(tmpdir(), "efm-"));
  const receipts = [];
  const adapter = makeFakeAdapter({ receiptDir: dir, clock });
  adapter.writeReceipt = (name, value) => receipts.push({ name, value });
  // Stop at refund via chain-time timeout.
  adapter.getChainTime = async () => 1_800_000_000;
  const out = await executeFullMatrix(plan, validAuthorization(plan), adapter, { nowMs: plan.createdAtMs + 1, clock });
  assert.equal(out.status, OUTCOME.STOPPED_ON_EXPIRY_TIMEOUT);
  const last = receipts[receipts.length - 1].value;
  assert.equal(last.finalStatus, OUTCOME.STOPPED_ON_EXPIRY_TIMEOUT);
  assert.equal(last.stopReason, "REFUND_EXPIRY_WAIT_TIMEOUT");
  assert.ok(Array.isArray(last.steps) && last.steps.length > 0);
  assert.ok(last.mint, "mint public key bound into the receipt");
  assert.equal(last.mint.length >= 32, true);
});

test("a reused execution ID produces zero sends", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const dir = mkdtempSync(join(tmpdir(), "efm-"));
  // Real receipt writer so execution-ids.json persists.
  const { createProductionAdapter } = await import("../../scripts/devnet/business-flow-adapter.mjs");
  void createProductionAdapter;
  const adapter = makeFakeAdapter({ receiptDir: dir, clock });
  // First run reserves the id.
  const { reserveExecutionId } = await import("../../scripts/devnet/business-flow-execution.mjs");
  reserveExecutionId(dir, "dup-1");
  const before = adapter._sends.length;
  await assert.rejects(
    executeFullMatrix(plan, validAuthorization(plan, "dup-1"), adapter, { nowMs: plan.createdAtMs + 1, clock }),
    /already been reserved/,
  );
  assert.equal(adapter._sends.length, before, "no send may occur when the execution ID is reused");
});

test("a stale plan produces zero sends", async () => {
  const plan = await freshPlan(1_000_000);
  const clock = makeClock();
  const adapter = makeFakeAdapter({ receiptDir: mkdtempSync(join(tmpdir(), "efm-")), clock });
  await assert.rejects(
    executeFullMatrix(plan, validAuthorization(plan), adapter, { nowMs: 1_000_000 + 10_000_000, ttlMs: 300_000, clock }),
    /stale/,
  );
  assert.equal(adapter._sends.length, 0);
});

test("no secret material appears in the returned result or receipts", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const dir = mkdtempSync(join(tmpdir(), "efm-"));
  const receipts = [];
  const adapter = makeFakeAdapter({ receiptDir: dir, clock });
  adapter.writeReceipt = (name, value) => receipts.push({ name, value });
  const out = await executeFullMatrix(plan, validAuthorization(plan), adapter, { nowMs: plan.createdAtMs + 1, clock });
  const blob = JSON.stringify({ out, receipts });
  for (const forbidden of ["secretKey", "privateKey", "seed", "mnemonic", "passphrase"]) {
    assert.equal(blob.toLowerCase().includes(forbidden.toLowerCase()), false, `must not leak ${forbidden}`);
  }
});
