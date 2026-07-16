import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Keypair } from "@solana/web3.js";

const repo = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(repo, "target", "deploy");
const outputPath = resolve(
  outputDirectory,
  "oss_bounty_escrow-keypair.json",
);
const seed = createHash("sha256")
  .update("oss-bounty-solana-escrow-program-v1")
  .digest();
const program = Keypair.fromSeed(seed);

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputPath, JSON.stringify([...program.secretKey]));
process.stdout.write(program.publicKey.toBase58());
