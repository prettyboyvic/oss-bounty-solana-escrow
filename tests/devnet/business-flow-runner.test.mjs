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
  computeFundingPlan,
  computeTransactionCeiling,
  deriveEscrowPda,
  deriveFlowInstances,
  deriveVaultPda,
  executeBusinessFlows,
  externalReference,
  instructionDiscriminator,
  manifestHash,
  planExpiry,
  waitReached,
} from "../../scripts/devnet/business-flow-runner.mjs";

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

function makeReadOnlyRpc({ sponsorBalance = 5_000_000_000, calls } = {}) {
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
      return pk.toBase58() === SPONSOR ? sponsorBalance : 1_000_000_000;
    },
  };
}

const RENT = { mintRent: 1_461_600, tokenAccountRent: 2_039_280, escrowRent: 2_470_800 };

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

test("plan flags insufficient sponsor funding without airdrop", async () => {
  const plan = await buildPlan(planRequest(), makeReadOnlyRpc({ sponsorBalance: 1000 }));
  assert.equal(plan.fundingSufficient, false);
  assert.match(plan.notes.join(" "), /BLOCKED_FUNDING/);
});

test("transaction ceiling is the sum of per-flow live writes", () => {
  assert.equal(computeTransactionCeiling(["release"]), 3);
  assert.equal(computeTransactionCeiling(["release", "refund", "cancel"]), 8);
  assert.throws(() => computeTransactionCeiling(["bogus"]), /unknown flow/);
});

test("negative checks are simulate-only", () => {
  assert.ok(NEGATIVE_CHECKS.length >= 3);
  for (const n of NEGATIVE_CHECKS) assert.equal(n.mode, "simulate");
  const ids = NEGATIVE_CHECKS.map((n) => n.id);
  assert.ok(ids.includes("unauthorized_release"));
  assert.ok(ids.includes("refund_before_expiry"));
  assert.ok(ids.includes("release_at_or_after_expiry"));
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

test("funding model separates recoverable rent from permanent fees", () => {
  const f = computeFundingPlan({
    mintRent: RENT.mintRent,
    tokenAccountRent: RENT.tokenAccountRent,
    escrowRent: RENT.escrowRent,
    feePerTransaction: 5000,
    setupWrites: 7,
    flowLiveWrites: 3,
    tokenAccountCount: 3,
    safetyReserveLamports: 20_000_000,
  });
  assert.equal(f.recoverableRent, RENT.mintRent + RENT.escrowRent + RENT.tokenAccountRent * 3);
  assert.equal(f.permanentFees, 10 * 5000);
  assert.equal(f.requiredLamports, f.recoverableRent + f.permanentFees + 20_000_000);
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

test("executeBusinessFlows requires injected deps and never blind-retries on failure", async () => {
  const plan = await freshPlan();
  const auth = validAuthorization(plan);
  await assert.rejects(executeBusinessFlows(plan, auth, {}), /injected signAndSend/);

  let calls = 0;
  const failingDeps = {
    signAndSend: async () => {
      calls += 1;
      throw new Error("simulated send failure");
    },
    readAccount: async () => ({}),
  };
  const result = await executeBusinessFlows(plan, { ...auth, enabledFlows: ["cancel"] }, failingDeps);
  assert.equal(result.status, "STOPPED");
  assert.equal(result.reason, "STEP_FAILED");
  assert.equal(result.sent, 0);
  assert.equal(calls, 1, "must not blind-retry");
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].status, "FAILED");
});

test("executeBusinessFlows stops on unexpected on-chain state and preserves evidence", async () => {
  const plan = await freshPlan();
  const auth = { ...validAuthorization(plan), enabledFlows: ["cancel"] };
  const deps = {
    signAndSend: async (step) => ({ signature: `sig-${step.instruction}` }),
    readAccount: async (step) =>
      step.instruction === "cancel"
        ? { expectedStatus: "Cancelled", observedStatus: "Initialized" }
        : {},
  };
  const result = await executeBusinessFlows(plan, auth, deps);
  assert.equal(result.status, "STOPPED");
  assert.equal(result.reason, "UNEXPECTED_STATE");
  assert.ok(result.evidence.some((e) => e.status === "UNEXPECTED_STATE"));
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
    transactionCeiling: 8,
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
