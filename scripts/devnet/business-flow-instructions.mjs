// Concrete instruction builders and account decoders for the deployed escrow
// program and its classic SPL-token asset setup.
//
// Instruction data uses the Anchor global-namespace discriminator
// (sha256("global:<name>")[0..8]) and account-meta orders that mirror the
// program's `#[derive(Accounts)]` structs and the committed IDL (tests/idl.ts).
// A test pins these against the IDL so any drift is caught. No business rule is
// re-implemented here; this module only encodes/decodes.

import { createHash } from "node:crypto";

import {
  PublicKey,
  SystemInstruction,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeAccount3Instruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  decodeInitializeMint2Instruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { CLASSIC_TOKEN_PROGRAM_ID, assertClassicTokenProgram } from "./safety.mjs";
import { deriveBusinessFlowMint } from "./business-flow-identity.mjs";

export {
  ESCROW_ERROR_CODES,
  decodeProgramError,
} from "./business-flow-errors.mjs";

export const ESCROW_STATUS = Object.freeze([
  "Initialized",
  "Funded",
  "Released",
  "Refunded",
  "Cancelled",
]);

export function discriminator(namespace, name) {
  return createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0, 8);
}

function pk(value, label) {
  try {
    return value instanceof PublicKey ? value : new PublicKey(value);
  } catch {
    throw new Error(`${label} must be a valid public key`);
  }
}

function meta(pubkey, isSigner, isWritable) {
  return { pubkey: pk(pubkey, "account"), isSigner, isWritable };
}

function encodeU64LE(value) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

function encodeI64LE(value) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(value));
  return buf;
}

function encode32(bytes, label) {
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (arr.length !== 32) throw new Error(`${label} must be 32 bytes`);
  return Buffer.from(arr);
}

// --- Escrow instruction builders ---

export function buildInitializeEscrow({
  programId,
  sponsor,
  mint,
  escrow,
  vault,
  externalRefHash,
  amount,
  expiry,
  maintainer,
  contributor,
}) {
  const data = Buffer.concat([
    discriminator("global", "initialize_escrow"),
    encode32(externalRefHash, "external_ref_hash"),
    encodeU64LE(amount),
    encodeI64LE(expiry),
    pk(maintainer, "maintainer").toBuffer(),
    pk(contributor, "contributor").toBuffer(),
  ]);
  return new TransactionInstruction({
    programId: pk(programId, "programId"),
    keys: [
      meta(sponsor, true, true),
      meta(mint, false, false),
      meta(escrow, false, true),
      meta(vault, false, true),
      meta(TOKEN_PROGRAM_ID, false, false),
      meta(SystemProgram.programId, false, false),
    ],
    data,
  });
}

export function buildFundEscrow({ programId, sponsor, mint, sponsorToken, escrow, vault }) {
  return new TransactionInstruction({
    programId: pk(programId, "programId"),
    keys: [
      meta(sponsor, true, true),
      meta(mint, false, false),
      meta(sponsorToken, false, true),
      meta(escrow, false, true),
      meta(vault, false, true),
      meta(TOKEN_PROGRAM_ID, false, false),
    ],
    data: Buffer.from(discriminator("global", "fund_escrow")),
  });
}

export function buildRelease({ programId, maintainer, mint, escrow, vault, contributorToken }) {
  return new TransactionInstruction({
    programId: pk(programId, "programId"),
    keys: [
      meta(maintainer, true, false),
      meta(mint, false, false),
      meta(escrow, false, true),
      meta(vault, false, true),
      meta(contributorToken, false, true),
      meta(TOKEN_PROGRAM_ID, false, false),
    ],
    data: Buffer.from(discriminator("global", "release")),
  });
}

export function buildRefund({ programId, sponsor, mint, escrow, vault, sponsorToken }) {
  return new TransactionInstruction({
    programId: pk(programId, "programId"),
    keys: [
      meta(sponsor, true, false),
      meta(mint, false, false),
      meta(escrow, false, true),
      meta(vault, false, true),
      meta(sponsorToken, false, true),
      meta(TOKEN_PROGRAM_ID, false, false),
    ],
    data: Buffer.from(discriminator("global", "refund")),
  });
}

