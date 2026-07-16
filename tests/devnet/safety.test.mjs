import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertAllowedRpcUrl,
  assertClassicTokenProgram,
  assertDevnetGenesis,
  assertSignerPathContained,
  sanitizePublicOutput,
  validatePublicConfig,
} from "../../scripts/devnet/safety.mjs";

const DEVNET_GENESIS =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const PROGRAM_ID = "11111111111111111111111111111111";

function validConfig() {
  return {
    schemaVersion: 1,
    cluster: {
      name: "devnet",
      rpcUrl: "https://api.devnet.solana.com",
      genesisHash: DEVNET_GENESIS,
    },
    programId: PROGRAM_ID,
    token: {
      programId: TOKEN_PROGRAM,
      displayLabel: "DEVTEST",
      decimals: 6,
    },
  };
}

test("accepts the exact public devnet RPC and genesis", () => {
  assert.equal(
    assertAllowedRpcUrl("https://api.devnet.solana.com", "devnet").href,
    "https://api.devnet.solana.com/",
  );
  assert.doesNotThrow(() =>
    assertDevnetGenesis(DEVNET_GENESIS, DEVNET_GENESIS),
  );
});

for (const unsafeUrl of [
  "mainnet-beta",
  "https://api.mainnet-beta.solana.com",
  "testnet",
  "https://api.testnet.solana.com",
  "https://rpc.example.com",
  "http://127.0.0.1:8899",
  "http://localhost:8899",
]) {
  test(`rejects unsafe devnet RPC ${unsafeUrl}`, () => {
    assert.throws(
      () => assertAllowedRpcUrl(unsafeUrl, "devnet"),
      /explicit Solana devnet RPC/,
    );
  });
}

test("allows localhost only in explicit local-test mode", () => {
  assert.equal(
    assertAllowedRpcUrl("http://127.0.0.1:8899", "local-test").hostname,
    "127.0.0.1",
  );
  assert.equal(
    assertAllowedRpcUrl("http://localhost:8899", "local-test").hostname,
    "localhost",
  );
});

test("rejects an incorrect genesis hash", () => {
  assert.throws(
    () => assertDevnetGenesis(`${DEVNET_GENESIS}x`, DEVNET_GENESIS),
    /genesis hash mismatch/,
  );
});

test("accepts classic SPL Token and rejects Token-2022", () => {
  assert.doesNotThrow(() => assertClassicTokenProgram(TOKEN_PROGRAM));
  assert.throws(
    () =>
      assertClassicTokenProgram(
        "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      ),
    /classic SPL Token Program/,
  );
});

test("validates the strict public DEVTEST configuration", () => {
  assert.deepEqual(validatePublicConfig(validConfig()), validConfig());

  assert.throws(
    () => validatePublicConfig({ ...validConfig(), credential: "forbidden" }),
    /unexpected config key/,
  );
  assert.throws(
    () =>
      validatePublicConfig({
        ...validConfig(),
        token: { ...validConfig().token, displayLabel: "USDC" },
      }),
    /DEVTEST/,
  );
  assert.throws(
    () =>
      validatePublicConfig({
        ...validConfig(),
        token: { ...validConfig().token, decimals: 9 },
      }),
    /six decimals/,
  );
});

test("contains signer paths under the .devnet path segment", () => {
  const root = mkdtempSync(join(tmpdir(), "devnet-safety-"));
  mkdirSync(join(root, ".devnet"));

  assert.equal(
    assertSignerPathContained(
      root,
      join(root, ".devnet", "sponsor.devnet-keypair.json"),
    ),
    join(root, ".devnet", "sponsor.devnet-keypair.json"),
  );
  assert.throws(
    () => assertSignerPathContained(root, join(root, "sponsor.json")),
    /must remain inside .devnet/,
  );
  assert.throws(
    () =>
      assertSignerPathContained(
        root,
        join(root, ".devnet-escape", "sponsor.json"),
      ),
    /must remain inside .devnet/,
  );
});

test("rejects a symlink that escapes .devnet", () => {
  const root = mkdtempSync(join(tmpdir(), "devnet-symlink-"));
  const outside = mkdtempSync(join(tmpdir(), "devnet-outside-"));
  mkdirSync(join(root, ".devnet"));
  symlinkSync(outside, join(root, ".devnet", "escape"), "junction");

  assert.throws(
    () =>
      assertSignerPathContained(
        root,
        join(root, ".devnet", "escape", "sponsor.json"),
      ),
    /symlink escapes .devnet/,
  );
});

test("sanitizes secret-bearing fields recursively", () => {
  assert.deepEqual(
    sanitizePublicOutput({
      publicKey: PROGRAM_ID,
      secretKey: [1, 2, 3],
      nested: {
        mnemonic: "not for logs",
        signature: "public-signature",
      },
    }),
    {
      publicKey: PROGRAM_ID,
      nested: {
        signature: "public-signature",
      },
    },
  );
});
