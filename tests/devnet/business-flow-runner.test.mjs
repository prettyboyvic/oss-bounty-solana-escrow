import assert from "node:assert/strict";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";

import {
  DEVNET_GENESIS_HASH,
  DEVNET_RPC_URL,
  CLASSIC_TOKEN_PROGRAM_ID,
} from "../../scripts/devnet/safety.mjs";
import {
  FLOW_NAMES,
  NEGATIVE_CHECKS,
  UPGRADEABLE_LOADER,
  assertNotDeploymentAuthority,
  authorizeExecution,
  buildManifest,
  buildPlan,
  computeTransactionCeiling,
  deriveSelectedFunding,
  deriveEscrowPda,
  deriveFlowInstances,
  deriveVaultPda,
  externalReference,
  instructionDiscriminator,
  manifestHash,
  planExpiry,
  waitReached,
} from "../../scripts/devnet/business-flow-runner.mjs";
import {
  BUSINESS_FLOW_EXECUTION_SPEC,
  selectExecutionEvents,
} from "../../scripts/devnet/business-flow-spec.mjs";

const PROGRAM_ID = "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z";
const UPGRADE_AUTHORITY = "Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk";
const SPONSOR = "CY5KKnfh1TdSCmm3PuwCrCL5aGLEaqm8ZHiK8Q6AqDHq";
const MAINTAINER = "7xBirdhUMsm7KEnfvx7mvUSrhVzZoJhoc4jnCurQo8S6";
const CONTRIBUTOR = "DG2kRnmBhZVAusBUfG7eGqUHNXo2rQJ3Z1PCLrUURceT";

// --- Deterministic ProgramData fixture (tag 3 + slot + option + authority). ---
function programDataAccount(authorityBase58) {
  const data = Buffer.alloc(45 + 8);
  data.writeUInt32LE(3, 0); // ProgramData tag
  data.writeBigUInt64LE(1n, 4); // slot
  data.writeUInt8(1, 12); // has authority
  new PublicKey(authorityBase58).toBuffer().copy(data, 13);
  return { owner: new PublicKey(UPGRADEABLE_LOADER), executable: false, data };
}

function programAccount(programDataAddress) {
  const data = Buffer.alloc(36);
  data.writeUInt32LE(2, 0); // Program tag
  new PublicKey(programDataAddress).toBuffer().copy(data, 4);
  return { owner: new PublicKey(UPGRADEABLE_LOADER), executable: true, data };
}

function makeReadOnlyRpc({
  balances = {},
  sponsorBalance = balances.sponsor ?? 5_000_000_000,
  calls,
} = {}) {
  const [pd] = PublicKey.findProgramAddressSync(
    [new PublicKey(PROGRAM_ID).toBuffer()],
    new PublicKey(UPGRADEABLE_LOADER),
  );
  const pdAddr = pd.toBase58();
  return {
    getGenesisHash: async () => {
      calls?.push("getGenesisHash");
      return DEVNET_GENESIS_HASH;
    },
    getAccountInfo: async (pk) => {
      calls?.push("getAccountInfo");
      const key = pk.toBase58();
      if (key === PROGRAM_ID) return programAccount(pdAddr);
      if (key === pdAddr) return programDataAccount(UPGRADE_AUTHORITY);
      return null;
    },
    getBalance: async (pk) => {
      calls?.push("getBalance");
      const byPublicKey = {
        [SPONSOR]: sponsorBalance,
        [MAINTAINER]: balances.maintainer ?? 1_000_000_000,
        [CONTRIBUTOR]: balances.contributor ?? 1_000_000_000,
      };
      return byPublicKey[pk.toBase58()] ?? 1_000_000_000;
    },
  };
}

const RENT = { mintRent: 1_461_600, tokenAccountRent: 2_039_280, escrowRent: 2_470_800 };
const RENT_BY_CLASS = {
  mint: RENT.mintRent,
  ata: RENT.tokenAccountRent,
  escrow: RENT.escrowRent,
  vault: RENT.tokenAccountRent,
};

