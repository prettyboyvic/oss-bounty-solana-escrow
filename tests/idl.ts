import { createHash } from "node:crypto";

import type { Idl } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";

import { PROGRAM_ID } from "./helpers.ts";

function discriminator(namespace: string, name: string): number[] {
  return [
    ...createHash("sha256")
      .update(`${namespace}:${name}`)
      .digest()
      .subarray(0, 8),
  ];
}

export const IDL: Idl = {
  address: PROGRAM_ID.toBase58(),
  metadata: {
    name: "oss_bounty_escrow",
    version: "0.1.0",
    spec: "0.1.0",
    description: "Pre-funded classic SPL-token escrow for open-source bounties.",
  },
  instructions: [
    {
      name: "initialize_escrow",
      discriminator: discriminator("global", "initialize_escrow"),
      accounts: [
        { name: "sponsor", writable: true, signer: true },
        { name: "mint" },
        { name: "escrow", writable: true },
        { name: "vault", writable: true },
        { name: "token_program", address: TOKEN_PROGRAM_ID.toBase58() },
        {
          name: "system_program",
          address: SystemProgram.programId.toBase58(),
        },
      ],
      args: [
        {
          name: "external_ref_hash",
          type: { array: ["u8", 32] },
        },
        { name: "amount", type: "u64" },
        { name: "expiry", type: "i64" },
        { name: "maintainer", type: "pubkey" },
        { name: "contributor", type: "pubkey" },
      ],
    },
    {
      name: "cancel",
      discriminator: discriminator("global", "cancel"),
      accounts: [
        { name: "sponsor", signer: true },
        { name: "escrow", writable: true },
      ],
      args: [],
    },
    {
      name: "fund_escrow",
      discriminator: discriminator("global", "fund_escrow"),
      accounts: [
        { name: "sponsor", writable: true, signer: true },
        { name: "mint" },
        { name: "sponsor_token", writable: true },
        { name: "escrow", writable: true },
        { name: "vault", writable: true },
        { name: "token_program", address: TOKEN_PROGRAM_ID.toBase58() },
      ],
      args: [],
    },
    {
      name: "release",
      discriminator: discriminator("global", "release"),
      accounts: [
        { name: "maintainer", signer: true },
        { name: "mint" },
        { name: "escrow", writable: true },
        { name: "vault", writable: true },
        { name: "contributor_token", writable: true },
        { name: "token_program", address: TOKEN_PROGRAM_ID.toBase58() },
      ],
      args: [],
    },
    {
      name: "refund",
      discriminator: discriminator("global", "refund"),
      accounts: [
        { name: "sponsor", signer: true },
        { name: "mint" },
        { name: "escrow", writable: true },
        { name: "vault", writable: true },
        { name: "sponsor_token", writable: true },
        { name: "token_program", address: TOKEN_PROGRAM_ID.toBase58() },
      ],
      args: [],
    },
  ],
  accounts: [
    {
      name: "Escrow",
      discriminator: discriminator("account", "Escrow"),
    },
  ],
  errors: [
    { code: 6000, name: "InvalidStatus", msg: "The escrow is not in the required state." },
    { code: 6001, name: "InvalidAmount", msg: "The escrow amount must be greater than zero." },
    { code: 6002, name: "InvalidExpiry", msg: "The escrow expiry must be in the future." },
    { code: 6003, name: "InvalidMaintainer", msg: "The maintainer public key must not be the default key." },
    { code: 6004, name: "InvalidContributor", msg: "The contributor public key must not be the default key." },
    { code: 6005, name: "InvalidContributorTokenOwner", msg: "The release destination must be owned by the configured contributor." },
    { code: 6006, name: "UnauthorizedSponsor", msg: "Only the recorded sponsor may perform this action." },
    { code: 6007, name: "EscrowExpired", msg: "The escrow has reached or passed its expiry." },
    { code: 6008, name: "EscrowNotExpired", msg: "The escrow has not reached its expiry." },
    { code: 6009, name: "InvalidVault", msg: "The provided vault does not match the vault recorded by the escrow." },
    { code: 6010, name: "InvalidExternalReference", msg: "The external reference hash must not be all zeros." },
  ],
  types: [
    {
      name: "Escrow",
      type: {
        kind: "struct",
        fields: [
          { name: "sponsor", type: "pubkey" },
          { name: "maintainer", type: "pubkey" },
          { name: "contributor", type: "pubkey" },
          { name: "mint", type: "pubkey" },
          { name: "vault", type: "pubkey" },
          { name: "external_ref_hash", type: { array: ["u8", 32] } },
          { name: "amount", type: "u64" },
          { name: "created_at", type: "i64" },
          { name: "expiry", type: "i64" },
          { name: "status", type: { defined: { name: "EscrowStatus" } } },
          { name: "bump", type: "u8" },
          { name: "vault_bump", type: "u8" },
        ],
      },
    },
    {
      name: "EscrowStatus",
      type: {
        kind: "enum",
        variants: [
          { name: "Initialized" },
          { name: "Funded" },
          { name: "Released" },
          { name: "Refunded" },
          { name: "Cancelled" },
        ],
      },
    },
  ],
};
