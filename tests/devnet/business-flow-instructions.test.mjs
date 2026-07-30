import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  Keypair,
  Message,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { MINT_SIZE, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
  ESCROW_ERROR_CODES,
  ESCROW_STATUS,
  buildCancel,
  buildCreateAssociatedTokenAccount,
  buildCreateMintWithSeedInstructions,
  buildCreateMintInstructions,
  buildFundEscrow,
  buildInitializeEscrow,
  buildMintTo,
  buildRefund,
  buildRelease,
  decodeEscrow,
  decodeAndVerifyCreateMintWithSeed,
  decodeMint,
  decodeProgramError,
  decodeTokenAccountAmount,
  discriminator,
} from "../../scripts/devnet/business-flow-instructions.mjs";
import { deriveBusinessFlowMint } from "../../scripts/devnet/business-flow-identity.mjs";

const PROGRAM_ID = "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z";
const A = PublicKey.unique().toBase58();
const B = PublicKey.unique().toBase58();
const C = PublicKey.unique().toBase58();
const D = PublicKey.unique().toBase58();

// Independent re-implementation of the IDL account-meta contract to pin order.
const IDL_ACCOUNTS = {
  initialize_escrow: [
    ["sponsor", true, true],
    ["mint", false, false],
    ["escrow", false, true],
    ["vault", false, true],
    ["token_program", false, false],
    ["system_program", false, false],
  ],
  fund_escrow: [
    ["sponsor", true, true],
    ["mint", false, false],
    ["sponsor_token", false, true],
    ["escrow", false, true],
    ["vault", false, true],
    ["token_program", false, false],
  ],
  release: [
    ["maintainer", true, false],
    ["mint", false, false],
    ["escrow", false, true],
    ["vault", false, true],
    ["contributor_token", false, true],
    ["token_program", false, false],
  ],
  refund: [
    ["sponsor", true, false],
    ["mint", false, false],
    ["escrow", false, true],
    ["vault", false, true],
    ["sponsor_token", false, true],
    ["token_program", false, false],
  ],
  cancel: [
    ["sponsor", true, false],
    ["escrow", false, true],
  ],
};

function checkFlags(ix, name) {
  const expected = IDL_ACCOUNTS[name];
  assert.equal(ix.keys.length, expected.length, `${name} account count`);
  expected.forEach(([, signer, writable], i) => {
    assert.equal(ix.keys[i].isSigner, signer, `${name} acct ${i} signer`);
    assert.equal(ix.keys[i].isWritable, writable, `${name} acct ${i} writable`);
  });
  assert.deepEqual([...ix.data.subarray(0, 8)], [...discriminator("global", name)]);
  assert.equal(ix.programId.toBase58(), PROGRAM_ID);
}

test("initialize_escrow builder matches IDL metas, flags, discriminator and data length", () => {
  const H = Array.from({ length: 32 }, (_, i) => i + 3);
  const ix = buildInitializeEscrow({
    programId: PROGRAM_ID,
    sponsor: A,
    mint: B,
    escrow: C,
    vault: D,
    externalRefHash: H,
    amount: 1_000_000,
    expiry: 9_999_999_999,
    maintainer: A,
    contributor: B,
  });
  checkFlags(ix, "initialize_escrow");
  assert.equal(ix.data.length, 120); // 8 + 32 + 8 + 8 + 32 + 32
  assert.equal(ix.keys[4].pubkey.toBase58(), TOKEN_PROGRAM_ID.toBase58());
  assert.equal(ix.keys[5].pubkey.toBase58(), SystemProgram.programId.toBase58());
  // amount encoded LE at offset 40
  assert.equal(ix.data.readBigUInt64LE(40), 1_000_000n);
});

test("fund/release/refund/cancel builders match IDL", () => {
  checkFlags(buildFundEscrow({ programId: PROGRAM_ID, sponsor: A, mint: B, sponsorToken: C, escrow: D, vault: A }), "fund_escrow");
  checkFlags(buildRelease({ programId: PROGRAM_ID, maintainer: A, mint: B, escrow: C, vault: D, contributorToken: A }), "release");
  checkFlags(buildRefund({ programId: PROGRAM_ID, sponsor: A, mint: B, escrow: C, vault: D, sponsorToken: A }), "refund");
  checkFlags(buildCancel({ programId: PROGRAM_ID, sponsor: A, escrow: C }), "cancel");
});