function planRequest(overrides = {}) {
  return {
    rpcUrl: DEVNET_RPC_URL,
    expectedProgramId: PROGRAM_ID,
    identities: { sponsor: SPONSOR, maintainer: MAINTAINER, contributor: CONTRIBUTOR },
    flows: ["release", "refund", "cancel"],
    uniquenessToken: "unit-token",
    rentReads: RENT,
    ...overrides,
  };
}

test("PDAs derive correctly and match anchor findProgramAddress", () => {
  const refHash = externalReference("release", "abc").externalRefHash;
  const escrow = deriveEscrowPda(PROGRAM_ID, SPONSOR, refHash);
  const [expected] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), new PublicKey(SPONSOR).toBuffer(), Buffer.from(refHash)],
    new PublicKey(PROGRAM_ID),
  );
  assert.equal(escrow.toBase58(), expected.toBase58());
  const vault = deriveVaultPda(PROGRAM_ID, escrow);
  const [expectedVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), escrow.toBuffer()],
    new PublicKey(PROGRAM_ID),
  );
  assert.equal(vault.toBase58(), expectedVault.toBase58());
});

test("external references are unique per instance", () => {
  const instances = deriveFlowInstances(["release", "refund", "cancel"], "tok", {
    programId: PROGRAM_ID,
    sponsor: SPONSOR,
  });
  const labels = new Set(instances.map((i) => i.externalRefLabel));
  const escrows = new Set(instances.map((i) => i.escrow));
  assert.equal(labels.size, 3);
  assert.equal(escrows.size, 3);
});

test("external reference rejects empty uniqueness token and unknown flow", () => {
  assert.throws(() => externalReference("release", ""), /uniqueness token/);
  assert.throws(() => externalReference("nope", "x"), /unknown flow/);
});

test("plan mode performs no send and only read calls", async () => {
  const calls = [];
  const plan = await buildPlan(planRequest(), makeReadOnlyRpc({ calls }));
  assert.equal(plan.mode, "PLAN");
  assert.equal(plan.stateMutation, false);
  assert.equal(plan.liveWriteExecuted, false);
  // Only read methods were ever called.
  for (const c of calls) {
    assert.ok(["getGenesisHash", "getAccountInfo", "getBalance"].includes(c), `unexpected call ${c}`);
  }
  assert.equal(plan.tokenProgram, CLASSIC_TOKEN_PROGRAM_ID);
  assert.equal(plan.upgradeAuthority, UPGRADE_AUTHORITY);
  assert.equal(plan.transactionCeiling, 12);
  assert.deepEqual(plan.selectedEvents, plan.manifest.selectedEvents);
  assert.deepEqual(plan.selectedEvents.eventIds, plan.funding.selectedEventIds);
  assert.equal(plan.selectedEvents.sendCount, plan.funding.sendCount);
  assert.equal(
    plan.funding.byIdentity.sponsor.safetyMarginLamports,
    20_000_000,
  );
  for (const identity of ["maintainer", "contributor", "mintAuthority"]) {
    assert.equal(
      plan.funding.byIdentity[identity].safetyMarginLamports,
      0,
    );
  }
  assert.deepEqual(plan.manifest.funding, {
    selectedEventIds: [...plan.funding.selectedEventIds],
    sendCount: plan.funding.sendCount,
    simulationCount: plan.funding.simulationCount,
    waitCount: plan.funding.waitCount,
    createdAccountsByClass: {
      mint: plan.funding.createdAccountsByClass.mint,
      ata: plan.funding.createdAccountsByClass.ata,
      escrow: plan.funding.createdAccountsByClass.escrow,
      vault: plan.funding.createdAccountsByClass.vault,
    },
    recoverableRentLamports: plan.funding.recoverableRentLamports,
    transactionFeeLamports: plan.funding.transactionFeeLamports,
    requiredBalanceLamports: plan.funding.requiredBalanceLamports,
    byIdentity: Object.fromEntries(
      ["sponsor", "maintainer", "contributor", "mintAuthority"].map(
        (identity) => [
          identity,
          {
            feeCount: plan.funding.byIdentity[identity].feeCount,
            signatureCount: plan.funding.byIdentity[identity].signatureCount,
            feeLamports: plan.funding.byIdentity[identity].feeLamports,
            rentLamports: plan.funding.byIdentity[identity].rentLamports,
            retryReserveLamports:
              plan.funding.byIdentity[identity].retryReserveLamports,
            safetyMarginLamports:
              plan.funding.byIdentity[identity].safetyMarginLamports,
            requiredLamports:
              plan.funding.byIdentity[identity].requiredLamports,
          },
        ],
      ),
    ),
  });
});

