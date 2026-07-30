import assert from "node:assert/strict";
import test from "node:test";

import { Keypair, Message, PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { DEVNET_GENESIS_HASH } from "../../scripts/devnet/safety.mjs";
import { deriveBusinessFlowMint } from "../../scripts/devnet/business-flow-identity.mjs";
import {
  buildStepInstructions,
  createBusinessFlowExecutionRegistry,
  normalizedMessageTemplate,
  prepareExactLegacyTransaction,
  reconstructExactLegacyMessage,
} from "../../scripts/devnet/business-flow-transaction-factory.mjs";

// Independent acceptance facts transcribed from the published Phase-4B design,
// the committed Anchor IDL account order, and classic SPL/System instruction
// layouts. This table intentionally does not import the canonical execution spec.
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = TOKEN_PROGRAM_ID.toBase58();
const ATA_PROGRAM = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
const escrow = (discriminator, length, accounts) => ({
  program: "escrowProgram",
  discriminator,
  length,
  accounts,
});
const A = (role, signer, writable) => [role, signer, writable];
const INITIALIZE = [
  A("sponsor", true, true),
  A("mint", false, false),
  A("escrow", false, true),
  A("vault", false, true),
  A("tokenProgram", false, false),
  A("systemProgram", false, false),
];
const FUND = [
  A("sponsor", true, true),
  A("mint", false, false),
  A("sponsorToken", false, true),
  A("escrow", false, true),
  A("vault", false, true),
  A("tokenProgram", false, false),
];
const RELEASE = (authority = "maintainer") => [
  A(authority, true, false),
  A("mint", false, false),
  A("escrow", false, true),
  A("vault", false, true),
  A("contributorToken", false, true),
  A("tokenProgram", false, false),
];
const REFUND = [
  A("sponsor", true, false),
  A("mint", false, false),
  A("escrow", false, true),
  A("vault", false, true),
  A("sponsorToken", false, true),
  A("tokenProgram", false, false),
];

const ACCEPTANCE = [
  {
    id: "setup:create_mint", kind: "SEND", payer: "sponsor", signers: ["sponsor"],
    instructions: [
      { program: SYSTEM_PROGRAM, discriminator: "03000000", length: 124, accounts: [A("sponsor", true, true), A("mint", false, true)] },
      { program: TOKEN_PROGRAM, discriminator: "14", length: 35, accounts: [A("mint", false, true)] },
    ],
  },
  {
    id: "setup:sponsor_ata", kind: "SEND", payer: "sponsor", signers: ["sponsor"],
    instructions: [{
      program: ATA_PROGRAM, discriminator: "", length: 0,
      accounts: [
        A("sponsor", true, true), A("sponsorAta", false, true),
        A("sponsor", false, false), A("mint", false, false),
        A("systemProgram", false, false), A("tokenProgram", false, false),
      ],
    }],
  },
  {
    id: "setup:contributor_ata", kind: "SEND", payer: "sponsor", signers: ["sponsor"],
    instructions: [{
      program: ATA_PROGRAM, discriminator: "", length: 0,
      accounts: [
        A("sponsor", true, true), A("contributorAta", false, true),
        A("contributor", false, false), A("mint", false, false),
        A("systemProgram", false, false), A("tokenProgram", false, false),
      ],
    }],
  },
  {
    id: "setup:mint_tokens", kind: "SEND", payer: "sponsor",
    signers: ["sponsor", "mintAuthority"],
    instructions: [{
      program: TOKEN_PROGRAM, discriminator: "07", length: 9,
      accounts: [A("mint", false, true), A("sponsorToken", false, true), A("mintAuthority", true, false)],
    }],
  },
  {
    id: "release:initialize", kind: "SEND", payer: "sponsor", signers: ["sponsor"],
    flow: "release", instructions: [escrow("f3a04d990b5c30d1", 120, INITIALIZE)],
  },
  {
    id: "release:fund", kind: "SEND", payer: "sponsor", signers: ["sponsor"],
    flow: "release", instructions: [escrow("9b12da8db6d545c9", 8, FUND)],
  },
  {
    id: "unauthorized_release", kind: "SIMULATE", payer: "sponsor",
    signers: ["sponsor", "contributor"], flow: "release",
    instructions: [escrow("fdf90fce1c7fc1f1", 8, RELEASE("contributor"))],
  },
  {
    id: "release:release", kind: "SEND", payer: "maintainer",
    signers: ["maintainer"], flow: "release",
    instructions: [escrow("fdf90fce1c7fc1f1", 8, RELEASE())],
  },
  {
    id: "refund:initialize", kind: "SEND", payer: "sponsor", signers: ["sponsor"],
    flow: "refund", instructions: [escrow("f3a04d990b5c30d1", 120, INITIALIZE)],
  },
  {
    id: "refund:fund", kind: "SEND", payer: "sponsor", signers: ["sponsor"],
    flow: "refund", instructions: [escrow("9b12da8db6d545c9", 8, FUND)],
  },
  {
    id: "refund_before_expiry", kind: "SIMULATE", payer: "sponsor",
    signers: ["sponsor"], flow: "refund",
    instructions: [escrow("0260b7fb3fd02e2e", 8, REFUND)],
  },
  {
    id: "release_at_or_after_expiry", kind: "SIMULATE", payer: "sponsor",
    signers: ["sponsor", "maintainer"], flow: "refund",
    instructions: [escrow("fdf90fce1c7fc1f1", 8, RELEASE())],
  },
  {
    id: "refund:refund", kind: "SEND", payer: "sponsor", signers: ["sponsor"],
    flow: "refund", instructions: [escrow("0260b7fb3fd02e2e", 8, REFUND)],
  },
  {
    id: "cancel:initialize", kind: "SEND", payer: "sponsor", signers: ["sponsor"],
    flow: "cancel", instructions: [escrow("f3a04d990b5c30d1", 120, INITIALIZE)],
  },
  {
    id: "cancel:cancel", kind: "SEND", payer: "sponsor", signers: ["sponsor"],
    flow: "cancel",
    instructions: [escrow("e8dbdf29dbecdcbe", 8, [A("sponsor", true, false), A("escrow", false, true)])],
  },
];

function signer(byte) {
  return Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => byte));
}

