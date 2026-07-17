import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  backupState,
  configureDeploymentBuffer,
  createInitialState,
  migrateStateFile,
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

const SUPPORTED_COMMANDS = new Set(["init-identities", "prepare-buffer"]);
const BUFFER_METADATA_LENGTH = 37;

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

export function initializeDeploymentBuffer({
  repoRoot,
  devnetDir,
  state,
  authorityPublicKey,
  binaryLength,
  binarySha256,
  keygen = defaultKeygen(),
  isTrackedIgnored = trackedIgnoreCheck,
  logger = console.log,
}) {
  const signerPath = assertSignerPathContained(
    repoRoot,
    join(devnetDir, "deploy-buffer.devnet-keypair.json"),
  );
  if (!isTrackedIgnored(repoRoot, signerPath)) {
    throw new Error(
      "tracked .gitignore protection is required before buffer key creation",
    );
  }
  if (!authorityPublicKey) {
    throw new Error("public deployment authority is required");
  }
  if (!Number.isInteger(binaryLength) || binaryLength <= 0 || !binarySha256) {
    throw new Error("verified local binary evidence is required");
  }

  const publicKey = existsSync(signerPath)
    ? keygen.publicKey(signerPath)
    : keygen.create(signerPath);
  const allocatedLength = binaryLength + BUFFER_METADATA_LENGTH;
  const recorded = state.deployment?.buffer;
  if (recorded) {
    if (recorded.publicKey !== publicKey) {
      throw new Error("buffer public key mismatch with preserved state");
    }
    if (
      recorded.expectedOwner !== "BPFLoaderUpgradeab1e11111111111111111111111" ||
      recorded.expectedAuthority !== authorityPublicKey ||
      recorded.allocatedLength !== allocatedLength ||
      recorded.localBinary?.length !== binaryLength ||
      recorded.localBinary?.sha256 !== binarySha256
    ) {
      throw new Error("preserved buffer metadata mismatch");
    }
    logger({ buffer: { publicKey, status: recorded.status } });
    return structuredClone(state);
  }

  const next = configureDeploymentBuffer(state, {
    publicKey,
    expectedOwner: "BPFLoaderUpgradeab1e11111111111111111111111",
    expectedAuthority: authorityPublicKey,
    allocatedLength,
    localBinaryLength: binaryLength,
    localBinarySha256: binarySha256,
  });
  logger({ buffer: { publicKey, status: next.deployment.buffer.status } });
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
    ? migrateStateFile(
        statePath,
        join(devnetDir, "history"),
        timestampForPath(),
      ).state
    : createInitialState(
        config,
        execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: repoRoot,
          encoding: "utf8",
        }).trim(),
      );

  let next;
  if (args.command === "init-identities") {
    next = initializeIdentities({
      repoRoot,
      devnetDir,
      state,
      programId: config.programId,
    });
  } else {
    const binaryPath = join(
      repoRoot,
      "target",
      "sbf-solana-solana",
      "release",
      "oss_bounty_escrow.so",
    );
    if (!existsSync(binaryPath)) {
      throw new Error("optimized SBF binary is required before buffer preparation");
    }
    const binary = readFileSync(binaryPath);
    next = initializeDeploymentBuffer({
      repoRoot,
      devnetDir,
      state,
      authorityPublicKey: state.identities.deploymentAuthority,
      binaryLength: statSync(binaryPath).size,
      binarySha256: createHash("sha256").update(binary).digest("hex"),
    });
  }
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
