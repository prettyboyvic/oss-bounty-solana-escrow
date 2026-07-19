import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  collectLeaseReconciliationInput,
  createProductionUploadDependencies,
  executeUploadWindow,
} from "../../scripts/devnet/upload-execution-command.mjs";
import {
  reconcileUploadLease,
  releaseUploadLease,
} from "../../scripts/devnet/upload-execution-lease.mjs";
import { createPlanFingerprint } from "../../scripts/devnet/throttled-uploader.mjs";
import { planBufferUpload } from "../../scripts/devnet/upload-plan.mjs";

const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const METADATA_LENGTH = 37;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForValidator(connection, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("LOCAL_VALIDATOR_EXITED");
    try {
      await connection.getVersion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("LOCAL_VALIDATOR_START_TIMEOUT");
}

async function waitForSignature(connection, signature) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err || status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("SIGNATURE_CONFIRMATION_TIMEOUT");
}

async function stopOwnedValidator(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}

async function createBuffer(connection, authority, buffer, binaryLength) {
  const allocation = binaryLength + METADATA_LENGTH;
  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: buffer.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(allocation),
      space: allocation,
      programId: new PublicKey(LOADER),
    }),
    new TransactionInstruction({
      programId: new PublicKey(LOADER),
      keys: [
        { pubkey: buffer.publicKey, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: false, isWritable: false },
      ],
      data: Buffer.alloc(4),
    }),
  );
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = authority.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  transaction.sign(authority, buffer);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { maxRetries: 0 });
  assert.equal((await waitForSignature(connection, signature)).err, null);
  return allocation;
}