test("plan rejects an rpc adapter exposing a send/sign method", async () => {
  const rpc = makeReadOnlyRpc();
  rpc.sendRawTransaction = async () => "sig";
  await assert.rejects(buildPlan(planRequest(), rpc), /must not expose sendRawTransaction/);
});

test("plan rejects a non-devnet rpc url", async () => {
  await assert.rejects(
    buildPlan(planRequest({ rpcUrl: "https://api.mainnet-beta.solana.com" }), makeReadOnlyRpc()),
    /exact devnet RPC URL/,
  );
});

test("plan rejects any business identity equal to the upgrade authority", async () => {
  const rpc = makeReadOnlyRpc();
  await assert.rejects(
    buildPlan(planRequest({ identities: { sponsor: UPGRADE_AUTHORITY, maintainer: MAINTAINER, contributor: CONTRIBUTOR } }), rpc),
    /must not be the deployment\/upgrade authority/,
  );
});

test("plan rejects every equal sponsor, maintainer, or contributor pair", async () => {
  const duplicatePairs = [
    { sponsor: SPONSOR, maintainer: SPONSOR, contributor: CONTRIBUTOR },
    { sponsor: SPONSOR, maintainer: MAINTAINER, contributor: SPONSOR },
    { sponsor: SPONSOR, maintainer: MAINTAINER, contributor: MAINTAINER },
  ];
  for (const identities of duplicatePairs) {
    await assert.rejects(
      buildPlan(planRequest({ identities }), makeReadOnlyRpc()),
      /sponsor, maintainer, and contributor must be mutually distinct/,
    );
  }
});

test("plan flags insufficient payer funding without accepting an equal aggregate", async () => {
  const plan = await buildPlan(
    planRequest(),
    makeReadOnlyRpc({
      balances: {
        sponsor: 5_000_000_000,
        maintainer: 0,
        contributor: 1_000_000_000,
      },
    }),
  );
  assert.equal(plan.fundingSufficient, false);
  assert.equal(plan.fundingSufficientByIdentity.sponsor, true);
  assert.equal(plan.fundingSufficientByIdentity.maintainer, false);
  assert.match(plan.notes.join(" "), /BLOCKED_FUNDING.*maintainer/);
});

test("transaction ceiling is the selected canonical SEND count", () => {
  assert.equal(computeTransactionCeiling(["release"]), 7);
  assert.equal(computeTransactionCeiling(["release", "refund", "cancel"]), 12);
  assert.throws(() => computeTransactionCeiling(["bogus"]), /requested execution flows/);
});

test("negative checks are simulate-only", () => {
  assert.equal(NEGATIVE_CHECKS.length, 3);
  for (const n of NEGATIVE_CHECKS) assert.equal(n.mode, "simulate");
  assert.deepEqual(NEGATIVE_CHECKS, [
    {
      id: "unauthorized_release",
      mode: "simulate",
      expectedErrors: [
        "InvalidContributorTokenOwner",
        "ConstraintHasOne",
      ],
    },
    {
      id: "refund_before_expiry",
      mode: "simulate",
      expectedErrors: ["EscrowNotExpired"],
    },
    {
      id: "release_at_or_after_expiry",
      mode: "simulate",
      expectedErrors: ["EscrowExpired"],
    },
  ]);
  assert.equal(
    NEGATIVE_CHECKS.some((check) => check.expectedErrors.includes(null)),
    false,
  );
});

test("expiry policy is bounded and rejects fragile leads", () => {
  const e = planExpiry({ chainTimeSeconds: 1_000_000 });
  assert.ok(e.releaseExpiry > e.chainTimeSeconds + 3600);
  assert.ok(e.refundExpiry > e.chainTimeSeconds);
  assert.ok(e.wait.timeoutMs > e.wait.pollIntervalMs);
  assert.equal(e.wait.stopIfNotReached, true);
  assert.throws(() => planExpiry({ chainTimeSeconds: 1000, refundExpiryLeadSeconds: 2 }), /fragile/);
  assert.throws(() => planExpiry({ chainTimeSeconds: 0 }), /chain time/);
});