test("asset-setup builders use classic token program and reject non-6 decimals", () => {
  const mintIx = buildCreateMintInstructions({ payer: A, mint: B, mintAuthority: C, decimals: 6, lamports: 1461600 });
  assert.equal(mintIx.length, 2);
  assert.equal(mintIx[0].programId.toBase58(), SystemProgram.programId.toBase58());
  assert.equal(mintIx[1].programId.toBase58(), TOKEN_PROGRAM_ID.toBase58());
  assert.throws(() => buildCreateMintInstructions({ payer: A, mint: B, mintAuthority: C, decimals: 9, lamports: 1 }), /6 decimals/);

  const ata = buildCreateAssociatedTokenAccount({ payer: A, owner: B, mint: C });
  assert.ok(ata.address instanceof PublicKey);
  assert.equal(ata.instruction.keys.some((k) => k.pubkey.equals(TOKEN_PROGRAM_ID)), true);

  const mintTo = buildMintTo({ mint: B, destination: C, mintAuthority: D, amount: 1_000_000 });
  assert.equal(mintTo.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58());
});

test("the pinned SDK builder accepts oversized seeds and mismatched derived addresses", () => {
  const payer = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
  const unrelated = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;

  for (const seed of ["a".repeat(33), "é".repeat(17)]) {
    assert.ok(Buffer.byteLength(seed, "utf8") > 32);
    const instruction = SystemProgram.createAccountWithSeed({
      fromPubkey: payer,
      newAccountPubkey: unrelated,
      basePubkey: payer,
      seed,
      lamports: 1,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    });
    const decoded = SystemInstruction.decodeCreateWithSeed(instruction);
    assert.equal(decoded.seed, seed);
    assert.equal(decoded.newAccountPubkey.toBase58(), unrelated.toBase58());
  }
});

test("application validation rejects noncanonical create-with-seed input before SDK access", async () => {
  const sponsor = Keypair.fromSeed(new Uint8Array(32).fill(3));
  const authority = Keypair.fromSeed(new Uint8Array(32).fill(4));
  const input = {
    executionId: "exec-1",
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    programId: PROGRAM_ID,
    sponsorBase: sponsor.publicKey.toBase58(),
    payer: sponsor.publicKey.toBase58(),
    base: sponsor.publicKey.toBase58(),
    owner: TOKEN_PROGRAM_ID.toBase58(),
    mintAuthority: authority.publicKey.toBase58(),
    decimals: 6,
    lamports: 1_461_600,
  };
  const derived = await deriveBusinessFlowMint(input);
  const builderCalls = [];
  const builder = (value) => {
    builderCalls.push(value);
    return SystemProgram.createAccountWithSeed(value);
  };
  const invalid = [
    { seed: "a".repeat(33), mint: derived.mint },
    { seed: "é".repeat(17), mint: derived.mint },
    { seed: derived.seed, mint: Keypair.generate().publicKey.toBase58() },
    { seed: derived.seed, mint: derived.mint, base: Keypair.generate().publicKey.toBase58() },
    { seed: derived.seed, mint: derived.mint, owner: SystemProgram.programId.toBase58() },
  ];

  for (const mutation of invalid) {
    await assert.rejects(
      buildCreateMintWithSeedInstructions(
        { ...input, seed: derived.seed, mint: derived.mint, ...mutation },
        { createAccountWithSeed: builder },
      ),
      /canonical create-with-seed/,
    );
  }
  assert.equal(builderCalls.length, 0);
});

