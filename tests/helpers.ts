import { createHash } from "node:crypto";

import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z",
);

export function externalRefHash(reference: string): number[] {
  return [...createHash("sha256").update(reference).digest()];
}

export function deriveEscrowPda(
  sponsor: PublicKey,
  referenceHash: number[],
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), sponsor.toBuffer(), Buffer.from(referenceHash)],
    PROGRAM_ID,
  )[0];
}

export function deriveVaultPda(escrow: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), escrow.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export async function fundActor(
  provider: AnchorProvider,
  recipient: PublicKey,
): Promise<void> {
  await provider.sendAndConfirm(
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: recipient,
        lamports: LAMPORTS_PER_SOL,
      }),
    ),
  );
}

export async function unixTimestamp(provider: AnchorProvider): Promise<number> {
  const slot = await provider.connection.getSlot();
  const blockTime = await provider.connection.getBlockTime(slot);
  if (blockTime === null) {
    throw new Error("local validator did not return a block time");
  }
  return blockTime;
}

export async function waitUntilTimestamp(
  provider: AnchorProvider,
  target: number,
): Promise<void> {
  for (;;) {
    if ((await unixTimestamp(provider)) >= target) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export async function expectRejected(
  operation: Promise<unknown>,
  expectedText: string,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    const message = String(error);
    if (!message.includes(expectedText)) {
      throw new Error(`expected "${expectedText}" in "${message}"`);
    }
    return;
  }
  throw new Error(`expected rejection containing "${expectedText}"`);
}

export type EscrowProgram = Program;

export function bn(value: number | bigint): BN {
  return new BN(value.toString());
}

export function newActor(): Keypair {
  return Keypair.generate();
}
