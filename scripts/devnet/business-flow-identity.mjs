import { createHash } from "node:crypto";

import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export const BUSINESS_FLOW_EXECUTION_ID_PATTERN =
  /^[a-z0-9][a-z0-9-]{0,63}$/;

export const BUSINESS_FLOW_MINT_ALGORITHM =
  "SOLANA_CREATE_WITH_SEED_SHA256_V1";
export const BUSINESS_FLOW_MINT_DOMAIN = "R4_BUSINESS_FLOW_MINT_V2";

function canonicalPublicKey(value, label) {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${label} must be a valid Solana public key`);
  }
}

export function assertBusinessFlowExecutionId(value) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") !== value.length ||
    !BUSINESS_FLOW_EXECUTION_ID_PATTERN.test(value)
  ) {
    throw new Error(
      "Phase-4B manifest-v2 business-flow execution ID must match " +
        "^[a-z0-9][a-z0-9-]{0,63}$",
    );
  }
  return value;
}

export async function deriveBusinessFlowMint({
  executionId,
  genesisHash,
  programId,
  sponsorBase,
}) {
  const canonicalExecutionId = assertBusinessFlowExecutionId(executionId);
  if (typeof genesisHash !== "string" || genesisHash.length === 0) {
    throw new Error("genesisHash must be a non-empty string");
  }
  const canonicalProgram = canonicalPublicKey(programId, "programId");
  const canonicalSponsor = canonicalPublicKey(sponsorBase, "sponsorBase");
  const tokenProgram = TOKEN_PROGRAM_ID;
  const digestInput = [
    BUSINESS_FLOW_MINT_DOMAIN,
    genesisHash,
    canonicalProgram.toBase58(),
    canonicalExecutionId,
    canonicalSponsor.toBase58(),
    tokenProgram.toBase58(),
  ].join("\0");
  const digest = createHash("sha256")
    .update(Buffer.from(digestInput, "utf8"))
    .digest("hex");
  const seed = `bfm2-${digest.slice(0, 27)}`;
  if (
    !/^bfm2-[0-9a-f]{27}$/.test(seed) ||
    Buffer.byteLength(seed, "utf8") !== 32
  ) {
    throw new Error("derived business-flow mint seed is not canonical");
  }
  const mint = await PublicKey.createWithSeed(
    canonicalSponsor,
    seed,
    tokenProgram,
  );

  return Object.freeze({
    algorithm: BUSINESS_FLOW_MINT_ALGORITHM,
    domain: BUSINESS_FLOW_MINT_DOMAIN,
    encoding: "UTF-8",
    executionId: canonicalExecutionId,
    genesisHash,
    programId: canonicalProgram.toBase58(),
    sponsorBase: canonicalSponsor.toBase58(),
    tokenProgram: tokenProgram.toBase58(),
    seed,
    mint: mint.toBase58(),
  });
}