test("wait bound stops on timeout rather than resending", () => {
  assert.deepEqual(waitReached({ chainTimeSeconds: 5, targetSeconds: 10, elapsedMs: 0, timeoutMs: 1000 }), { done: false, reason: "WAITING" });
  assert.deepEqual(waitReached({ chainTimeSeconds: 10, targetSeconds: 10, elapsedMs: 0, timeoutMs: 1000 }), { done: true, reason: "REACHED" });
  assert.deepEqual(waitReached({ chainTimeSeconds: 5, targetSeconds: 10, elapsedMs: 2000, timeoutMs: 1000 }), { done: true, reason: "TIMEOUT_STOP" });
});

test("full canonical funding derives account counts, sends, and payer identities", () => {
  const selectedPlan = selectExecutionEvents(
    BUSINESS_FLOW_EXECUTION_SPEC,
    ["release", "refund", "cancel"],
  );
  const funding = deriveSelectedFunding({
    selectedPlan,
    rentByClass: RENT_BY_CLASS,
    feePerSignature: 5_000,
    safetyMarginByIdentity: { sponsor: 20_000_000 },
  });
  assert.deepEqual(funding.createdAccountsByClass, {
    mint: 1,
    ata: 2,
    escrow: 3,
    vault: 3,
  });
  assert.equal(funding.sendCount, 12);
  assert.equal(funding.simulationCount, 3);
  assert.equal(funding.waitCount, 1);
  assert.equal(funding.byIdentity.sponsor.feeCount, 11);
  assert.equal(funding.byIdentity.maintainer.feeCount, 1);
  assert.deepEqual(
    Object.keys(funding.byIdentity),
    ["sponsor", "maintainer", "contributor", "mintAuthority"],
  );
  assert.equal(
    funding.recoverableRentLamports,
    RENT.mintRent + RENT.tokenAccountRent * 5 + RENT.escrowRent * 3,
  );
});

test("release-only canonical funding assigns seven sends to exact payers", () => {
  const funding = deriveSelectedFunding({
    selectedPlan: selectExecutionEvents(
      BUSINESS_FLOW_EXECUTION_SPEC,
      ["release"],
    ),
    rentByClass: RENT_BY_CLASS,
    feePerSignature: 5_000,
  });
  assert.deepEqual(funding.createdAccountsByClass, {
    mint: 1,
    ata: 2,
    escrow: 1,
    vault: 1,
  });
  assert.equal(funding.sendCount, 7);
  assert.equal(funding.simulationCount, 1);
  assert.equal(funding.waitCount, 0);
  assert.equal(funding.byIdentity.sponsor.feeCount, 6);
  assert.equal(funding.byIdentity.maintainer.feeCount, 1);
});

test("refund-only canonical funding tracks sends, simulations, and wait separately", () => {
  const funding = deriveSelectedFunding({
    selectedPlan: selectExecutionEvents(
      BUSINESS_FLOW_EXECUTION_SPEC,
      ["refund"],
    ),
    rentByClass: RENT_BY_CLASS,
    feePerSignature: 5_000,
  });
  assert.deepEqual(funding.createdAccountsByClass, {
    mint: 1,
    ata: 2,
    escrow: 1,
    vault: 1,
  });
  assert.equal(funding.sendCount, 7);
  assert.equal(funding.simulationCount, 2);
  assert.equal(funding.waitCount, 1);
  assert.equal(funding.byIdentity.sponsor.feeCount, 7);
  assert.equal(funding.byIdentity.maintainer.feeCount, 0);
});

