import assert from "node:assert/strict";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";

import { DEVNET_GENESIS_HASH, DEVNET_RPC_URL } from "../../scripts/devnet/safety.mjs";
import { buildPlan } from "../../scripts/devnet/business-flow-runner.mjs";
import {
  SETUP_TRANSACTION_COUNT,
  assertPlanFresh,
  assertSignersExcludeAuthority,
  computeFullCeiling,
  recheckOnChainBeforeExecution,
  reserveExecutionId,
  verifyEscrowStatus,
  verifyTokenDelta,
  waitForExpiry,
} from "../../scripts/devnet/business-flow-execution.mjs";

const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const PROGRAM_ID = "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z";
const UPGRADE_AUTHORITY = "Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk";
const SPONSOR = "CY5KKnfh1TdSCmm3PuwCrCL5aGLEaqm8ZHiK8Q6AqDHq";
const MAINTAINER = "7xBirdhUMsm7KEnfvx7mvUSrhVzZoJhoc4jnCurQo8S6";
const CONTRIBUTOR = "DG2kRnmBhZVAusBUfG7eGqUHNXo2rQJ3Z1PCLrUURceT";
const RENT = { mintRent: 1_461_600, tokenAccountRent: 2_039_280, escrowRent: 2_470_800 };

function pdAddr() {
  return PublicKey.findProgramAddressSync(
    [new PublicKey(PROGRAM_ID).toBuffer()],
    new PublicKey(UPGRADEABLE_LOADER),
  )[0].toBase58();
}

function makeReadOnlyRpc({ sponsorBalance = 5_000_000_000 } = {}) {
  const pd = pdAddr();
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
    getBalance: async (pk) => (pk.toBase58() === SPONSOR ? sponsorBalance : 1_000_000_000),
  };
}

async function freshPlan(nowMs = Date.now()) {
  return buildPlan(
    {
      rpcUrl: DEVNET_RPC_URL,
      expectedProgramId: PROGRAM_ID,
      identities: { sponsor: SPONSOR, maintainer: MAINTAINER, contributor: CONTRIBUTOR },
      flows: ["release", "refund", "cancel"],
      uniquenessToken: "exec-test",
      rentReads: RENT,
      nowMs,
    },
    makeReadOnlyRpc(),
  );
}

test("full ceiling includes setup and flow writes", () => {
  const c = computeFullCeiling(["release", "refund", "cancel"]);
  assert.equal(c.setupWrites, SETUP_TRANSACTION_COUNT);
  assert.equal(c.flowWrites, 8);
  assert.equal(c.totalWrites, 12);
  assert.equal(c.simulations, 3);
});

test("reserveExecutionId persists and refuses reuse", () => {
  const store = { data: undefined };
  const io = {
    existsSyncFn: () => store.data !== undefined,
    readFn: () => store.data,
    writeFn: (_p, v) => { store.data = v; },
    mkdirFn: () => {},
  };
  assert.equal(reserveExecutionId("/tmp/x", "id-1", io).count, 1);
  assert.equal(reserveExecutionId("/tmp/x", "id-2", io).count, 2);
  assert.throws(() => reserveExecutionId("/tmp/x", "id-1", io), /already been reserved/);
});

test("assertPlanFresh rejects stale and future plans", async () => {
  const plan = await freshPlan(1_000_000);
  assert.deepEqual(assertPlanFresh(plan, { nowMs: 1_100_000, ttlMs: 300_000 }), { ageMs: 100_000 });
  assert.throws(() => assertPlanFresh(plan, { nowMs: 2_000_000, ttlMs: 300_000 }), /stale/);
  assert.throws(() => assertPlanFresh(plan, { nowMs: 500_000, ttlMs: 300_000 }), /future/);
});