test("valid deterministic mint instruction is decoded and compiles to one sponsor signature", async () => {
  const sponsor = Keypair.fromSeed(new Uint8Array(32).fill(5));
  const authority = Keypair.fromSeed(new Uint8Array(32).fill(6));
  const input = {
    executionId: "matrix-1",
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    programId: PROGRAM_ID,
    sponsorBase: sponsor.publicKey.toBase58(),
    payer: sponsor.publicKey.toBase58(),
    base: sponsor.publicKey.toBase58(),
    owner: TOKEN_PROGRAM_ID.toBase58(),
    mintAuthority: authority.publicKey.toBase58(),
    decimals: 6,
    lamports: 1_461_600,
  };
  const derived = await deriveBusinessFlowMint(input);
  const built = await buildCreateMintWithSeedInstructions({
    ...input,
    seed: derived.seed,
    mint: derived.mint,
  });
  const proof = await decodeAndVerifyCreateMintWithSeed(built.instructions, {
    ...input,
    seed: derived.seed,
    mint: derived.mint,
  });

  assert.deepEqual(proof, {
    payer: sponsor.publicKey.toBase58(),
    base: sponsor.publicKey.toBase58(),
    mint: derived.mint,
    seed: derived.seed,
    owner: TOKEN_PROGRAM_ID.toBase58(),
    lamports: 1_461_600,
    space: MINT_SIZE,
  });
  const blockhash = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey.toBase58();
  const tx = new Transaction({
    feePayer: sponsor.publicKey,
    recentBlockhash: blockhash,
  }).add(...built.instructions);
  tx.sign(sponsor);
  const message = Message.from(tx.serializeMessage());
  assert.equal(message.header.numRequiredSignatures, 1);
  assert.deepEqual(message.accountKeys.map(String), [
    sponsor.publicKey.toBase58(),
    derived.mint,
    SystemProgram.programId.toBase58(),
    TOKEN_PROGRAM_ID.toBase58(),
  ]);
  assert.deepEqual(
    built.instructions[0].keys.map((key) => ({
      pubkey: key.pubkey.toBase58(),
      signer: key.isSigner,
      writable: key.isWritable,
    })),
    [
      { pubkey: sponsor.publicKey.toBase58(), signer: true, writable: true },
      { pubkey: derived.mint, signer: false, writable: true },
    ],
  );
});

test("decodeEscrow reads the full struct layout", () => {
  const buf = Buffer.alloc(8 + 32 * 5 + 32 + 8 + 8 + 8 + 3);
  discriminator("account", "Escrow").copy(buf, 0);
  const sponsor = new PublicKey(A);
  let o = 8;
  sponsor.toBuffer().copy(buf, o); o += 32; // sponsor
  new PublicKey(B).toBuffer().copy(buf, o); o += 32; // maintainer
  new PublicKey(C).toBuffer().copy(buf, o); o += 32; // contributor
  new PublicKey(D).toBuffer().copy(buf, o); o += 32; // mint
  new PublicKey(A).toBuffer().copy(buf, o); o += 32; // vault
  Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).copy(buf, o); o += 32; // ref
  buf.writeBigUInt64LE(1_000_000n, o); o += 8; // amount
  buf.writeBigInt64LE(111n, o); o += 8; // created_at
  buf.writeBigInt64LE(222n, o); o += 8; // expiry
  buf.writeUInt8(1, o); o += 1; // status = Funded
  buf.writeUInt8(254, o); o += 1; // bump
  buf.writeUInt8(253, o); // vault_bump
  const e = decodeEscrow(buf);
  assert.equal(e.sponsor, A);
  assert.equal(e.mint, D);
  assert.equal(e.amount, "1000000");
  assert.equal(e.expiry, "222");
  assert.equal(e.status, "Funded");
  assert.equal(e.bump, 254);
});

test("token account and mint decoders read amount/decimals", () => {
  const acct = Buffer.alloc(165);
  acct.writeBigUInt64LE(4242n, 64);
  assert.equal(decodeTokenAccountAmount(acct), "4242");
  const mint = Buffer.alloc(82);
  mint.writeUInt8(6, 44);
  mint.writeUInt8(1, 45);
  assert.deepEqual(decodeMint(mint), { decimals: 6, isInitialized: true });
});

test("program error decoder maps custom codes and log names", () => {
  assert.equal(decodeProgramError({ err: { InstructionError: [0, { Custom: 6008 }] } }).name, "EscrowNotExpired");
  assert.equal(decodeProgramError({ err: { InstructionError: [0, { Custom: 6007 }] } }).name, "EscrowExpired");
  assert.equal(decodeProgramError({ logs: ["Program log: Error Code: UnauthorizedSponsor"] }).name, "UnauthorizedSponsor");
  assert.equal(decodeProgramError({ err: null, logs: [] }).name, null);
});

test("status and error-code tables match the program", () => {
  assert.deepEqual(ESCROW_STATUS, ["Initialized", "Funded", "Released", "Refunded", "Cancelled"]);
  assert.equal(ESCROW_ERROR_CODES[6006], "UnauthorizedSponsor");
  assert.equal(Object.keys(ESCROW_ERROR_CODES).length, 11);
});

test("discriminator matches sha256 global namespace", () => {
  assert.deepEqual(
    [...discriminator("global", "release")],
    [...createHash("sha256").update("global:release").digest().subarray(0, 8)],
  );
});
