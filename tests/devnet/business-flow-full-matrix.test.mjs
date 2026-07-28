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

import { PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { DEVNET_GENESIS_HASH, DEVNET_RPC_URL } from "../../scripts/devnet/safety.mjs";
import { buildPlan } from "../../scripts/devnet/business-flow-runner.mjs";
import { discriminator, ESCROW_STATUS } from "../../scripts/devnet/business-flow-instructions.mjs";
import { OUTCOME, executeFullMatrix } from "../../scripts/devnet/business-flow-execution.mjs";

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
  const mint = Keypair.generate().publicKey.toBase58();
  const pd = programDataAddress();
  const escrows = new Map();
  const tokens = new Map();
  const sends = [];
  let sig = 0;

  const applyEscrowIx = (ix) => {
    const d = discOf(ix);
    const keys = ix.keys.map((k) => k.pubkey.toBase58());
    if (d === DISC.initialize_escrow) {
      escrows.set(keys[2], { status: STATUS_INDEX.Initialized, vault: keys[3], amount: AMOUNT });
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
      mint,
      feePayer: SPONSOR,
      ...signerOverrides,
    },
    _sends: sends,
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
      if (tokens.has(address)) return { data: encodeToken(tokens.get(address)) };
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
    async simulate({ instructions, signerRoles }) {
      const d = discOf(instructions[0]);
      if (d === DISC.refund) {
        return { err: { InstructionError: [0, { Custom: 6008 }] }, logs: ["Error Code: EscrowNotExpired"], unitsConsumed: 10 };
      }
      if (d === DISC.release) {
        if (signerRoles.includes("contributor")) {
          return { err: { InstructionError: [0, { Custom: 6005 }] }, logs: ["Error Code: InvalidContributorTokenOwner"], unitsConsumed: 10 };
        }
        return { err: { InstructionError: [0, { Custom: 6007 }] }, logs: ["Error Code: EscrowExpired"], unitsConsumed: 10 };
      }
      return { err: { InstructionError: [0, { Custom: 6000 }] }, logs: [], unitsConsumed: 1 };
    },
    async send({ instructions, feePayerRole, signerRoles }) {
      sends.push({ disc: instructions[0] ? discOf(instructions[0]) : null, feePayerRole, signerRoles });
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
  assert.equal(out.ceiling.totalWrites, 12);

  // Exactly 12 live sends, in the exact expected order.
  assert.equal(adapter._sends.length, 12);
  const order = out.steps.filter((s) => s.kind === "send").map((s) => s.id);
  assert.deepEqual(order, [
    "setup:create_mint",
    "setup:sponsor_ata",
    "setup:contributor_ata",
    "setup:mint_tokens",
    "release:initialize",
    "release:fund",
    "release:release",
    "refund:initialize",
    "refund:fund",
    "refund:refund",
    "cancel:initialize",
    "cancel:cancel",
  ]);

  // Exactly 3 simulations, all EXPECTED_ERROR, never sent.
  assert.equal(out.simulations.length, 3);
  assert.deepEqual(out.simulations.map((s) => s.id), [
    "unauthorized_release",
    "refund_before_expiry",
    "release_at_or_after_expiry",
  ]);
  for (const s of out.simulations) assert.equal(s.status, "EXPECTED_ERROR");

  // All 12 sends confirmed success.
  for (const s of out.steps.filter((x) => x.kind === "send")) {
    assert.equal(s.outcome, OUTCOME.CONFIRMED_SUCCESS, `${s.id} should confirm`);
  }
});

test("signer set and fee payer match the required matrix for each transaction", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const adapter = makeFakeAdapter({ receiptDir: mkdtempSync(join(tmpdir(), "efm-")), clock });
  await executeFullMatrix(plan, validAuthorization(plan), adapter, { nowMs: plan.createdAtMs + 1, clock });

  const byId = Object.fromEntries(
    // reconstruct id<->send by order (sends array is in the same order as send steps)
    ["setup:create_mint", "setup:sponsor_ata", "setup:contributor_ata", "setup:mint_tokens",
      "release:initialize", "release:fund", "release:release",
      "refund:initialize", "refund:fund", "refund:refund",
      "cancel:initialize", "cancel:cancel"].map((id, i) => [id, adapter._sends[i]]),
  );

  assert.deepEqual({ fp: byId["setup:create_mint"].feePayerRole, sr: byId["setup:create_mint"].signerRoles }, { fp: "sponsor", sr: ["mint"] });
  assert.deepEqual({ fp: byId["setup:mint_tokens"].feePayerRole, sr: byId["setup:mint_tokens"].signerRoles }, { fp: "sponsor", sr: ["mintAuthority"] });
  assert.deepEqual({ fp: byId["release:initialize"].feePayerRole, sr: byId["release:initialize"].signerRoles }, { fp: "sponsor", sr: ["sponsor"] });
  // Release is signed and paid by the maintainer.
  assert.deepEqual({ fp: byId["release:release"].feePayerRole, sr: byId["release:release"].signerRoles }, { fp: "maintainer", sr: ["maintainer"] });
  assert.deepEqual({ fp: byId["refund:refund"].feePayerRole, sr: byId["refund:refund"].signerRoles }, { fp: "sponsor", sr: ["sponsor"] });
  assert.deepEqual({ fp: byId["cancel:cancel"].feePayerRole, sr: byId["cancel:cancel"].signerRoles }, { fp: "sponsor", sr: ["sponsor"] });
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

test("the ceiling cannot be exceeded even by extra guarded sends", async () => {
  const plan = await freshPlan();
  const clock = makeClock();
  const adapter = makeFakeAdapter({ receiptDir: mkdtempSync(join(tmpdir(), "efm-")), clock });
  // Run the full matrix (12 sends) then attempt a 13th via the wired sendStep.
  const { runAcceptanceMatrix } = await import("../../scripts/devnet/business-flow-execution.mjs");
  const wired = await runAcceptanceMatrix(plan, validAuthorization(plan, "ceil-1"), adapter, { nowMs: plan.createdAtMs + 1, clock });
  // drive 12 no-op sends
  for (let i = 0; i < 12; i += 1) {
    await wired.sendStep(`s${i}`, [], "sponsor", ["sponsor"], null);
  }
  await assert.rejects(wired.sendStep("s12", [], "sponsor", ["sponsor"], null), /ceiling reached/);
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
