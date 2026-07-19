import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { main, sanitizeCliErrorMessage } from "../../scripts/devnet/upload-buffer-cli.mjs";

test("importing the public live CLI has no filesystem, RPC or process side effects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "upload-cli-import-"));
  try {
    const before = readdirSync(dir);
    await import("../../scripts/devnet/upload-buffer-cli.mjs");
    assert.deepEqual(readdirSync(dir), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing acknowledgement fails before config, signer, blockhash or send access", async () => {
  const calls = [];
  const dependencies = new Proxy({}, {
    get(_target, property) {
      if (property === "repoRoot") return "D:/repo";
      return (...args) => {
        calls.push([property, args]);
        throw new Error(`forbidden dependency ${String(property)}`);
      };
    },
  });
  await assert.rejects(
    main([
      "upload-buffer-throttled",
      "--url", "https://api.devnet.solana.com",
      "--program", "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z",
      "--buffer", "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW",
      "--state", ".devnet/state.json",
      "--authority", ".devnet/authority.json",
      "--max-chunks", "5",
      "--delay-ms", "1000",
    ], dependencies),
    /acknowledgement/,
  );
  assert.deepEqual(calls, []);
});

test("environment variables and global Solana paths cannot enable or fill live arguments", async () => {
  const prior = { ...process.env };
  process.env.ENABLE_LIVE_UPLOAD = "1";
  process.env.SOLANA_CONFIG_FILE = "C:\\secret\\config.yml";
  try {
    await assert.rejects(main(["upload-buffer-throttled"], {}), /required/);
  } finally {
    process.env = prior;
  }
});

test("public command dispatch preserves read-only and local-only authority boundaries", async () => {
  const calls = [];
  const common = {
    repoRoot: "D:/repo",
    isIgnoredPath: () => true,
    inspectStateMigration: async (request) => { calls.push(["inspect", request.command]); return { stateMutation: false }; },
    migrateStateV3: async (request) => { calls.push(["migrate", request.command]); return { stateMutation: true }; },
    reconcileUploadLease: async (request) => { calls.push(["reconcile", request.command]); return { stateMutation: false, onchainWrite: false }; },
    releaseUploadLease: async (request) => { calls.push(["release", request.command]); return { stateMutation: true, onchainWrite: false }; },
  };
  await main(["inspect-state-migration", "--state", ".devnet/state.json", "--binary", "target/program.so"], common);
  await main(["migrate-state-v3", "--state", ".devnet/state.json", "--binary", "target/program.so", "--acknowledge-state-migration", "R4_MIGRATE_STATE_V3"], common);
  await main(["reconcile-upload-lease", "--url", "https://api.devnet.solana.com", "--program", "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z", "--buffer", "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW", "--state", ".devnet/state.json", "--execution-id", "execution-1"], common);
  await main(["release-upload-lease", "--url", "https://api.devnet.solana.com", "--program", "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z", "--buffer", "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW", "--state", ".devnet/state.json", "--execution-id", "execution-1", "--reconciliation-hash", "a".repeat(64), "--acknowledge-lease-release", "R4_RELEASE_UPLOAD_LEASE"], common);
  assert.deepEqual(calls, [
    ["inspect", "inspect-state-migration"],
    ["migrate", "migrate-state-v3"],
    ["reconcile", "reconcile-upload-lease"],
    ["release", "release-upload-lease"],
  ]);
});

test("CLI errors never echo RPC credentials, secret paths or private-key arrays", () => {
  for (const unsafe of [
    "RPC failed at https://user:password@example.invalid",
    "cannot read C:\\secret\\authority-keypair.json",
    `invalid private key [${Array.from({ length: 64 }, (_, index) => index).join(",")}]`,
  ]) {
    assert.equal(sanitizeCliErrorMessage(new Error(unsafe)), "COMMAND_FAILED_SAFE");
  }
  assert.equal(sanitizeCliErrorMessage(new Error("explicit acknowledgement is required")), "explicit acknowledgement is required");
});
