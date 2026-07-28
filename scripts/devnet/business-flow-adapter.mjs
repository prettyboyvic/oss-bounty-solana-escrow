// Concrete production execution adapter for the devnet business-flow runner.
//
// It wraps a Solana Connection and an explicit, devnet-only keypair map. It never
// touches the deployment/upgrade authority, never requests an airdrop, never
// auto-funds or auto-closes accounts, and never changes upgrade authority or the
// program. Secret bytes never enter logs or receipts (only public keys and
// sanitized metadata are recorded).
//
// This adapter is constructed only by the CLI execute path; it is never invoked
// against live devnet in the enablement/repair phases or in CI (tests use a fake
// connection object).

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";

import { writeCanonicalJsonAtomic } from "./durable-json.mjs";
import { assertSignerPathContained, sanitizePublicOutput } from "./safety.mjs";

export const RECEIPT_DIRNAME = ".devnet/business-flow-receipts";

function loadKeypairContained(repoRoot, path) {
  const contained = assertSignerPathContained(repoRoot, path);
  // Read only to construct the signer; secret bytes never leave this scope.
  const secret = Uint8Array.from(JSON.parse(readFileSync(contained, "utf8")));
  return Keypair.fromSecretKey(secret);
}

// Build a signer registry from explicit contained keypair paths, asserting none
// equals the forbidden (deployment/upgrade) authority.
export function loadSigners(repoRoot, keypairPaths, forbiddenAuthority) {
  const signers = {};
  for (const [role, path] of Object.entries(keypairPaths)) {
    const kp = loadKeypairContained(repoRoot, path);
    if (kp.publicKey.toBase58() === String(forbiddenAuthority)) {
      throw new Error(`${role} keypair must not be the deployment/upgrade authority`);
    }
    signers[role] = kp;
  }
  return signers;
}

export function createProductionAdapter({
  connection,
  repoRoot,
  signers, // { sponsor, maintainer, contributor, mintAuthority, feePayer, mint? }
  receiptDir = join(repoRoot ?? ".", RECEIPT_DIRNAME),
}) {
  if (!connection) throw new Error("a Solana connection is required");
  if (!signers || typeof signers !== "object") throw new Error("a signer registry is required");
  // Deliberately no airdrop / auto-fund / close-account surface exists here.

  return {
    receiptDir,
    signerPublicKeys: Object.fromEntries(
      Object.entries(signers).map(([role, kp]) => [role, kp.publicKey.toBase58()]),
    ),

    async readAccount(address) {
      return connection.getAccountInfo(new PublicKey(address), "confirmed");
    },

    async readBalance(address) {
      return connection.getBalance(new PublicKey(address), "confirmed");
    },

    async getLatestBlockhash() {
      return connection.getLatestBlockhash("confirmed");
    },

    async getChainTime() {
      const slot = await connection.getSlot("confirmed");
      const time = await connection.getBlockTime(slot);
      if (time === null || time === undefined) throw new Error("authoritative chain time is unavailable");
      return time;
    },

    // Build + sign; returns the serialized wire transaction and its message. No send.
    async buildSigned({ instructions, feePayerRole, signerRoles }) {
      const feePayer = signers[feePayerRole];
      if (!feePayer) throw new Error(`unknown fee-payer role "${feePayerRole}"`);
      const tx = new Transaction();
      for (const ix of instructions) tx.add(ix);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = feePayer.publicKey;
      const signerSet = [feePayer, ...signerRoles.map((r) => {
        if (!signers[r]) throw new Error(`unknown signer role "${r}"`);
        return signers[r];
      })];
      // Deduplicate by public key while preserving order.
      const seen = new Set();
      const uniqueSigners = signerSet.filter((kp) => {
        const k = kp.publicKey.toBase58();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      tx.sign(...uniqueSigners);
      return { transaction: tx, serialized: tx.serialize(), blockhash, lastValidBlockHeight };
    },

    // Read-only simulation: never sends. Signing is required only so the message
    // is well-formed; the transaction is passed to simulateTransaction, not send.
    async simulate({ instructions, feePayerRole, signerRoles }) {
      const { transaction } = await this.buildSigned({ instructions, feePayerRole, signerRoles });
      const result = await connection.simulateTransaction(transaction, undefined, false);
      return sanitizePublicOutput({
        err: result.value.err ?? null,
        logs: result.value.logs ?? [],
        unitsConsumed: result.value.unitsConsumed ?? null,
      });
    },

    async send({ instructions, feePayerRole, signerRoles }) {
      const { serialized, blockhash, lastValidBlockHeight } = await this.buildSigned({
        instructions,
        feePayerRole,
        signerRoles,
      });
      const signature = await connection.sendRawTransaction(serialized, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      return { signature, blockhash, lastValidBlockHeight };
    },

    async confirm({ signature, blockhash, lastValidBlockHeight }) {
      return connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
      );
    },

    async signatureStatus(signature) {
      const res = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
      return res.value ?? null;
    },

    // Atomic canonical receipt. Only sanitized public content is written.
    writeReceipt(fileName, value) {
      mkdirSync(receiptDir, { recursive: true });
      writeCanonicalJsonAtomic(join(receiptDir, fileName), sanitizePublicOutput(value));
    },
  };
}
