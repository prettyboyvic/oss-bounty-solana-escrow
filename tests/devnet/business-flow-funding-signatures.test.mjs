import assert from "node:assert/strict";
import test from "node:test";

import { Keypair, Message } from "@solana/web3.js";

import { DEVNET_GENESIS_HASH } from "../../scripts/devnet/safety.mjs";
import {
  deriveFlowInstances,
  deriveSelectedFunding,
} from "../../scripts/devnet/business-flow-runner.mjs";
import {
  BUSINESS_FLOW_EXECUTION_SPEC,
  selectExecutionEvents,
} from "../../scripts/devnet/business-flow-spec.mjs";
import {
  createCanonicalExecutionContext,
  createCanonicalRuntimeEffects,
} from "../../scripts/devnet/business-flow-execution.mjs";
import {
  createBusinessFlowExecutionRegistry,
  reconstructExactLegacyMessage,
} from "../../scripts/devnet/business-flow-transaction-factory.mjs";

const RENT_BY_CLASS = { mint: 1_461_600, ata: 2_039_280, escrow: 2_470_800, vault: 2_039_280 };
const FEE = 5_000;

// Solana charges the base fee PER required signature, not per transaction.
// deriveSelectedFunding must attribute (base fee * numRequiredSignatures) to the
// event fee payer. The one canonical SEND with an extra required signer is
// setup:mint_tokens (fee payer sponsor + mintAuthority = 2 signatures).

test("setup:mint_tokens is the only canonical SEND with a non-payer signer", () => {
  const sends = BUSINESS_FLOW_EXECUTION_SPEC.events.filter(
    (event) => event.kind === "SEND",
  );
  const withCosigners = sends.filter(
    (event) => event.requiredNonPayerSignerRoles.length > 0,
  );
  assert.deepEqual(
    withCosigners.map((event) => event.id),
    ["setup:mint_tokens"],
  );
  const mintTokens = withCosigners[0];
  assert.equal(mintTokens.feePayerRole, "sponsor");
  assert.deepEqual(mintTokens.requiredNonPayerSignerRoles, ["mintAuthority"]);
  // 1 fee payer + 1 non-payer signer = 2 required signatures.
  assert.equal(1 + mintTokens.requiredNonPayerSignerRoles.length, 2);
});

// Per-selection sponsor/maintainer fee lamports, derived from required signatures.
// release:  6 sponsor txs (one is 2-sig mint_tokens) -> 7 sigs -> 35_000
// refund:   7 sponsor txs (one is 2-sig mint_tokens) -> 8 sigs -> 40_000
// cancel:   6 sponsor txs (one is 2-sig mint_tokens) -> 7 sigs -> 35_000
// full:    11 sponsor txs (one is 2-sig mint_tokens) -> 12 sigs -> 60_000
const CASES = [
  { flows: ["release"], sponsorFee: 35_000, sponsorSigs: 7, maintainerFee: 5_000, maintainerSigs: 1 },
  { flows: ["refund"], sponsorFee: 40_000, sponsorSigs: 8, maintainerFee: 0, maintainerSigs: 0 },
  { flows: ["cancel"], sponsorFee: 35_000, sponsorSigs: 7, maintainerFee: 0, maintainerSigs: 0 },
  { flows: ["release", "refund", "cancel"], sponsorFee: 60_000, sponsorSigs: 12, maintainerFee: 5_000, maintainerSigs: 1 },
];

for (const testCase of CASES) {
  test(`funding charges per-signature fees for ${testCase.flows.join("+")}`, () => {
    const selectedPlan = selectExecutionEvents(
      BUSINESS_FLOW_EXECUTION_SPEC,
      testCase.flows,
    );
    const funding = deriveSelectedFunding({
      selectedPlan,
      rentByClass: RENT_BY_CLASS,
      feePerSignature: FEE,
    });
    assert.equal(
      funding.byIdentity.sponsor.feeLamports,
      testCase.sponsorFee,
      "sponsor fee lamports",
    );
    assert.equal(
      funding.byIdentity.sponsor.signatureCount,
      testCase.sponsorSigs,
      "sponsor signature count",
    );
    assert.equal(
      funding.byIdentity.maintainer.feeLamports,
      testCase.maintainerFee,
      "maintainer fee lamports",
    );
    assert.equal(
      funding.byIdentity.maintainer.signatureCount,
      testCase.maintainerSigs,
      "maintainer signature count",
    );
    // feeLamports must equal signatureCount * feePerSignature for every identity.
    for (const allocation of Object.values(funding.byIdentity)) {
      assert.equal(allocation.feeLamports, allocation.signatureCount * FEE);
    }
  });
}