export function buildCancel({ programId, sponsor, escrow }) {
  return new TransactionInstruction({
    programId: pk(programId, "programId"),
    keys: [meta(sponsor, true, false), meta(escrow, false, true)],
    data: Buffer.from(discriminator("global", "cancel")),
  });
}

// --- Classic SPL-token asset-setup builders ---

export function associatedTokenAddress(mint, owner) {
  return getAssociatedTokenAddressSync(pk(mint, "mint"), pk(owner, "owner"), true, TOKEN_PROGRAM_ID);
}

// Two instructions in one transaction: allocate the mint account then initialize
// it with the given decimals (6) and mint authority. Requires the fee payer and
// the mint keypair as signers.
export function buildCreateMintInstructions({ payer, mint, mintAuthority, decimals, lamports }) {
  assertClassicTokenProgram(CLASSIC_TOKEN_PROGRAM_ID);
  if (decimals !== 6) throw new Error("this program's acceptance flow uses 6 decimals");
  return [
    SystemProgram.createAccount({
      fromPubkey: pk(payer, "payer"),
      newAccountPubkey: pk(mint, "mint"),
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(pk(mint, "mint"), decimals, pk(mintAuthority, "mintAuthority"), null, TOKEN_PROGRAM_ID),
  ];
}

function equalPublicKey(left, right) {
  return new PublicKey(left).equals(new PublicKey(right));
}

async function canonicalCreateWithSeedInput(input) {
  try {
    assertClassicTokenProgram(input.owner);
  } catch {
    throw new Error("input does not match canonical create-with-seed derivation");
  }
  if (input.decimals !== 6) {
    throw new Error("canonical create-with-seed mint uses 6 decimals");
  }
  if (!Number.isSafeInteger(input.lamports) || input.lamports < 0) {
    throw new Error("canonical create-with-seed lamports must be a nonnegative integer");
  }
  const derivation = await deriveBusinessFlowMint(input);
  const canonical =
    typeof input.seed === "string" &&
    Buffer.byteLength(input.seed, "utf8") === 32 &&
    input.seed === derivation.seed &&
    equalPublicKey(input.payer, derivation.sponsorBase) &&
    equalPublicKey(input.base, derivation.sponsorBase) &&
    equalPublicKey(input.owner, derivation.tokenProgram) &&
    equalPublicKey(input.mint, derivation.mint);
  if (!canonical) {
    throw new Error("input does not match canonical create-with-seed derivation");
  }
  return derivation;
}

export async function buildCreateMintWithSeedInstructions(input, adapters = {}) {
  const derivation = await canonicalCreateWithSeedInput(input);
  const createAccountWithSeed =
    adapters.createAccountWithSeed ??
    SystemProgram.createAccountWithSeed.bind(SystemProgram);
  const create = createAccountWithSeed({
    fromPubkey: new PublicKey(input.payer),
    newAccountPubkey: new PublicKey(derivation.mint),
    basePubkey: new PublicKey(derivation.sponsorBase),
    seed: derivation.seed,
    lamports: input.lamports,
    space: MINT_SIZE,
    programId: TOKEN_PROGRAM_ID,
  });
  const initialize = createInitializeMint2Instruction(
    new PublicKey(derivation.mint),
    input.decimals,
    new PublicKey(input.mintAuthority),
    null,
    TOKEN_PROGRAM_ID,
  );
  const instructions = Object.freeze([create, initialize]);
  await decodeAndVerifyCreateMintWithSeed(instructions, input);
  return Object.freeze({ derivation, instructions });
}

export async function decodeAndVerifyCreateMintWithSeed(instructions, expected) {
  if (!Array.isArray(instructions) || instructions.length !== 2) {
    throw new Error("canonical create-with-seed mint requires exactly two instructions");
  }
  const derivation = await canonicalCreateWithSeedInput(expected);
  let decoded;
  let initialize;
  try {
    decoded = SystemInstruction.decodeCreateWithSeed(instructions[0]);
    initialize = decodeInitializeMint2Instruction(
      instructions[1],
      TOKEN_PROGRAM_ID,
    );
  } catch {
    throw new Error("canonical create-with-seed instruction decoding failed");
  }
  const keys = instructions[0].keys;
  const matches =
    equalPublicKey(decoded.fromPubkey, expected.payer) &&
    equalPublicKey(decoded.basePubkey, derivation.sponsorBase) &&
    equalPublicKey(decoded.newAccountPubkey, derivation.mint) &&
    decoded.seed === derivation.seed &&
    equalPublicKey(decoded.programId, derivation.tokenProgram) &&
    decoded.lamports === expected.lamports &&
    decoded.space === MINT_SIZE &&
    keys.length === 2 &&
    equalPublicKey(keys[0].pubkey, derivation.sponsorBase) &&
    keys[0].isSigner === true &&
    keys[0].isWritable === true &&
    equalPublicKey(keys[1].pubkey, derivation.mint) &&
    keys[1].isSigner === false &&
    keys[1].isWritable === true &&
    equalPublicKey(initialize.keys.mint.pubkey, derivation.mint) &&
    initialize.data.decimals === 6 &&
    equalPublicKey(initialize.data.mintAuthority, expected.mintAuthority) &&
    initialize.data.freezeAuthority === null;
  if (!matches) {
    throw new Error("decoded instruction does not match canonical create-with-seed mint");
  }
  return Object.freeze({
    payer: new PublicKey(expected.payer).toBase58(),
    base: derivation.sponsorBase,
    mint: derivation.mint,
    seed: derivation.seed,
    owner: derivation.tokenProgram,
    lamports: expected.lamports,
    space: MINT_SIZE,
  });
}

export function buildCreateAssociatedTokenAccount({ payer, owner, mint }) {
  const ata = associatedTokenAddress(mint, owner);
  return {
    address: ata,
    instruction: createAssociatedTokenAccountInstruction(
      pk(payer, "payer"),
      ata,
      pk(owner, "owner"),
      pk(mint, "mint"),
      TOKEN_PROGRAM_ID,
    ),
  };
}

export function buildMintTo({ mint, destination, mintAuthority, amount }) {
  return createMintToInstruction(
    pk(mint, "mint"),
    pk(destination, "destination"),
    pk(mintAuthority, "mintAuthority"),
    BigInt(amount),
    [],
    TOKEN_PROGRAM_ID,
  );
}

// Exposed for tests that need the explicit (non-ATA) account size / init form.
export { ACCOUNT_SIZE, MINT_SIZE, createInitializeAccount3Instruction };

// --- Decoders ---

export function decodeEscrow(data) {
  const buf = Buffer.from(data);
  if (buf.length < 8 + 32 * 5 + 32 + 8 + 8 + 8 + 1 + 1 + 1) {
    throw new Error("escrow account data is too small");
  }
  let o = 8; // account discriminator
  const readPk = () => {
    const v = new PublicKey(buf.subarray(o, o + 32)).toBase58();
    o += 32;
    return v;
  };
  const sponsor = readPk();
  const maintainer = readPk();
  const contributor = readPk();
  const mint = readPk();
  const vault = readPk();
  const externalRefHash = [...buf.subarray(o, o + 32)];
  o += 32;
  const amount = buf.readBigUInt64LE(o).toString();
  o += 8;
  const createdAt = buf.readBigInt64LE(o).toString();
  o += 8;
  const expiry = buf.readBigInt64LE(o).toString();
  o += 8;
  const statusIndex = buf.readUInt8(o);
  o += 1;
  const status = ESCROW_STATUS[statusIndex];
  if (!status) throw new Error(`unknown escrow status index ${statusIndex}`);
  const bump = buf.readUInt8(o);
  o += 1;
  const vaultBump = buf.readUInt8(o);
  return Object.freeze({
    sponsor,
    maintainer,
    contributor,
    mint,
    vault,
    externalRefHash,
    amount,
    createdAt,
    expiry,
    status,
    bump,
    vaultBump,
  });
}

// Classic SPL token account: amount is a u64 LE at offset 64.
export function decodeTokenAccountAmount(data) {
  const buf = Buffer.from(data);
  if (buf.length < ACCOUNT_SIZE) throw new Error("token account data is too small");
  return buf.readBigUInt64LE(64).toString();
}

// Classic SPL mint: decimals byte at offset 44; is_initialized at 45.
export function decodeMint(data) {
  const buf = Buffer.from(data);
  if (buf.length < MINT_SIZE) throw new Error("mint data is too small");
  return Object.freeze({
    decimals: buf.readUInt8(44),
    isInitialized: buf.readUInt8(45) === 1,
  });
}
