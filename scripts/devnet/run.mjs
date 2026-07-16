import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  backupState,
  createInitialState,
  loadState,
  saveStateAtomic,
} from "./state.mjs";
import {
  assertAllowedRpcUrl,
  assertSignerPathContained,
  validatePublicConfig,
} from "./safety.mjs";
import { readCanonicalProgramPubkey } from "./program-identity.mjs";

const ACTOR_FILES = {
  deploymentAuthority: "deployment-authority.devnet-keypair.json",
  sponsor: "sponsor.devnet-keypair.json",
  maintainer: "maintainer.devnet-keypair.json",
  contributor: "contributor.devnet-keypair.json",
  mintAuthority: "mint-authority.devnet-keypair.json",
};

const SUPPORTED_COMMANDS = new Set(["init-identities"]);

export function assertSupportedCommand(command) {
  if (!SUPPORTED_COMMANDS.has(command)) {
    throw new Error(
      `command ${command ?? "<missing>"} is not implemented in this checkpoint; no devnet action was performed`,
    );
  }
  return command;
}

function defaultKeygen() {
  return {
    create(path) {
      execFileSync(
        "solana-keygen",
        [
          "new",
          "--silent",
          "--no-bip39-passphrase",
          "--outfile",
          path,
        ],
        { stdio: "ignore" },
      );
      return this.publicKey(path);
    },
    publicKey(path) {
      return execFileSync("solana-keygen", ["pubkey", path], {
        encoding: "utf8",
      }).trim();
    },
  };
}

function trackedIgnoreCheck(repoRoot, candidate) {
  try {
    const output = execFileSync(
      "git",
      ["check-ignore", "-v", "--no-index", candidate],
      { cwd: repoRoot, encoding: "utf8" },
    );
    return output.startsWith(".gitignore:");
  } catch {
    return false;
  }
}

export function initializeIdentities({
  repoRoot,
  devnetDir,
  state,
  programId,
  keygen = defaultKeygen(),
  isTrackedIgnored = trackedIgnoreCheck,
  logger = console.log,
}) {
  const programPath = assertSignerPathContained(
    repoRoot,
    join(devnetDir, "program.devnet-keypair.json"),
  );
  if (!isTrackedIgnored(repoRoot, programPath)) {
    throw new Error("tracked .gitignore protection is required before keys");
  }
  if (!existsSync(programPath)) {
    throw new Error("canonical program keypair does not exist");
  }
  const observedProgramId = readCanonicalProgramPubkey(programPath);
  if (observedProgramId !== programId) {
    throw new Error(
      `canonical program ID mismatch: ${observedProgramId} != ${programId}`,
    );
  }

  mkdirSync(devnetDir, { recursive: true });
  const next = structuredClone(state);
  next.identities.program = programId;

  for (const [role, filename] of Object.entries(ACTOR_FILES)) {
    const path = assertSignerPathContained(repoRoot, join(devnetDir, filename));
    if (!isTrackedIgnored(repoRoot, path)) {
      throw new Error(
        `tracked .gitignore protection is required for ${role}`,
      );
    }
    const publicKey = existsSync(path)
      ? keygen.publicKey(path)
      : keygen.create(path);
    next.identities[role] = publicKey;
  }

  logger({ identities: structuredClone(next.identities) });
  return next;
}

function parseArgs(argv) {
  const values = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(`invalid argument ${arg}`);
    }
    values[arg.slice(2)] = argv[index + 1];
    index += 1;
  }
  return values;
}

function timestampForPath() {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "Z");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  assertSupportedCommand(args.command);
  assertAllowedRpcUrl(args.rpc, "devnet");

  const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const config = validatePublicConfig(
    JSON.parse(readFileSync(join(repoRoot, "config", "devnet.json"), "utf8")),
  );
  const devnetDir = join(repoRoot, ".devnet");
  const statePath = join(devnetDir, "state.json");
  const state = existsSync(statePath)
    ? loadState(statePath)
    : createInitialState(
        config,
        execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: repoRoot,
          encoding: "utf8",
        }).trim(),
      );

  const next = initializeIdentities({
    repoRoot,
    devnetDir,
    state,
    programId: config.programId,
  });
  if (existsSync(statePath)) {
    backupState(
      statePath,
      join(devnetDir, "history"),
      timestampForPath(),
    );
  }
  saveStateAtomic(statePath, next);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