async function fixture() {
  const signers = {
    sponsor: signer(1), maintainer: signer(2),
    contributor: signer(3), mintAuthority: signer(4),
  };
  const programId = signer(5).publicKey;
  const derivation = await deriveBusinessFlowMint({
    executionId: "matrix-1", genesisHash: DEVNET_GENESIS_HASH,
    programId, sponsorBase: signers.sponsor.publicKey,
  });
  const mint = new PublicKey(derivation.mint);
  const context = {
    executionId: "matrix-1", genesisHash: DEVNET_GENESIS_HASH, programId,
    sponsor: signers.sponsor.publicKey, maintainer: signers.maintainer.publicKey,
    contributor: signers.contributor.publicKey,
    mintAuthority: signers.mintAuthority.publicKey,
    mint, mintSeed: derivation.seed, mintLamports: 1_461_600, decimals: 6,
    setupMintAmount: 3_000_000n, amount: 1_000_000n,
    sponsorToken: signer(6).publicKey, contributorToken: signer(7).publicKey,
    releaseExpiry: 1_800_000_100n, refundExpiry: 1_800_000_200n,
    expiryPolicyIds: {
      release: "release-expiry-policy-v1",
      refund: "refund-expiry-policy-v1",
      cancel: "cancel-expiry-policy-v1",
    },
    instances: {
      release: { escrow: signer(8).publicKey, vault: signer(9).publicKey, externalRefHash: Buffer.alloc(32, 11) },
      refund: { escrow: signer(10).publicKey, vault: signer(11).publicKey, externalRefHash: Buffer.alloc(32, 12) },
      cancel: { escrow: signer(12).publicKey, vault: signer(13).publicKey, externalRefHash: Buffer.alloc(32, 13) },
    },
    recentBlockhash: signer(14).publicKey.toBase58(),
    lastValidBlockHeight: 987_654,
  };
  return { context, signers };
}

