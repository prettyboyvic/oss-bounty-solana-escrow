import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Keypair } from "@solana/web3.js";

import {
  extractProgramIdentitySources,
  parseIdlBuildAddress,
  readCanonicalProgramPubkey,
  verifyProgramIdentity,
} from "../../scripts/devnet/program-identity.mjs";

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function fixture(programId) {
  const root = mkdtempSync(join(tmpdir(), "program-identity-"));
  write(
    join(root, "config", "devnet.json"),
    JSON.stringify({ programId }),
  );
  write(
    join(root, "programs", "oss-bounty-escrow", "src", "lib.rs"),
    `declare_id!("${programId}");\n`,
  );
  write(
    join(root, "Anchor.toml"),
    `[programs.localnet]\noss_bounty_escrow = "${programId}"\n\n` +
      `[programs.devnet]\noss_bounty_escrow = "${programId}"\n\n` +
      `[[test.genesis]]\naddress = "${programId}"\n` +
      `program = "target/deploy/oss_bounty_escrow.so"\n` +
      `upgradeable = false\n`,
  );
  write(
    join(root, "tests", "helpers.ts"),
    `export const PROGRAM_ID = new PublicKey("${programId}");\n`,
  );
  write(
    join(root, "scripts", "test-local.ps1"),
    `$programId = "${programId}"\n`,
  );
  return root;
}

test("derives only the public key from a keypair file", () => {
  const root = mkdtempSync(join(tmpdir(), "program-keypair-"));
  const keypair = Keypair.generate();
  const path = join(root, "program.devnet-keypair.json");
  writeFileSync(path, JSON.stringify([...keypair.secretKey]));

  const result = readCanonicalProgramPubkey(path);

  assert.equal(result, keypair.publicKey.toBase58());
  assert.equal(typeof result, "string");
  assert.equal(JSON.stringify(result).includes("secretKey"), false);
});

test("extracts matching public program IDs from repository fixtures", () => {
  const programId = Keypair.generate().publicKey.toBase58();
  const root = fixture(programId);
  const sources = extractProgramIdentitySources(root, {
    generatedIdlAddress: programId,
  });

  assert.deepEqual(verifyProgramIdentity(programId, sources), {
    programId,
    checks: {
      config: true,
      rust: true,
      anchorLocalnet: true,
      anchorDevnet: true,
      anchorGenesis: true,
      client: true,
      runner: true,
      generatedIdl: true,
    },
  });
});

for (const [name, mutate] of [
  [
    "Rust declare_id",
    (root, other) =>
      write(
        join(root, "programs", "oss-bounty-escrow", "src", "lib.rs"),
        `declare_id!("${other}");\n`,
      ),
  ],
  [
    "Anchor localnet",
    (root, other) => {
      const expected = JSON.parse(
        requireText(join(root, "config", "devnet.json")),
      ).programId;
      write(
        join(root, "Anchor.toml"),
        `[programs.localnet]\noss_bounty_escrow = "${other}"\n\n` +
          `[programs.devnet]\noss_bounty_escrow = "${expected}"\n\n` +
          `[[test.genesis]]\naddress = "${expected}"\n` +
          `program = "target/deploy/oss_bounty_escrow.so"\n` +
          `upgradeable = false\n`,
      );
    },
  ],
  [
    "test client",
    (root, other) =>
      write(
        join(root, "tests", "helpers.ts"),
        `export const PROGRAM_ID = new PublicKey("${other}");\n`,
      ),
  ],
  [
    "local runner",
    (root, other) =>
      write(
        join(root, "scripts", "test-local.ps1"),
        `$programId = "${other}"\n`,
      ),
  ],
]) {
  test(`detects ${name} mismatch`, () => {
    const programId = Keypair.generate().publicKey.toBase58();
    const other = Keypair.generate().publicKey.toBase58();
    const root = fixture(programId);
    mutate(root, other);

    const sources = extractProgramIdentitySources(root, {
      generatedIdlAddress: programId,
    });

    assert.throws(
      () => verifyProgramIdentity(programId, sources),
      /program ID mismatch/,
    );
  });
}

function requireText(path) {
  return readFileSync(path, "utf8");
}

test("extracts one address from Anchor idl-build output", () => {
  const programId = Keypair.generate().publicKey.toBase58();
  const output = [
    "running 1 test",
    "--- IDL begin address ---",
    programId,
    "--- IDL end address ---",
    "test result: ok. 1 passed; 0 failed",
  ].join("\n");

  assert.equal(parseIdlBuildAddress(output), programId);
});

test("extracts the JSON-escaped address emitted by Anchor 0.31.1", () => {
  const programId = Keypair.generate().publicKey.toBase58();
  const output = [
    "---- __anchor_private_print_idl_address stdout ----",
    "--- IDL begin address ---",
    JSON.stringify(JSON.stringify(programId)),
    "--- IDL end address ---",
  ].join("\n");

  assert.equal(parseIdlBuildAddress(output), programId);
});

test("rejects missing or duplicate IDL address sections", () => {
  const programId = Keypair.generate().publicKey.toBase58();
  assert.throws(() => parseIdlBuildAddress("no idl"), /exactly one IDL address/);
  assert.throws(
    () =>
      parseIdlBuildAddress(
        [
          "--- IDL begin address ---",
          programId,
          "--- IDL end address ---",
          "--- IDL begin address ---",
          programId,
          "--- IDL end address ---",
        ].join("\n"),
      ),
    /exactly one IDL address/,
  );
});

test("repository layout uses the canonical ID without a deterministic program fixture", () => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const config = JSON.parse(
    readFileSync(join(repoRoot, "config", "devnet.json"), "utf8"),
  );
  const sources = extractProgramIdentitySources(repoRoot);
  const result = verifyProgramIdentity(config.programId, sources);
  const anchor = readFileSync(join(repoRoot, "Anchor.toml"), "utf8");
  const workflow = readFileSync(
    join(repoRoot, ".github", "workflows", "ci.yml"),
    "utf8",
  );

  assert.equal(result.checks.generatedIdl, null);
  assert.match(
    anchor,
    /\[\[test\.genesis\]\][\s\S]*upgradeable\s*=\s*false/,
  );
  assert.doesNotMatch(workflow, /create-test-program-keypair/);
  assert.match(workflow, /target\/idl\/oss_bounty_escrow\.json/);
  assert.match(workflow, /anchor test --skip-build(?:\s|$)/);
  assert.doesNotMatch(workflow, /anchor test[^\r\n]*--skip-deploy/);
  assert.equal(
    existsSync(join(repoRoot, "scripts", "create-test-program-keypair.mjs")),
    false,
  );
});
