import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ENTRY = fileURLToPath(new URL("../../scripts/devnet/plan-upload-cli.mjs", import.meta.url));

test("importing plan-upload modules has no RPC or filesystem side effects", () => {
  const cwd = mkdtempSync(join(tmpdir(), "plan-upload-import-"));
  try {
    const before = readdirSync(cwd);
    const entry = new URL("../../scripts/devnet/plan-upload-cli.mjs", import.meta.url);
    const uploader = new URL("../../scripts/devnet/throttled-uploader.mjs", import.meta.url);
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(entry.href)}); await import(${JSON.stringify(uploader.href)})`], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(cwd), before);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("live upload command is hard-disabled before signer, blockhash or send with no env or flag bypass", () => {
  const result = spawnSync(process.execPath, [ENTRY, "upload-buffer", "--rpc", "https://api.devnet.solana.com", "--keypair", "C:\\secret\\authority.json", "--enable-live", "true"], {
    encoding: "utf8",
    env: { ...process.env, ENABLE_LIVE_UPLOAD: "1", NODE_ENV: "test" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /LIVE_UPLOAD_HARD_DISABLED/);
  assert.doesNotMatch(result.stderr, /C:\\secret|authority\.json/);
  assert.equal(result.stdout, "");
});

test("plan-upload CLI rejects missing RPC without global Solana config fallback", () => {
  const result = spawnSync(process.execPath, [ENTRY, "plan-upload"], { encoding: "utf8", env: { ...process.env, SOLANA_CONFIG_FILE: "C:\\secret\\config.yml" } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /explicit Solana devnet RPC URL/);
  assert.doesNotMatch(result.stderr, /config\.yml|C:\\secret/);
  assert.equal(result.stdout, "");
});
