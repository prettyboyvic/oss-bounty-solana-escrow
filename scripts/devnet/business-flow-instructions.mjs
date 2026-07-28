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
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { CLASSIC_TOKEN_PROGRAM_ID, assertClassicTokenProgram } from "./safety.mjs";

export const ESCROW_STATUS = Object.freeze([
  "Initialized",
  "Funded",
  "Released",
  "Refunded",
  "Cancelled",
]);

export const ESCROW_ERROR_CODES = Object.freeze({
  6000: "InvalidStatus",
  6001: "InvalidAmount",
  6002: "InvalidExpiry",
  6003: "InvalidMaintainer",
  6004: "InvalidContributor",
  6005: "InvalidContributorTokenOwner",
  6006: "UnauthorizedSponsor",
  6007: "EscrowExpired",
  6008: "EscrowNotExpired",
  6009: "InvalidVault",
  6010: "InvalidExternalReference",
});

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

// Decode a custom Anchor program error from a simulation/confirmation result.
// Accepts either an err object ({ InstructionError: [i, { Custom: code }] }) or
// program log lines, and returns the mapped error name when recognized.
export function decodeProgramError({ err, logs } = {}) {
  let code = null;
  if (err && typeof err === "object" && Array.isArray(err.InstructionError)) {
    const detail = err.InstructionError[1];
    if (detail && typeof detail === "object" && Number.isInteger(detail.Custom)) {
      code = detail.Custom;
    }
  }
  if (code === null && Array.isArray(logs)) {
    for (const line of logs) {
      const m = /Error Code:\s*(\w+)/.exec(line) || /custom program error:\s*0x([0-9a-fA-F]+)/.exec(line);
      if (m) {
        if (/^\d+$/.test(m[1]) === false && !/^[0-9a-fA-F]+$/.test(m[1])) {
          return { code: null, name: m[1] };
        }
        code = m[1].length <= 4 && /[a-fA-F]/.test(m[1]) ? parseInt(m[1], 16) : Number(m[1]);
        break;
      }
    }
  }
  if (code === null) return { code: null, name: null };
  return { code, name: ESCROW_ERROR_CODES[code] ?? null };
}
