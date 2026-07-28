// Thin CLI for the governed devnet business-flow runner.
//
// Default action is read-only PLAN mode. There is no way to trigger a live write
// from this CLI without an explicit `execute` subcommand plus an authorization
// file; even then this enablement-phase CLI intentionally refuses to sign/send and
// directs the operator to the separately authorized live-acceptance session.

import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { Keypair as _Keypair } from "@solana/web3.js";

import { DEVNET_RPC_URL } from "./safety.mjs";
import { buildPlan } from "./business-flow-runner.mjs";
import { createProductionAdapter, loadSigners } from "./business-flow-adapter.mjs";
import { runAcceptanceMatrix } from "./business-flow-execution.mjs";

const ESCROW_ACCOUNT_BYTES = 227; // 8 discriminator + Escrow::INIT_SPACE(219)
const TOKEN_ACCOUNT_BYTES = 165;
const MINT_BYTES = 82;

// Read-only adapter: exposes ONLY read methods, so buildPlan's forbidden-method
// guard passes and no signing/sending surface exists.
function createReadOnlyAdapter(connection) {
  return {
    getGenesisHash: (...a) => connection.getGenesisHash(...a),
    getAccountInfo: (...a) => connection.getAccountInfo(...a),
    getBalance: (...a) => connection.getBalance(...a),
    getMinimumBalanceForRentExemption: (...a) =>
      connection.getMinimumBalanceForRentExemption(...a),
  };
}

function pubkeyFromKeypairFile(path) {
  // Reads only to derive the public key; secret bytes are never returned/printed.
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
  return Keypair.fromSecretKey(secret).publicKey.toBase58();
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0] ?? "plan";
  const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

  if (command === "execute") {
    // Live execute is fully implemented but strictly gated. It requires an
    // explicit plan file, authorization file, and the live acknowledgement flag.
    // Without the flag the CLI refuses, so no accidental devnet write can occur.
    const planPath = argv[argv.indexOf("--plan") + 1];
    const authPath = argv[argv.indexOf("--authorization") + 1];
    const live = argv.includes("--acknowledge-live-devnet-write");
    if (!argv.includes("--plan") || !argv.includes("--authorization")) {
      throw new Error("execute requires --plan <file> and --authorization <file>");
    }
    if (!live) {
      throw new Error(
        "EXECUTE_REQUIRES_LIVE_ACK: pass --acknowledge-live-devnet-write to perform the " +
          "authorized live acceptance matrix (this writes to devnet)",
      );
    }
    const plan = JSON.parse(readFileSync(resolve(planPath), "utf8"));
    const authorization = JSON.parse(readFileSync(resolve(authPath), "utf8"));
    const connection = new Connection(DEVNET_RPC_URL, { commitment: "confirmed" });
    const forbiddenAuthority = plan.upgradeAuthority;
    const signers = loadSigners(
      repoRoot,
      {
        sponsor: join(repoRoot, ".devnet", "sponsor.devnet-keypair.json"),
        maintainer: join(repoRoot, ".devnet", "maintainer.devnet-keypair.json"),
        contributor: join(repoRoot, ".devnet", "contributor.devnet-keypair.json"),
        mintAuthority: join(repoRoot, ".devnet", "mint-authority.devnet-keypair.json"),
      },
      forbiddenAuthority,
    );
    // Ephemeral mint keypair: transient signer, never persisted to tracked files.
    signers.mint = _Keypair.generate();
    signers.feePayer = signers.sponsor;
    const adapter = createProductionAdapter({ connection, repoRoot, signers });
    return runAcceptanceMatrix(plan, authorization, adapter);
  }
  if (command !== "plan") {
    throw new Error(`unknown command "${command}"; only read-only "plan" is supported here`);
  }

  const uniquenessToken =
    argv[argv.indexOf("--uniqueness") + 1] && argv.includes("--uniqueness")
      ? argv[argv.indexOf("--uniqueness") + 1]
      : new Date().toISOString();

  const connection = new Connection(DEVNET_RPC_URL, { commitment: "confirmed" });
  const rpc = createReadOnlyAdapter(connection);

  const identities = {
    sponsor: pubkeyFromKeypairFile(join(repoRoot, ".devnet", "sponsor.devnet-keypair.json")),
    maintainer: pubkeyFromKeypairFile(join(repoRoot, ".devnet", "maintainer.devnet-keypair.json")),
    contributor: pubkeyFromKeypairFile(join(repoRoot, ".devnet", "contributor.devnet-keypair.json")),
  };

  const rentReads = {
    mintRent: await connection.getMinimumBalanceForRentExemption(MINT_BYTES),
    tokenAccountRent: await connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_BYTES),
    escrowRent: await connection.getMinimumBalanceForRentExemption(ESCROW_ACCOUNT_BYTES),
  };

  return buildPlan(
    {
      rpcUrl: DEVNET_RPC_URL,
      expectedProgramId: "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z",
      identities,
      flows: ["release", "refund", "cancel"],
      uniquenessToken,
      rentReads,
    },
    rpc,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const report = await main();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
