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
  initializeDeploymentBuffer,
  initializeIdentities,
} from "../../scripts/devnet/run.mjs";
import {
  backupState,
  configureDeploymentBuffer,
  createInitialState,
  decideNextStep,
  loadState,
  migrateStateFile,
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

test("creates schemaVersion 2 without secret paths", () => {
  const state = createInitialState(CONFIG, "abc123");
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.source.commit, "abc123");
  assert.deepEqual(state.flows, { release: {}, refund: {} });
  assert.equal(JSON.stringify(state).includes("keypair"), false);
});

test("loads version 2 without mutation", () => {
  const root = mkdtempSync(join(tmpdir(), "state-load-"));
  const path = join(root, "state.json");
  const state = createInitialState(CONFIG, "abc123");
  writeFileSync(path, JSON.stringify(state));

  assert.deepEqual(loadState(path), state);
});

test("rejects missing and future schema versions", () => {
  assert.throws(() => migrateState({}), /schemaVersion/);
  assert.throws(() => migrateState({ schemaVersion: 3 }), /future state/);
});

test("migrates version 1 while preserving existing public evidence", () => {
  const legacy = createInitialState(CONFIG, "abc123");
  legacy.schemaVersion = 1;
  legacy.deployment = { priorAttempt: "preserved" };

  const migrated = migrateState(legacy);

  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.deployment.priorAttempt, "preserved");
  assert.equal(migrated.deployment.buffer, null);
});

test("file migration backs up version 1 before atomic replacement", () => {
  const root = mkdtempSync(join(tmpdir(), "state-migrate-file-"));
  const path = join(root, "state.json");
  const history = join(root, "history");
  const legacy = createInitialState(CONFIG, "abc123");
  legacy.schemaVersion = 1;
  writeFileSync(path, JSON.stringify(legacy));

  const result = migrateStateFile(
    path,
    history,
    "2026-07-17T00-00-00Z",
  );

  assert.equal(result.state.schemaVersion, 2);
  assert.equal(existsSync(result.backup), true);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).schemaVersion, 2);
});

test("records only public resumable buffer fields", () => {
  const state = configureDeploymentBuffer(createInitialState(CONFIG, "abc123"), {
    publicKey: "11111111111111111111111111111111",
    expectedOwner: "BPFLoaderUpgradeab1e11111111111111111111111",
    expectedAuthority: "authority",
    allocatedLength: 395181,
    localBinaryLength: 395144,
    localBinarySha256: "ABC123",
  });

  assert.deepEqual(state.deployment.buffer, {
    publicKey: "11111111111111111111111111111111",
    expectedOwner: "BPFLoaderUpgradeab1e11111111111111111111111",
    expectedAuthority: "authority",
    allocatedLength: 395181,
    localBinary: { length: 395144, sha256: "ABC123" },
    creationSignature: null,
    writeAttempts: [],
    lastConfirmedProgress: null,
    status: "PLANNED",
    lastRpcError: null,
    retryEligible: true,
  });
  assert.equal(JSON.stringify(state).includes("keypair"), false);
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
  assert.match(backup, /state-v2-2026-07-16T00-00-00Z\.json$/);
});

test("same-timestamp backups preserve both snapshots", () => {
  const root = mkdtempSync(join(tmpdir(), "state-backup-collision-"));
  const path = join(root, "state.json");
  const history = join(root, "history");
  writeFileSync(path, JSON.stringify(createInitialState(CONFIG, "abc123")));

  const first = backupState(path, history, "2026-07-16T00-00-00Z");
  const second = backupState(path, history, "2026-07-16T00-00-00Z");

  assert.notEqual(first, second);
  assert.equal(existsSync(first), true);
  assert.equal(existsSync(second), true);
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

test("deployment buffer preparation creates once and records public state only", () => {
  const root = mkdtempSync(join(tmpdir(), "buffer-init-"));
  const devnet = join(root, ".devnet");
  const buffer = Keypair.generate();
  const created = [];
  mkdirSync(devnet);
  const keygen = {
    create(path) {
      writeFileSync(path, JSON.stringify([...buffer.secretKey]));
      created.push(path);
      return buffer.publicKey.toBase58();
    },
    publicKey() {
      return buffer.publicKey.toBase58();
    },
  };
  const input = {
    repoRoot: root,
    devnetDir: devnet,
    state: createInitialState(CONFIG, "abc123"),
    authorityPublicKey: "authority",
    binaryLength: 395144,
    binarySha256: "ABC123",
    keygen,
    isTrackedIgnored: () => true,
    logger: () => {},
  };

  const first = initializeDeploymentBuffer(input);
  const second = initializeDeploymentBuffer({ ...input, state: first });

  assert.equal(created.length, 1);
  assert.equal(first.deployment.buffer.publicKey, buffer.publicKey.toBase58());
  assert.equal(first.deployment.buffer.allocatedLength, 395181);
  assert.deepEqual(second.deployment.buffer, first.deployment.buffer);
  assert.equal(JSON.stringify(second).includes("deploy-buffer.devnet-keypair"), false);
  assert.equal(JSON.stringify(second).includes("secretKey"), false);
});

test("deployment buffer preparation rejects ignore and recorded-address mismatch", () => {
  const root = mkdtempSync(join(tmpdir(), "buffer-init-reject-"));
  const devnet = join(root, ".devnet");
  const buffer = Keypair.generate();
  mkdirSync(devnet);
  const signerPath = join(devnet, "deploy-buffer.devnet-keypair.json");
  writeFileSync(signerPath, JSON.stringify([...buffer.secretKey]));
  const keygen = {
    create() {
      throw new Error("must not regenerate");
    },
    publicKey() {
      return buffer.publicKey.toBase58();
    },
  };
  const base = {
    repoRoot: root,
    devnetDir: devnet,
    state: createInitialState(CONFIG, "abc123"),
    authorityPublicKey: "authority",
    binaryLength: 395144,
    binarySha256: "ABC123",
    keygen,
    logger: () => {},
  };

  assert.throws(
    () => initializeDeploymentBuffer({ ...base, isTrackedIgnored: () => false }),
    /tracked .gitignore protection/,
  );

  const state = structuredClone(base.state);
  state.deployment.buffer = { publicKey: Keypair.generate().publicKey.toBase58() };
  assert.throws(
    () => initializeDeploymentBuffer({ ...base, state, isTrackedIgnored: () => true }),
    /buffer public key mismatch/,
  );
});

test("unimplemented CLI commands fail closed without claiming an action", () => {
  assert.throws(
    () => assertSupportedCommand("deploy-program"),
    /not implemented in this checkpoint; no devnet action was performed/,
  );
});