test("transaction count stays separate from signature count", () => {
  const funding = deriveSelectedFunding({
    selectedPlan: selectExecutionEvents(
      BUSINESS_FLOW_EXECUTION_SPEC,
      ["release", "refund", "cancel"],
    ),
    rentByClass: RENT_BY_CLASS,
    feePerSignature: FEE,
  });
  // 11 sponsor transactions but 12 sponsor signatures (mint_tokens is 2-sig).
  assert.equal(funding.byIdentity.sponsor.feeCount, 11);
  assert.equal(funding.byIdentity.sponsor.signatureCount, 12);
  assert.equal(funding.byIdentity.maintainer.feeCount, 1);
  assert.equal(funding.byIdentity.maintainer.signatureCount, 1);
  // Total base fees for the full matrix: 12 + 1 = 13 signatures -> 65_000.
  assert.equal(funding.transactionFeeLamports, 65_000);
});

test("funding rejects an invalid feePerSignature", () => {
  const base = {
    selectedPlan: selectExecutionEvents(BUSINESS_FLOW_EXECUTION_SPEC, ["release"]),
    rentByClass: RENT_BY_CLASS,
  };
  for (const feePerSignature of [-1, 1.5, undefined]) {
    assert.throws(
      () => deriveSelectedFunding({ ...base, feePerSignature }),
      /feePerSignature.*nonnegative integer/,
    );
  }
});

// --- Compiled-message equality oracle -------------------------------------
//
// Proves the planner's per-SEND signature count equals the canonical compiled
// legacy message's numRequiredSignatures, for the frozen singleton, under
// distinct signer identities. This is the invariant that keeps the funding
// model from drifting from real transaction fee semantics.

async function buildContext() {
  const sponsor = Keypair.generate().publicKey;
  const maintainer = Keypair.generate().publicKey;
  const contributor = Keypair.generate().publicKey;
  const mintAuthority = Keypair.generate().publicKey;
  const programId = Keypair.generate().publicKey.toBase58();
  const flows = ["release", "refund", "cancel"];
  const instances = deriveFlowInstances(flows, "sig-oracle", {
    programId,
    sponsor: sponsor.toBase58(),
  });
  const plan = {
    identities: {
      sponsor: sponsor.toBase58(),
      maintainer: maintainer.toBase58(),
      contributor: contributor.toBase58(),
    },
    manifest: {
      genesisHash: DEVNET_GENESIS_HASH,
      programId,
      amount: 1_000_000,
      decimals: 6,
      instances,
    },
  };
  const adapter = { signerPublicKeys: { mintAuthority: mintAuthority.toBase58() } };
  const grant = { executionId: "sig-oracle-exec", enabledFlows: flows };
  const context = await createCanonicalExecutionContext({
    plan,
    grant,
    adapter,
    chainTimeSeconds: 1_785_000_000,
    mintLamports: 1_461_600,
  });
  return { ...context, refundExpiry: 1n, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 };
}

test("planner signature count equals compiled numRequiredSignatures for every SEND", async () => {
  const context = await buildContext();
  const registry = createBusinessFlowExecutionRegistry();
  const sends = selectExecutionEvents(
    BUSINESS_FLOW_EXECUTION_SPEC,
    ["release", "refund", "cancel"],
  ).sendEvents;
  for (const event of sends) {
    const bytes = await reconstructExactLegacyMessage(event.id, context, registry);
    const compiled = Message.from(bytes).header.numRequiredSignatures;
    const plannerCount = 1 + event.requiredNonPayerSignerRoles.length;
    assert.equal(
      compiled,
      plannerCount,
      `${event.id}: compiled numRequiredSignatures ${compiled} != planner ${plannerCount}`,
    );
  }
});
