import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Keypair, PublicKey } from "@solana/web3.js";

import {
  createProductionAdapter,
  loadSigners,
} from "../../scripts/devnet/business-flow-adapter.mjs";

const ZERO_BLOCKHASH = PublicKey.default.toBase58();

// Signer keypairs must live under <repoRoot>/.devnet per assertSignerPathContained.
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "bfa-"));
  mkdirSync(join(dir, ".devnet"), { recursive: true });
  return dir;
}

function writeKeypair(dir, name) {
  const kp = Keypair.generate();
  const path = join(dir, ".devnet", name);
  writeFileSync(path, JSON.stringify([...kp.secretKey]));
  return { kp, path };
}

function fakeConnection(overrides = {}) {
  return {
    getAccountInfo: overrides.getAccountInfo ?? (async () => null),
    getBalance: overrides.getBalance ?? (async () => 0),
    getLatestBlockhash: overrides.getLatestBlockhash ?? (async () => ({ blockhash: ZERO_BLOCKHASH, lastValidBlockHeight: 100 })),
    getSlot: overrides.getSlot ?? (async () => 42),
    getBlockTime: overrides.getBlockTime ?? (async () => 1_700_000_000),
    simulateTransaction: overrides.simulateTransaction,
    sendRawTransaction: overrides.sendRawTransaction,
    confirmTransaction: overrides.confirmTransaction,
    getSignatureStatus: overrides.getSignatureStatus,
  };
}

test("loadSigners rejects a keypair equal to the forbidden deployment authority", () => {
  const dir = makeRepo();
  const { kp, path } = writeKeypair(dir, "sponsor.json");
  assert.throws(
    () => loadSigners(dir, { sponsor: path }, kp.publicKey.toBase58()),
    /must not be the deployment\/upgrade authority/,
  );
  assert.doesNotThrow(() => loadSigners(dir, { sponsor: path }, "Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk"));
});

test("adapter exposes no airdrop/fund/close surface", () => {
  const dir = makeRepo();
  const { kp } = writeKeypair(dir, "s.json");
  const adapter = createProductionAdapter({ connection: fakeConnection(), repoRoot: dir, signers: { sponsor: kp } });
  for (const forbidden of ["requestAirdrop", "airdrop", "fund", "closeAccount", "transfer", "setUpgradeAuthority"]) {
    assert.equal(typeof adapter[forbidden], "undefined", `adapter must not expose ${forbidden}`);
  }
  assert.deepEqual(adapter.signerPublicKeys, { sponsor: kp.publicKey.toBase58() });
});

test("getChainTime derives from getBlockTime(getSlot)", async () => {
  const dir = makeRepo();
  const { kp } = writeKeypair(dir, "s.json");
  const adapter = createProductionAdapter({ connection: fakeConnection({ getBlockTime: async () => 1_777_000_000 }), repoRoot: dir, signers: { sponsor: kp } });
  assert.equal(await adapter.getChainTime(), 1_777_000_000);

  const adapter2 = createProductionAdapter({ connection: fakeConnection({ getBlockTime: async () => null }), repoRoot: dir, signers: { sponsor: kp } });
  await assert.rejects(adapter2.getChainTime(), /chain time is unavailable/);
});

test("simulate calls simulateTransaction and never sendRawTransaction", async () => {
  const dir = makeRepo();
  const { kp } = writeKeypair(dir, "s.json");
  let simulated = false;
  let sent = false;
  const conn = fakeConnection({
    simulateTransaction: async () => { simulated = true; return { value: { err: { InstructionError: [0, { Custom: 6008 }] }, logs: ["l"], unitsConsumed: 5 } }; },
    sendRawTransaction: async () => { sent = true; return "sig"; },
  });
  const adapter = createProductionAdapter({ connection: conn, repoRoot: dir, signers: { sponsor: kp } });
  // A no-op memo-less instruction: use a transfer-free dummy via SystemProgram not needed; empty ix list is fine for signing a message with only fee payer.
  const res = await adapter.simulate({ instructions: [], feePayerRole: "sponsor", signerRoles: [] });
  assert.equal(simulated, true);
  assert.equal(sent, false, "simulate must never send");
  assert.deepEqual(res.err, { InstructionError: [0, { Custom: 6008 }] });
});

test("writeReceipt writes atomic canonical JSON with secrets sanitized", () => {
  const dir = makeRepo();
  const { kp } = writeKeypair(dir, "s.json");
  const receiptDir = join(dir, "receipts");
  const adapter = createProductionAdapter({ connection: fakeConnection(), repoRoot: dir, signers: { sponsor: kp }, receiptDir });
  adapter.writeReceipt("r.json", { executionId: "e1", secretKey: [1, 2, 3], seed: "x", privateKey: "y", ok: true });
  const path = join(receiptDir, "r.json");
  assert.ok(existsSync(path));
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(parsed.executionId, "e1");
  assert.equal(parsed.ok, true);
  assert.equal("secretKey" in parsed, false, "secretKey must be sanitized out");
  assert.equal("seed" in parsed, false, "seed must be sanitized out");
  assert.equal("privateKey" in parsed, false, "privateKey must be sanitized out");
});

test("no secret bytes appear in adapter public surface", () => {
  const dir = makeRepo();
  const { kp } = writeKeypair(dir, "s.json");
  const adapter = createProductionAdapter({ connection: fakeConnection(), repoRoot: dir, signers: { sponsor: kp } });
  const serialized = JSON.stringify(adapter.signerPublicKeys);
  assert.equal(serialized.includes(String(kp.secretKey[0])) && serialized.includes(String(kp.secretKey[1])), false);
});
