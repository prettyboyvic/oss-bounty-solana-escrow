import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Keypair } from "@solana/web3.js";

import {
  assertSupportedCommand,
  initializeIdentities,
} from "../../scripts/devnet/run.mjs";
import {
  backupState,
  createInitialState,
  decideNextStep,
  loadState,
  migrateState,
  saveStateAtomic,
} from "../../scripts/devnet/state.mjs";

const CONFIG = {
  schemaVersion: 1,
  cluster: {
    name: "devnet",
    rpcUrl: "https://api.devnet.solana.com",
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  },
  programId: "11111111111111111111111111111111",
  token: {
    programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    displayLabel: "DEVTEST",
    decimals: 6,
  },
};

test("creates schemaVersion 1 without secret paths", () => {
  const state = createInitialState(CONFIG, "abc123");
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.source.commit, "abc123");
  assert.deepEqual(state.flows, { release: {}, refund: {} });
  assert.equal(JSON.stringify(state).includes("keypair"), false);
});

test("loads version 1 without mutation", () => {
  const root = mkdtempSync(join(tmpdir(), "state-load-"));
  const path = join(root, "state.json");
  const state = createInitialState(CONFIG, "abc123");
  writeFileSync(path, JSON.stringify(state));

  assert.deepEqual(loadState(path), state);
});

test("rejects missing and future schema versions", () => {
  assert.throws(() => migrateState({}), /schemaVersion/);
  assert.throws(() => migrateState({ schemaVersion: 2 }), /future state/);
});

test("writes atomically and leaves no temporary file", () => {
  const root = mkdtempSync(join(tmpdir(), "state-save-"));
  const path = join(root, "state.json");
  const state = createInitialState(CONFIG, "abc123");

  saveStateAtomic(path, state);

  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), state);
  assert.equal(existsSync(`${path}.tmp`), false);
});

test("backs up existing state without deleting it", () => {
  const root = mkdtempSync(join(tmpdir(), "state-backup-"));
  const path = join(root, "state.json");
  const history = join(root, "history");
  writeFileSync(path, JSON.stringify(createInitialState(CONFIG, "abc123")));

  const backup = backupState(path, history, "2026-07-16T00-00-00Z");

  assert.equal(existsSync(path), true);
  assert.equal(existsSync(backup), true);
  assert.match(backup, /state-v1-2026-07-16T00-00-00Z\.json$/);
});

for (const [status, expected] of [
  ["Initialized", "fund"],
  ["Funded", "settle"],
  ["Released", "terminal"],
  ["Refunded", "terminal"],
  ["Cancelled", "terminal"],
]) {
  test(`resume decision maps ${status} to ${expected}`, () => {
    assert.deepEqual(decideNextStep({ status }), {
      action: expected,
      replayAllowed: expected !== "terminal",
    });
  });
}

test("rejects an unknown observed escrow state", () => {
  assert.throws(() => decideNextStep({ status: "Mystery" }), /unknown escrow/);
});

test("rejects secret-bearing state", () => {
  const root = mkdtempSync(join(tmpdir(), "state-secret-"));
  const path = join(root, "state.json");
  const state = createInitialState(CONFIG, "abc123");
  state.identities.sponsor = { secretKey: [1, 2, 3] };

  assert.throws(() => saveStateAtomic(path, state), /secret material/);
});

test("rejects an unlabelled keypair-shaped byte array", () => {
  const root = mkdtempSync(join(tmpdir(), "state-keypair-array-"));
  const path = join(root, "state.json");
  const state = createInitialState(CONFIG, "abc123");
  state.captures.push(Array.from({ length: 64 }, (_, index) => index));

  assert.throws(() => saveStateAtomic(path, state), /keypair-shaped byte array/);
});

test("initializes identities, reuses valid files and logs public keys only", () => {
  const root = mkdtempSync(join(tmpdir(), "identity-init-"));
  const devnet = join(root, ".devnet");
  const program = Keypair.generate();
  const config = { ...CONFIG, programId: program.publicKey.toBase58() };
  const state = createInitialState(config, "abc123");
  const created = [];
  const output = [];
  mkdirSync(devnet);
  writeFileSync(
    join(devnet, "program.devnet-keypair.json"),
    JSON.stringify([...program.secretKey]),
  );

  const keygen = {
    create(path) {
      const keypair = Keypair.generate();
      writeFileSync(path, JSON.stringify([...keypair.secretKey]));
      created.push(path);
      return keypair.publicKey.toBase58();
    },
    publicKey(path) {
      const bytes = JSON.parse(readFileSync(path, "utf8"));
      return Keypair.fromSecretKey(Uint8Array.from(bytes)).publicKey.toBase58();
    },
  };

  const first = initializeIdentities({
    repoRoot: root,
    devnetDir: devnet,
    state,
    programId: config.programId,
    keygen,
    isTrackedIgnored: () => true,
    logger: (value) => output.push(value),
  });
  const createdCount = created.length;
  const second = initializeIdentities({
    repoRoot: root,
    devnetDir: devnet,
    state: first,
    programId: config.programId,
    keygen,
    isTrackedIgnored: () => true,
    logger: (value) => output.push(value),
  });

  assert.equal(createdCount, 5);
  assert.equal(created.length, createdCount);
  assert.deepEqual(second.identities, first.identities);
  assert.equal(JSON.stringify(output).includes("secretKey"), false);
  assert.equal(JSON.stringify(output).match(/\[(\d+,){10}/), null);
});

test("identity initialization stops without tracked ignore protection", () => {
  const root = mkdtempSync(join(tmpdir(), "identity-ignore-"));
  assert.throws(
    () =>
      initializeIdentities({
        repoRoot: root,
        devnetDir: join(root, ".devnet"),
        state: createInitialState(CONFIG, "abc123"),
        programId: CONFIG.programId,
        keygen: {},
        isTrackedIgnored: () => false,
        logger: () => {},
      }),
    /tracked .gitignore protection/,
  );
});

test("unimplemented CLI commands fail closed without claiming an action", () => {
  assert.throws(
    () => assertSupportedCommand("deploy-program"),
    /not implemented in this checkpoint; no devnet action was performed/,
  );
});
