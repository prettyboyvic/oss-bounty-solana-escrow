import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Keypair, SystemProgram } from "@solana/web3.js";

const repo = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(repo, ".tmp");
const outputPath = resolve(outputDirectory, "test-payer-account.json");
const walletPath = resolve(outputDirectory, "anchor-test-wallet.json");
const payer = Keypair.fromSeed(
  Uint8Array.from({ length: 32 }, (_, index) => index + 1),
);

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  outputPath,
  JSON.stringify({
    pubkey: payer.publicKey.toBase58(),
    account: {
      lamports: 100_000_000_000,
      data: ["", "base64"],
      owner: SystemProgram.programId.toBase58(),
      executable: false,
      rentEpoch: 0,
    },
  }),
);
writeFileSync(walletPath, JSON.stringify([...payer.secretKey]));

process.stdout.write(payer.publicKey.toBase58());