test("production execution path enforces five chunks, lease recovery and exact resume", { timeout: 120_000 }, async () => {
  const runtime = mkdtempSync(join(tmpdir(), "upload-entrypoint-local-"));
  const ledger = join(runtime, "ledger");
  const statePath = join(runtime, "state.json");
  const binaryPath = join(runtime, "program.so");
  const authorityPath = join(runtime, "authority.json");
  const authorityAccountPath = join(runtime, "authority-account.json");
  const rpcPort = await freePort();
  const rpcUrl = `http://127.0.0.1:${rpcPort}`;
  let authority = Keypair.generate();
  const buffer = Keypair.generate();
  const program = Keypair.generate().publicKey;
  writeFileSync(authorityPath, JSON.stringify(Array.from(authority.secretKey)));
  writeFileSync(authorityAccountPath, JSON.stringify({
    pubkey: authority.publicKey.toBase58(),
    account: {
      lamports: 10_000_000_000,
      data: ["", "base64"],
      owner: SystemProgram.programId.toBase58(),
      executable: false,
      rentEpoch: 0,
    },
  }));
  const validator = spawn("solana-test-validator", [
    "--ledger", ledger,
    "--reset",
    "--bind-address", "127.0.0.1",
    "--rpc-port", String(rpcPort),
    "--account", authority.publicKey.toBase58(), authorityAccountPath,
    "--quiet",
  ], { stdio: "ignore", windowsHide: true });

  try {
    const connection = new Connection(rpcUrl, "confirmed");
    await waitForValidator(connection, validator);
    const localBytes = Buffer.from(Array.from({ length: 6 * 1011 }, (_, index) => (index % 250) + 1));
    writeFileSync(binaryPath, localBytes);
    const allocation = await createBuffer(connection, authority, buffer, localBytes.length);
    const initialAccount = await connection.getAccountInfo(buffer.publicKey, "confirmed");
    const plan = planBufferUpload({
      localBytes,
      bufferBytes: Buffer.from(initialAccount.data).subarray(METADATA_LENGTH),
      buffer: buffer.publicKey,
      authority: authority.publicKey,
    });
    assert.equal(plan.totalChunks, 6);
    const contract = {
      url: rpcUrl,
      genesis: await connection.getGenesisHash(),
      program: program.toBase58(),
      buffer: buffer.publicKey.toBase58(),
      authority: authority.publicKey.toBase58(),
      owner: LOADER,
    };
    const fingerprint = createPlanFingerprint({
      program: contract.program,
      buffer: contract.buffer,
      authority: contract.authority,
      allocation,
      binarySha256: sha256(localBytes),
      maxPayload: plan.maxPayload,
      chunks: plan.chunks,
    });
    writeFileSync(statePath, `${JSON.stringify({
      schemaVersion: 3,
      identities: { program: contract.program },
      deployment: {
        buffer: {
          publicKey: contract.buffer,
          expectedOwner: LOADER,
          expectedAuthority: contract.authority,
          allocatedLength: allocation,
          localBinary: { length: localBytes.length, sha256: sha256(localBytes) },
          planFingerprint: fingerprint,
          chunks: plan.chunks.map(({ index, offset, length, sha256: chunkSha256 }) => ({ index, offset, length, sha256: chunkSha256, status: "PLANNED", signature: null })),
          uploadWindows: [],
        },
      },
    }, null, 2)}\n`);
    const request = {
      command: "upload-buffer-throttled",
      url: rpcUrl,
      program: contract.program,
      buffer: contract.buffer,
      statePath,
      authorityPath,
      binaryPath,
      maxChunks: 5,
      delayMs: 1000,
      acknowledgement: "R4_BUFFER_UPLOAD",
    };
    const sentIndexes = [];
    const sleeps = [];
    let inFlight = 0;
    let maximumInFlight = 0;
    const runtimeDependencies = (executionId) => {
      const dependencies = createProductionUploadDependencies(rpcUrl, { bufferAddress: contract.buffer });
      const rawSend = dependencies.sendRawTransaction;
      dependencies.contract = contract;
      dependencies.executionId = () => executionId;
      dependencies.pid = executionId === "local-window-1" ? 8101 : 8102;
      dependencies.hostname = "local-test-host";
      dependencies.now = () => "2026-07-19T00:00:00.000Z";
      dependencies.sleep = async (ms) => { sleeps.push(ms); };
      dependencies.sendRawTransaction = async (raw, chunk) => {
        const record = JSON.parse(readFileSync(statePath)).deployment.buffer.chunks[chunk.index];
        assert.equal(record.status, "SENT");
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        try {
          const signature = await rawSend(raw);
          assert.equal(signature, record.signature);
          sentIndexes.push(chunk.index);
          return signature;
        } finally {
          inFlight -= 1;
        }
      };
      return dependencies;
    };

    let dependencies = runtimeDependencies("local-window-1");
    const first = await executeUploadWindow(request, dependencies);
    assert.equal(first.status, "WINDOW_LIMIT");
    assert.deepEqual(sentIndexes, [0, 1, 2, 3, 4]);
    assert.equal(maximumInFlight, 1);
    assert.ok(sleeps.every((ms) => ms === 1000));

    const reconciliationInput = await collectLeaseReconciliationInput({
      ...request,
      executionId: "local-window-1",
    }, dependencies);
    const safe = reconcileUploadLease(reconciliationInput, { processIsActive: () => false });
    assert.equal(safe.result, "SAFE_TO_RELEASE");
    assert.equal(releaseUploadLease({ ...reconciliationInput, reconciliationHash: safe.evidenceHash, acknowledgement: "R4_RELEASE_UPLOAD_LEASE" }, { processIsActive: () => false }).lifecycle, "ARCHIVED/RELEASED");

    authority = null;
    dependencies = null;
    dependencies = runtimeDependencies("local-window-2");
    const second = await executeUploadWindow(request, dependencies);
    assert.equal(second.status, "COMPLETE");
    assert.deepEqual(sentIndexes, [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(second.skippedIndexes, [0, 1, 2, 3, 4]);
    const finalAccount = await connection.getAccountInfo(buffer.publicKey, "confirmed");
    assert.equal(Buffer.from(finalAccount.data).subarray(METADATA_LENGTH).equals(localBytes), true);
    assert.deepEqual(JSON.parse(readFileSync(statePath)).deployment.buffer.chunks.map(({ status }) => status), ["CONFIRMED", "CONFIRMED", "CONFIRMED", "CONFIRMED", "CONFIRMED", "CONFIRMED"]);
  } finally {
    await stopOwnedValidator(validator);
    rmSync(runtime, { recursive: true, force: true });
  }
});