test("retry reserve and safety margin are assigned to only the named payer", () => {
  const funding = deriveSelectedFunding({
    selectedPlan: selectExecutionEvents(
      BUSINESS_FLOW_EXECUTION_SPEC,
      ["release"],
    ),
    rentByClass: RENT_BY_CLASS,
    feePerSignature: 5_000,
    retryReserveByIdentity: { contributor: 12_345 },
    safetyMarginByIdentity: { maintainer: 54_321 },
  });
  assert.equal(funding.sendCount, 7);
  assert.equal(funding.byIdentity.contributor.retryReserveLamports, 12_345);
  assert.equal(funding.byIdentity.maintainer.safetyMarginLamports, 54_321);
  assert.equal(funding.byIdentity.sponsor.retryReserveLamports, 0);
  assert.equal(funding.byIdentity.sponsor.safetyMarginLamports, 0);
});

test("canonical funding rejects invalid numeric inputs and missing payer or class data", () => {
  const selectedPlan = selectExecutionEvents(
    BUSINESS_FLOW_EXECUTION_SPEC,
    ["release"],
  );
  const base = {
    selectedPlan,
    rentByClass: RENT_BY_CLASS,
    feePerSignature: 5_000,
  };
  for (const feePerSignature of [-1, 1.5, undefined]) {
    assert.throws(
      () => deriveSelectedFunding({ ...base, feePerSignature }),
      /feePerSignature.*nonnegative integer/,
    );
  }
  for (const rentByClass of [
    { ...RENT_BY_CLASS, vault: -1 },
    { ...RENT_BY_CLASS, escrow: 1.5 },
    { mint: RENT.mintRent, ata: RENT.tokenAccountRent, escrow: RENT.escrowRent },
  ]) {
    assert.throws(
      () => deriveSelectedFunding({ ...base, rentByClass }),
      /(rentByClass|vault|escrow).*nonnegative integer/,
    );
  }
  for (const field of ["retryReserveByIdentity", "safetyMarginByIdentity"]) {
    for (const value of [-1, 1.5, undefined]) {
      assert.throws(
        () =>
          deriveSelectedFunding({
            ...base,
            [field]: { sponsor: value },
          }),
        new RegExp(`${field}\\.sponsor.*nonnegative integer`),
      );
    }
    assert.throws(
      () =>
        deriveSelectedFunding({
          ...base,
          [field]: { stranger: 1 },
        }),
      /unknown funding identity "stranger"/,
    );
  }

  const badPayerEvent = {
    ...selectedPlan.sendEvents[0],
    feePayerRole: "stranger",
    rentPayerRole: "stranger",
  };
  assert.throws(
    () =>
      deriveSelectedFunding({
        ...base,
        selectedPlan: {
          ...selectedPlan,
          sendEvents: [badPayerEvent],
        },
      }),
    /unknown fee payer "stranger"/,
  );
  const badClassEvent = {
    ...selectedPlan.sendEvents[0],
    creates: ["mystery"],
  };
  assert.throws(
    () =>
      deriveSelectedFunding({
        ...base,
        selectedPlan: {
          ...selectedPlan,
          sendEvents: [badClassEvent],
        },
      }),
    /unknown created account class "mystery"/,
  );
});

test("deployment-authority guard rejects the authority as a role", () => {
  assert.throws(() => assertNotDeploymentAuthority(UPGRADE_AUTHORITY, UPGRADE_AUTHORITY, "sponsor"), /must not be the deployment/);
  assert.doesNotThrow(() => assertNotDeploymentAuthority(SPONSOR, UPGRADE_AUTHORITY, "sponsor"));
});

// --- Execute authorization contract ---

async function freshPlan() {
  return buildPlan(planRequest(), makeReadOnlyRpc());
}

function validAuthorization(plan) {
  return {
    manifestHash: plan.manifestHash,
    expectedGenesisHash: DEVNET_GENESIS_HASH,
    expectedProgramId: PROGRAM_ID,
    executionId: "exec-1",
    transactionCeiling: plan.transactionCeiling,
    enabledFlows: ["release", "refund", "cancel"],
    identityAssertions: { sponsor: SPONSOR, maintainer: MAINTAINER, contributor: CONTRIBUTOR },
    acknowledgeDevnet: "R4_DEVNET_BUSINESS_FLOW",
  };
}