function fakeExecAdapter(overrides = {}) {
  const pd = pdAddr();
  return {
    receiptDir: overrides.receiptDir ?? "/tmp/none",
    signerPublicKeys: overrides.signerPublicKeys ?? { sponsor: SPONSOR, maintainer: MAINTAINER, contributor: CONTRIBUTOR, mintAuthority: "7auk8apjydhbbDkwyjD3EJQopmckUMyaa1JTNp8e6fz7" },
    readAccount: overrides.readAccount ?? (async (addr) => {
      if (addr === PROGRAM_ID) {
        const data = Buffer.alloc(36); data.writeUInt32LE(2, 0); new PublicKey(pd).toBuffer().copy(data, 4);
        return { owner: new PublicKey(UPGRADEABLE_LOADER), executable: true, data };
      }
      return null; // escrows absent → no collision
    }),
    readBalance: overrides.readBalance ?? (async () => 5_000_000_000),
    writeReceipt: overrides.writeReceipt ?? (() => {}),
    getChainTime: overrides.getChainTime,
    simulate: overrides.simulate,
    send: overrides.send,
    confirm: overrides.confirm,
    signatureStatus: overrides.signatureStatus,
  };
}

test("assertSignersExcludeAuthority rejects any role equal to upgrade authority", () => {
  assert.doesNotThrow(() => assertSignersExcludeAuthority(fakeExecAdapter(), UPGRADE_AUTHORITY));
  assert.throws(
    () => assertSignersExcludeAuthority(fakeExecAdapter({ signerPublicKeys: { mintAuthority: UPGRADE_AUTHORITY } }), UPGRADE_AUTHORITY),
    /must not be the deployment/,
  );
});

test("recheck rejects escrow collision and each payer's insufficient balance", async () => {
  const plan = await freshPlan();
  await assert.doesNotReject(recheckOnChainBeforeExecution(plan, {}, fakeExecAdapter()));
  const collide = fakeExecAdapter({
    readAccount: async (addr) => {
      if (addr === PROGRAM_ID) {
        const data = Buffer.alloc(36); data.writeUInt32LE(2, 0); new PublicKey(pdAddr()).toBuffer().copy(data, 4);
        return { owner: new PublicKey(UPGRADEABLE_LOADER), executable: true, data };
      }
      return { data: Buffer.alloc(1) }; // escrow already exists
    },
  });
  await assert.rejects(recheckOnChainBeforeExecution(plan, {}, collide), /collision/);
  const poor = fakeExecAdapter({ readBalance: async () => 1000 });
  await assert.rejects(recheckOnChainBeforeExecution(plan, {}, poor), /insufficient/);
  const wrongPayerAllocation = fakeExecAdapter({
    readBalance: async (identity) =>
      identity === MAINTAINER ? 0 : 5_000_000_000,
  });
  await assert.rejects(
    recheckOnChainBeforeExecution(plan, {}, wrongPayerAllocation),
    /maintainer funding insufficient/,
  );
});

test("refund wait reaches target and stops on timeout without resend", async () => {
  let t = 1000;
  const clock = { now: () => t, sleep: async (ms) => { t += ms; } };
  const reaching = fakeExecAdapter({ getChainTime: async () => 500 + (t - 1000) / 10 });
  // chain time grows; will reach target 560 eventually
  const r = await waitForExpiry({ targetSeconds: 560, pollIntervalMs: 100, timeoutMs: 100_000 }, reaching, clock);
  assert.equal(r.reason, "REACHED");

  t = 0;
  const clock2 = { now: () => t, sleep: async (ms) => { t += ms; } };
  const stuck = fakeExecAdapter({ getChainTime: async () => 100 }); // never reaches target
  const r2 = await waitForExpiry({ targetSeconds: 999999, pollIntervalMs: 100, timeoutMs: 500 }, stuck, clock2);
  assert.equal(r2.reason, "TIMEOUT_STOP");
});

test("verify helpers detect status and token delta", () => {
  const buf = Buffer.alloc(8 + 32 * 5 + 32 + 8 + 8 + 8 + 3);
  buf.writeUInt8(2, 8 + 32 * 5 + 32 + 8 + 8 + 8); // status Released
  assert.equal(verifyEscrowStatus(buf, "Released").ok, true);
  assert.equal(verifyEscrowStatus(buf, "Funded").ok, false);
  assert.equal(verifyTokenDelta("100", "1100", 1000).ok, true);
  assert.equal(verifyTokenDelta("100", "200", 1000).ok, false);
});
