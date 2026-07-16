import {
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair } from "@solana/web3.js";

function readText(path) {
  return readFileSync(path, "utf8");
}

function matchOne(text, pattern, label) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${label}, found ${matches.length}`);
  }
  return matches[0][1];
}

function anchorSectionValue(anchor, section) {
  const escaped = section.replaceAll(".", "\\.");
  return matchOne(
    anchor,
    new RegExp(
      `\\[${escaped}\\][\\s\\S]*?oss_bounty_escrow\\s*=\\s*"([^"]+)"`,
      "g",
    ),
    `${section} program ID`,
  );
}

function anchorGenesisValue(anchor) {
  const blocks = anchor.split("[[test.genesis]]").slice(1);
  const matches = blocks
    .map((block) => {
      const address = block.match(/\baddress\s*=\s*"([^"]+)"/)?.[1];
      const program = block.match(/\bprogram\s*=\s*"([^"]+)"/)?.[1];
      return program === "target/deploy/oss_bounty_escrow.so"
        ? address
        : undefined;
    })
    .filter(Boolean);
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one escrow test.genesis address, found ${matches.length}`,
    );
  }
  return matches[0];
}

export function readCanonicalProgramPubkey(keypairPath) {
  const value = JSON.parse(readText(keypairPath));
  if (
    !Array.isArray(value) ||
    value.length !== 64 ||
    value.some(
      (item) => !Number.isInteger(item) || item < 0 || item > 255,
    )
  ) {
    throw new Error("canonical program keypair must contain 64 bytes");
  }
  return Keypair.fromSecretKey(Uint8Array.from(value)).publicKey.toBase58();
}

export function parseIdlBuildAddress(output) {
  const sections = [
    ...output.matchAll(
      /--- IDL begin address ---([\s\S]*?)--- IDL end address ---/g,
    ),
  ];
  if (sections.length !== 1) {
    throw new Error(
      `expected exactly one IDL address, found ${sections.length}`,
    );
  }
  const addresses = sections[0][1].match(
    /[1-9A-HJ-NP-Za-km-z]{32,44}/g,
  );
  if (!addresses || addresses.length !== 1) {
    throw new Error(
      `expected exactly one IDL address, found ${addresses?.length ?? 0}`,
    );
  }
  return addresses[0];
}

export function extractProgramIdentitySources(
  repoRoot,
  { generatedIdlAddress = null } = {},
) {
  const root = resolve(repoRoot);
  const config = JSON.parse(readText(resolve(root, "config", "devnet.json")));
  const rust = readText(
    resolve(
      root,
      "programs",
      "oss-bounty-escrow",
      "src",
      "lib.rs",
    ),
  );
  const anchor = readText(resolve(root, "Anchor.toml"));
  const client = readText(resolve(root, "tests", "helpers.ts"));
  const runner = readText(resolve(root, "scripts", "test-local.ps1"));

  return {
    config: config.programId,
    rust: matchOne(
      rust,
      /declare_id!\("([^"]+)"\)/g,
      "Rust declare_id",
    ),
    anchorLocalnet: anchorSectionValue(anchor, "programs.localnet"),
    anchorDevnet: anchorSectionValue(anchor, "programs.devnet"),
    anchorGenesis: anchorGenesisValue(anchor),
    client: matchOne(
      client,
      /PROGRAM_ID\s*=\s*new PublicKey\(\s*"([^"]+)"/g,
      "test client program ID",
    ),
    runner: matchOne(
      runner,
      /\$programId\s*=\s*"([^"]+)"/g,
      "local runner program ID",
    ),
    generatedIdl: generatedIdlAddress,
  };
}

export function verifyProgramIdentity(expected, sources) {
  const checks = Object.fromEntries(
    Object.entries(sources).map(([name, value]) => [
      name,
      value === null ? null : value === expected,
    ]),
  );
  const mismatches = Object.entries(checks)
    .filter(([, matches]) => matches === false)
    .map(([name]) => name);
  if (mismatches.length) {
    throw new Error(
      `program ID mismatch in: ${mismatches.join(", ")}`,
    );
  }
  return { programId: expected, checks };
}

function parseArgs(argv) {
  const values = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skip-generated-idl") {
      values.skipGeneratedIdl = true;
      continue;
    }
    if (!arg.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(`invalid argument ${arg}`);
    }
    values[arg.slice(2)] = argv[index + 1];
    index += 1;
  }
  return values;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command !== "verify" || !args["program-keypair"]) {
    throw new Error(
      "usage: program-identity.mjs verify --program-keypair <ignored path> [--skip-generated-idl]",
    );
  }
  const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const expected = readCanonicalProgramPubkey(
    resolve(repoRoot, args["program-keypair"]),
  );
  const sources = extractProgramIdentitySources(repoRoot, {
    generatedIdlAddress: args.skipGeneratedIdl
      ? null
      : args["generated-idl-address"],
  });
  process.stdout.write(
    `${JSON.stringify(verifyProgramIdentity(expected, sources), null, 2)}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