test("execute refuses absent authorization fields", async () => {
  const plan = await freshPlan();
  for (const key of ["manifestHash", "executionId", "transactionCeiling", "enabledFlows", "acknowledgeDevnet"]) {
    const auth = validAuthorization(plan);
    delete auth[key];
    assert.throws(() => authorizeExecution(plan, auth), new RegExp(key));
  }
});

test("execute refuses stale manifest hash", async () => {
  const plan = await freshPlan();
  const auth = validAuthorization(plan);
  auth.manifestHash = "deadbeef";
  assert.throws(() => authorizeExecution(plan, auth), /manifest hash/);
});

test("authorization rejects mutable funding or manifest content under an unchanged hash", async () => {
  const original = await freshPlan();
  const authorization = validAuthorization(original);
  const cases = [
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

  for (const fixture of cases) {
    const tampered = structuredClone(original);
    fixture.mutate(tampered);
    assert.throws(
      () => authorizeExecution(tampered, authorization),
      /(funding projection|manifest hash)/,
      fixture.label,
    );
  }
});

test("execute refuses wrong genesis and wrong program id", async () => {
  const plan = await freshPlan();
  const a1 = validAuthorization(plan);
  a1.expectedGenesisHash = "11111111111111111111111111111111";
  assert.throws(() => authorizeExecution(plan, a1), /genesis/);
  const a2 = validAuthorization(plan);
  a2.expectedProgramId = SPONSOR;
  assert.throws(() => authorizeExecution(plan, a2), /program ID mismatch/);
});

test("execute refuses wrong ceiling and wrong acknowledgement", async () => {
  const plan = await freshPlan();
  const a1 = validAuthorization(plan);
  a1.transactionCeiling = 999;
  assert.throws(() => authorizeExecution(plan, a1), /ceiling/);
  const a2 = validAuthorization(plan);
  a2.acknowledgeDevnet = "nope";
  assert.throws(() => authorizeExecution(plan, a2), /acknowledgement/);
});

test("execute rejects an identity assertion equal to upgrade authority", async () => {
  const plan = await freshPlan();
  const auth = validAuthorization(plan);
  auth.identityAssertions = { sponsor: UPGRADE_AUTHORITY, maintainer: MAINTAINER, contributor: CONTRIBUTOR };
  assert.throws(() => authorizeExecution(plan, auth), /(mismatch|deployment)/);
});

test("valid authorization is accepted", async () => {
  const plan = await freshPlan();
  const grant = authorizeExecution(plan, validAuthorization(plan));
  assert.equal(grant.authorized, true);
  assert.deepEqual([...grant.enabledFlows].sort(), ["cancel", "refund", "release"]);
});

test("manifest hash is stable and secrets never appear in plan output", async () => {
  const plan = await freshPlan();
  const m = buildManifest({
    cluster: "devnet",
    genesisHash: DEVNET_GENESIS_HASH,
    programId: PROGRAM_ID,
    programDataAddress: plan.manifest.programDataAddress,
    upgradeAuthority: UPGRADE_AUTHORITY,
    flows: ["release", "refund", "cancel"],
    uniquenessToken: "unit-token",
    instances: plan.manifest.instances,
    selectedEvents: plan.selectedEvents,
    funding: plan.funding,
    transactionCeiling: 12,
    negativeChecks: plan.negativeChecks,
    amount: 1_000_000,
    decimals: 6,
  });
  assert.equal(manifestHash(m), plan.manifestHash);
  const serialized = JSON.stringify(plan);
  for (const secret of ["secretKey", "keypair", "privateKey", "seed"]) {
    assert.ok(!serialized.toLowerCase().includes(secret.toLowerCase()), `plan leaked ${secret}`);
  }
});

test("instruction discriminators match the anchor global namespace", () => {
  // sha256("global:initialize_escrow")[0..8]
  assert.equal(instructionDiscriminator("initialize_escrow").length, 8);
  assert.deepEqual(instructionDiscriminator("fund_escrow"), instructionDiscriminator("fund_escrow"));
  assert.notDeepEqual(instructionDiscriminator("release"), instructionDiscriminator("refund"));
});

test("flow names are exactly release, refund, cancel", () => {
  assert.deepEqual([...FLOW_NAMES].sort(), ["cancel", "refund", "release"]);
});