function expectedAddress(role, shape, context) {
  if (role === "systemProgram") return SYSTEM_PROGRAM;
  if (role === "tokenProgram") return TOKEN_PROGRAM;
  if (role === "sponsorAta") {
    return getAssociatedTokenAddressSync(context.mint, context.sponsor, true).toBase58();
  }
  if (role === "contributorAta") {
    return getAssociatedTokenAddressSync(context.mint, context.contributor, true).toBase58();
  }
  if (role === "escrow" || role === "vault") {
    return context.instances[shape.flow][role].toBase58();
  }
  return context[role].toBase58();
}

test("independent acceptance matrix pins all fifteen transaction shapes", async () => {
  const { context, signers } = await fixture();
  const registry = createBusinessFlowExecutionRegistry();
  assert.equal(ACCEPTANCE.length, 15);
  assert.equal(ACCEPTANCE.filter((shape) => shape.kind === "SEND").length, 12);
  assert.equal(ACCEPTANCE.filter((shape) => shape.kind === "SIMULATE").length, 3);

  for (const shape of ACCEPTANCE) {
    const template = await normalizedMessageTemplate(shape.id, context, registry);
    assert.equal(template.kind, shape.kind, `${shape.id} operation kind`);
    const instructions = await buildStepInstructions(shape.id, context, registry);
    const prepared = await prepareExactLegacyTransaction(
      shape.id, context, signers, registry,
    );
    assert.equal(prepared.feePayer, context[shape.payer].toBase58(), shape.id);
    assert.deepEqual(
      prepared.signers.map((entry) => entry.publicKey),
      shape.signers.map((role) => signers[role].publicKey.toBase58()),
      shape.id,
    );
    assert.equal(instructions.length, shape.instructions.length, shape.id);
    instructions.forEach((instruction, index) => {
      const expected = shape.instructions[index];
      const expectedProgram =
        expected.program === "escrowProgram"
          ? context.programId.toBase58()
          : expected.program;
      assert.equal(instruction.programId.toBase58(), expectedProgram, shape.id);
      assert.equal(instruction.data.length, expected.length, shape.id);
      assert.equal(
        Buffer.from(instruction.data)
          .subarray(0, expected.discriminator.length / 2)
          .toString("hex"),
        expected.discriminator,
        shape.id,
      );
      assert.deepEqual(
        instruction.keys.map((account) => [
          account.pubkey.toBase58(), account.isSigner, account.isWritable,
        ]),
        expected.accounts.map(([role, isSigner, isWritable]) => [
          expectedAddress(role, shape, context), isSigner, isWritable,
        ]),
        shape.id,
      );
    });
    const message = Message.from(prepared.messageBytes);
    assert.deepEqual(
      message.accountKeys
        .slice(0, message.header.numRequiredSignatures)
        .map((publicKey) => publicKey.toBase58()),
      shape.signers.map((role) => signers[role].publicKey.toBase58()),
      shape.id,
    );
  }
});

test("fee-payer and two-instruction order mutations break exact reconstruction", async () => {
  const { context, signers } = await fixture();
  const registry = createBusinessFlowExecutionRegistry();
  const release = await prepareExactLegacyTransaction(
    "release:release", context, signers, registry,
  );
  const alternateMaintainer = signer(21);
  const changedPayer = await prepareExactLegacyTransaction(
    "release:release",
    { ...context, maintainer: alternateMaintainer.publicKey },
    { ...signers, maintainer: alternateMaintainer },
    registry,
  );
  assert.notDeepEqual(changedPayer.messageBytes, release.messageBytes);

  const mint = await prepareExactLegacyTransaction(
    "setup:create_mint", context, signers, registry,
  );
  const reversed = createBusinessFlowExecutionRegistry({
    builderOverrides: {
      "create-mint-with-seed-v1": async (ctx) =>
        (await buildStepInstructions("setup:create_mint", ctx, registry)).toReversed(),
    },
  });
  assert.ok(mint.messageBytes.length > 0);
  await assert.rejects(
    reconstructExactLegacyMessage("setup:create_mint", context, reversed),
    /instruction schema/,
  );
});

test("wait remains outside the independent transaction boundary", async () => {
  const { context } = await fixture();
  await assert.rejects(
    buildStepInstructions(
      "refund:wait_expiry",
      context,
      createBusinessFlowExecutionRegistry(),
    ),
    /does not produce a transaction/,
  );
});
