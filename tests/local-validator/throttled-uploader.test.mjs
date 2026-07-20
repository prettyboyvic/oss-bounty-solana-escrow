import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { makeLoaderV3WriteInstruction } from "../../scripts/devnet/loader-v3-codec.mjs";
import {
  createPlanFingerprint,
  loadUploaderCheckpoint,
  runPersistedSequentialUpload,
} from "../../scripts/devnet/throttled-uploader.mjs";
import { planBufferUpload } from "../../scripts/devnet/upload-plan.mjs";

const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const PROGRAM = "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z";
const METADATA_LENGTH = 37;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function withTimeout(promise, label, timeoutMs = 10_000) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
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

async function waitForSignature(connection, signature, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await connection.getSignatureStatuses(
      [signature],
      { searchTransactionHistory: true },
    );
    const status = response.value[0];
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return { err: status.err };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("SIGNATURE_CONFIRMATION_TIMEOUT");
}

async function stopOwnedValidator(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGTERM");
  }
  await withTimeout(new Promise((resolve) => child.once("exit", resolve)), "VALIDATOR_STOP", 5_000)
    .catch(() => {});
}

async function createBuffer(connection, authority, buffer, binaryLength) {
  const allocation = binaryLength + METADATA_LENGTH;
  const lamports = await connection.getMinimumBalanceForRentExemption(allocation);
  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: buffer.publicKey,
      lamports,
      space: allocation,
      programId: LOADER,
    }),
    new TransactionInstruction({
      programId: LOADER,
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
  const confirmation = await waitForSignature(connection, signature);
  assert.equal(confirmation.err, null);
  return allocation;
}

test("real local validator resumes the same loader buffer after interruption", { timeout: 120_000 }, async () => {
  const runtime = mkdtempSync(join(tmpdir(), "oss-uploader-local-"));
  const ledger = join(runtime, "ledger");
  const statePath = join(runtime, "state-v3.json");
  const authorityPath = join(runtime, "test-authority.json");
  const bufferPath = join(runtime, "test-buffer.json");
  const authorityAccountPath = join(runtime, "test-authority-account.json");
  const rpcPort = await freePort();
  const rpcUrl = `http://127.0.0.1:${rpcPort}`;
  let authority = Keypair.generate();
  let buffer = Keypair.generate();
  writeFileSync(authorityPath, JSON.stringify(Array.from(authority.secretKey)));
  writeFileSync(bufferPath, JSON.stringify(Array.from(buffer.secretKey)));
  writeFileSync(authorityAccountPath, JSON.stringify({
    pubkey: authority.publicKey.toBase58(),
    account: {
      lamports: 5_000_000_000,
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
    assert.equal(await connection.getBalance(authority.publicKey, "confirmed"), 5_000_000_000);

    const localBytes = Buffer.from(Uint8Array.from(
      { length: 2_300 },
      (_, index) => (index * 31) % 251,
    ));
    const allocation = await createBuffer(connection, authority, buffer, localBytes.length);
    const initialAccount = await connection.getAccountInfo(buffer.publicKey, "confirmed");
    assert.ok(initialAccount);
    const maxPayload = 700;
    const initialPlan = planBufferUpload({
      localBytes,
      bufferBytes: Buffer.from(initialAccount.data).subarray(METADATA_LENGTH),
      buffer: buffer.publicKey,
      authority: authority.publicKey,
      maxPayload,
    });
    assert.equal(initialPlan.totalChunks, 4);
    assert.deepEqual(initialPlan.chunks.map(({ exactMatch }) => exactMatch), [false, false, false, false]);
    const fingerprint = createPlanFingerprint({
      program: PROGRAM,
      buffer: buffer.publicKey.toBase58(),
      authority: authority.publicKey.toBase58(),
      allocation,
      binarySha256: sha256(localBytes),
      maxPayload,
      chunks: initialPlan.chunks,
    });
    writeFileSync(statePath, JSON.stringify({
      schemaVersion: 3,
      identities: { program: PROGRAM },
      deployment: {
        buffer: {
          publicKey: buffer.publicKey.toBase58(),
          expectedOwner: LOADER.toBase58(),
          expectedAuthority: authority.publicKey.toBase58(),
          allocatedLength: allocation,
          localBinary: { length: localBytes.length, sha256: sha256(localBytes) },
          planFingerprint: fingerprint,
          chunks: initialPlan.chunks.map(({ index, offset, length, sha256: chunkSha256 }) => ({
            index,
            offset,
            length,
            sha256: chunkSha256,
            status: "PLANNED",
            signature: null,
          })),
        },
      },
    }));

    const sentIndexes = [];
    const events = [];
    const lifecycle = [];
    let inFlight = 0;
    let maximumInFlight = 0;
    const adapter = () => ({
      sign: async (chunk) => {
        const latest = await connection.getLatestBlockhash("confirmed");
        const transaction = new Transaction({
          feePayer: authority.publicKey,
          recentBlockhash: latest.blockhash,
        }).add(makeLoaderV3WriteInstruction({
          buffer: buffer.publicKey,
          authority: authority.publicKey,
          offset: chunk.offset,
          bytes: chunk.bytes,
        }));
        transaction.sign(authority);
        return {
          signature: bs58.encode(transaction.signature),
          rawTransaction: transaction.serialize(),
          confirmationStrategy: { signature: bs58.encode(transaction.signature), ...latest },
        };
      },
      send: async (signed, chunk) => {
        lifecycle.push(`send:${chunk.index}`);
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        assert.equal(events.at(-1)?.status, "SENT");
        assert.equal(events.at(-1)?.index, chunk.index);
        try {
          const signature = await connection.sendRawTransaction(signed.rawTransaction, { maxRetries: 0 });
          assert.equal(signature, signed.signature);
          sentIndexes.push(chunk.index);
        } finally {
          inFlight -= 1;
        }
      },
      confirm: async (_signature, _timeout, signed, chunk) => {
        lifecycle.push(`confirm:${chunk.index}`);
        return waitForSignature(connection, signed.confirmationStrategy.signature);
      },
      readChunkMatches: async (chunk) => {
        lifecycle.push(`match:${chunk.index}`);
        const account = await connection.getAccountInfo(buffer.publicKey, "confirmed");
        return Buffer.from(account.data)
          .subarray(METADATA_LENGTH + chunk.offset, METADATA_LENGTH + chunk.offset + chunk.length)
          .equals(chunk.bytes);
      },
      sleep: async () => {},
      onEvent: (event) => events.push(event),
    });
    const checkpoint = {
      program: PROGRAM,
      buffer: buffer.publicKey.toBase58(),
      authority: authority.publicKey.toBase58(),
      owner: LOADER.toBase58(),
      allocation,
      binaryLength: localBytes.length,
      binarySha256: sha256(localBytes),
      planFingerprint: fingerprint,
    };
    const chunksWithBytes = initialPlan.chunks.map((chunk) => ({
      ...chunk,
      bytes: localBytes.subarray(chunk.offset, chunk.offset + chunk.length),
    }));

    const interrupted = await runPersistedSequentialUpload({
      statePath,
      checkpoint,
      chunks: chunksWithBytes,
      policy: { maxChunksPerWindow: 2, minimumDelayMs: 1 },
      ...adapter(),
    });
    assert.equal(interrupted.status, "WINDOW_LIMIT");
    assert.deepEqual(interrupted.confirmedIndexes, [0, 1]);
    const bufferAddressBeforeRestart = buffer.publicKey.toBase58();
    assert.deepEqual(loadUploaderCheckpoint(statePath, checkpoint).deployment.buffer.chunks.map(({ status }) => status), ["CONFIRMED", "CONFIRMED", "PLANNED", "PLANNED"]);

    authority = null;
    buffer = null;
    authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(authorityPath, "utf8"))));
    buffer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(bufferPath, "utf8"))));
    const resumedAccount = await connection.getAccountInfo(buffer.publicKey, "confirmed");
    const resumedPlan = planBufferUpload({
      localBytes,
      bufferBytes: Buffer.from(resumedAccount.data).subarray(METADATA_LENGTH),
      buffer: buffer.publicKey,
      authority: authority.publicKey,
      maxPayload,
    });
    assert.equal(resumedPlan.exactChunks, 2);
    const resumed = await runPersistedSequentialUpload({
      statePath,
      checkpoint,
      confirmedChunkIndexes: resumedPlan.chunks.filter(({ exactMatch }) => exactMatch).map(({ index }) => index),
      chunks: resumedPlan.chunks.map((chunk) => ({
        ...chunk,
        bytes: localBytes.subarray(chunk.offset, chunk.offset + chunk.length),
      })),
      policy: { maxChunksPerWindow: 4, minimumDelayMs: 1 },
      ...adapter(),
    });

    assert.equal(resumed.status, "COMPLETE");
    assert.equal(maximumInFlight, 1);
    assert.deepEqual(sentIndexes, [0, 1, 2, 3]);
    assert.deepEqual(resumed.skippedIndexes, [0, 1]);
    for (let index = 0; index < 3; index += 1) {
      assert.ok(lifecycle.indexOf(`match:${index}`) < lifecycle.indexOf(`send:${index + 1}`));
    }
    assert.equal(buffer.publicKey.toBase58(), bufferAddressBeforeRestart);
    const finalAccount = await connection.getAccountInfo(buffer.publicKey, "confirmed");
    assert.ok(Buffer.from(finalAccount.data).subarray(METADATA_LENGTH).equals(localBytes));
    assert.deepEqual(loadUploaderCheckpoint(statePath, checkpoint).deployment.buffer.chunks.map(({ status }) => status), ["CONFIRMED", "CONFIRMED", "CONFIRMED", "CONFIRMED"]);
    assert.equal(events.some(({ status }) => status === "REGENERATE_BUFFER" || status === "CLOSE_BUFFER"), false);
  } finally {
    await stopOwnedValidator(validator);
    rmSync(runtime, { recursive: true, force: true });
  }
});
