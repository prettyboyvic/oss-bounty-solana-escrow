import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  applyUploadReconciliation,
  leasePaths,
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

async function waitForFinalizedSignatures(connection, signatures) {
  const deadline = Date.now() + 45_000;
  let lastStatuses = [];
  while (Date.now() < deadline) {
    const statuses = (await connection.getSignatureStatuses(signatures, { searchTransactionHistory: true })).value;
    lastStatuses = statuses;
    if (statuses.every((status) => status?.err || status?.confirmationStatus === "finalized")) {
      assert.ok(statuses.every((status) => status?.err === null));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`FINALIZED_SIGNATURE_TIMEOUT ${JSON.stringify(lastStatuses.map((status) => ({ confirmationStatus: status?.confirmationStatus ?? null, confirmations: status?.confirmations ?? null, hasError: status?.err != null })))}`);
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
  await waitForFinalizedSignatures(connection, [signature]);
  return allocation;
}

test("production entrypoint covers scheduler pacing, injected 429 recovery and cold resume", { timeout: 240_000 }, async (t) => {
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
    "--ticks-per-slot", "8",
    "--account", authority.publicKey.toBase58(), authorityAccountPath,
    "--quiet",
  ], { stdio: "ignore", windowsHide: true });

  try {
    const connection = new Connection(rpcUrl, "confirmed");
    await waitForValidator(connection, validator);
    const genesis = await connection.getGenesisHash();
    const schedulerSleeps = [];
    const requestLedgers = [];
    let inFlight = 0;
    let maximumInFlight = 0;

    async function makeFixture(label, chunkCount) {
      const fixtureStatePath = label === "recovery" ? statePath : join(runtime, `${label}-state.json`);
      const fixtureBinaryPath = label === "recovery" ? binaryPath : join(runtime, `${label}-program.so`);
      const fixtureBuffer = label === "recovery" ? buffer : Keypair.generate();
      const fixtureProgram = label === "recovery" ? program : Keypair.generate().publicKey;
      const localBytes = Buffer.from(Array.from({ length: chunkCount * 1011 }, (_, index) => ((index * 17) % 250) + 1));
      writeFileSync(fixtureBinaryPath, localBytes);
      const allocation = await createBuffer(connection, authority, fixtureBuffer, localBytes.length);
      const initialAccount = await connection.getAccountInfo(fixtureBuffer.publicKey, "confirmed");
      const plan = planBufferUpload({
        localBytes,
        bufferBytes: Buffer.from(initialAccount.data).subarray(METADATA_LENGTH),
        buffer: fixtureBuffer.publicKey,
        authority: authority.publicKey,
      });
      assert.equal(plan.totalChunks, chunkCount);
      const contract = {
        url: rpcUrl,
        genesis,
        program: fixtureProgram.toBase58(),
        buffer: fixtureBuffer.publicKey.toBase58(),
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
      writeFileSync(fixtureStatePath, `${JSON.stringify({
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
      return {
        statePath: fixtureStatePath,
        binaryPath: fixtureBinaryPath,
        buffer: fixtureBuffer,
        localBytes,
        contract,
        request: {
          command: "upload-buffer-throttled",
          url: rpcUrl,
          program: contract.program,
          buffer: contract.buffer,
          statePath: fixtureStatePath,
          authorityPath,
          binaryPath: fixtureBinaryPath,
          maxChunks: 5,
          delayMs: 1000,
          acknowledgement: "R4_BUFFER_UPLOAD",
        },
      };
    }

    function runtimeDependencies(fixture, executionId, mode = "normal") {
      let monotonicMs = 0;
      const counters = {
        accountSnapshotAttempts: 0,
        blockhashAttempts: 0,
        buildAndSignCalls: 0,
        confirmationSignatures: [],
        confirmationStatuses: [],
        events: [],
        sendChunks: [],
        sendTransportCalls: 0,
        signerLoads: 0,
        transmittedSignatures: [],
      };
      const injectedConnection = {
        rpcEndpoint: rpcUrl,
        getGenesisHash: (...args) => connection.getGenesisHash(...args),
        getAccountInfo: (...args) => connection.getAccountInfo(...args),
        async getAccountInfoAndContext(...args) {
          counters.accountSnapshotAttempts += 1;
          if (mode === "preflight-read-429" && counters.accountSnapshotAttempts < 3) {
            throw Object.assign(new Error("injected rate limit"), { status: 429 });
          }
          return connection.getAccountInfoAndContext(...args);
        },
        getBalance: (...args) => connection.getBalance(...args),
        getMinimumBalanceForRentExemption: (...args) => connection.getMinimumBalanceForRentExemption(...args),
        async getLatestBlockhash(...args) {
          counters.blockhashAttempts += 1;
          if (mode === "blockhash-429") throw Object.assign(new Error("injected rate limit"), { status: 429 });
          return connection.getLatestBlockhash(...args);
        },
        async sendRawTransaction(...args) {
          counters.sendTransportCalls += 1;
          const signature = await connection.sendRawTransaction(...args);
          counters.transmittedSignatures.push(signature);
          if (mode === "send-429-after-submit") throw Object.assign(new Error("injected rate limit"), { status: 429 });
          return signature;
        },
        async getSignatureStatuses(signatures, ...args) {
          counters.confirmationSignatures.push([...signatures]);
          if (mode === "confirmation-429") throw Object.assign(new Error("injected rate limit"), { status: 429 });
          if (mode === "confirmation-timeout") {
            const response = { value: signatures.map(() => ({ err: null, confirmationStatus: "processed" })) };
            counters.confirmationStatuses.push(response.value.map(({ confirmationStatus }) => confirmationStatus));
            return response;
          }
          const response = await connection.getSignatureStatuses(signatures, ...args);
          counters.confirmationStatuses.push(response.value.map((status) => status?.confirmationStatus ?? null));
          return response;
        },
        getTransaction: (...args) => connection.getTransaction(...args),
        getMultipleAccountsInfoAndContext: (...args) => connection.getMultipleAccountsInfoAndContext(...args),
      };
      let injectEarlyWake = mode === "early-wake";
      let injectAbort = mode === "abort-wait";
      let dependencies;
      dependencies = createProductionUploadDependencies(rpcUrl, {
        bufferAddress: fixture.contract.buffer,
        connection: injectedConnection,
        monotonicNow: () => monotonicMs,
        schedulerSleep: async (ms) => {
          schedulerSleeps.push(ms);
          if (injectAbort && ms > 0) {
            injectAbort = false;
            void dependencies.rpcRequestScheduler.abort(new Error("injected abort during wait"));
            monotonicMs += ms;
            return;
          }
          if (injectEarlyWake && ms >= 500) {
            injectEarlyWake = false;
            monotonicMs += ms - 1;
          } else {
            monotonicMs += ms;
          }
          if (ms >= 2000) await new Promise((resolve) => setTimeout(resolve, 1000));
        },
        transactionSleep: async (ms) => {
          if (ms === 250) await new Promise((resolve) => setTimeout(resolve, 25));
        },
      });
      requestLedgers.push(dependencies.rpcRequestLedger);
      const rawSend = dependencies.sendRawTransaction;
      const rawLoad = dependencies.loadAuthorityKeypair;
      const rawBuildAndSign = dependencies.buildAndSign;
      const rawConfirm = dependencies.confirmSignature;
      const rawReadChunkMatches = dependencies.readChunkMatches;
      dependencies.contract = fixture.contract;
      dependencies.executionId = () => executionId;
      dependencies.pid = 8100 + requestLedgers.length;
      dependencies.hostname = "local-test-host";
      dependencies.now = () => "2026-07-19T00:00:00.000Z";
      dependencies.loadAuthorityKeypair = async (...args) => {
        counters.signerLoads += 1;
        if (mode === "preflight-read-429") assert.equal(counters.accountSnapshotAttempts, 3);
        return rawLoad(...args);
      };
      dependencies.buildAndSign = (...args) => {
        counters.buildAndSignCalls += 1;
        return rawBuildAndSign(...args);
      };
      dependencies.sendRawTransaction = async (raw, chunk) => {
        const record = JSON.parse(readFileSync(fixture.statePath)).deployment.buffer.chunks[chunk.index];
        assert.equal(record.status, "SENT");
        assert.ok(record.signature);
        counters.sendChunks.push(chunk.index);
        counters.events.push(`send:${chunk.index}`);
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        try {
          return await rawSend(raw);
        } finally {
          inFlight -= 1;
        }
      };
      dependencies.confirmSignature = async (...args) => {
        const result = await rawConfirm(...args);
        counters.events.push(`confirm:${args[3].index}`);
        return result;
      };
      dependencies.readChunkMatches = async (chunk) => {
        const result = await rawReadChunkMatches(chunk);
        counters.events.push(`match:${chunk.index}`);
        return result;
      };
      return { dependencies, counters };
    }

    async function releaseWindow(fixture, executionId, dependencies) {
      let reconciliationInput = await collectLeaseReconciliationInput({
        ...fixture.request,
        executionId,
      }, dependencies);
      let result = reconcileUploadLease(reconciliationInput, { processIsActive: () => false });
      assert.equal(result.result, "SAFE_TO_RELEASE");
      if (result.proposedTransitions.length > 0) {
        assert.equal(applyUploadReconciliation({
          ...reconciliationInput,
          reconciliationHash: result.evidenceHash,
          acknowledgement: "R4_APPLY_UPLOAD_RECONCILIATION",
        }, { processIsActive: () => false, now: () => "2026-07-19T00:00:01.000Z" }).status, "APPLIED");
        reconciliationInput = await collectLeaseReconciliationInput({ ...fixture.request, executionId }, dependencies);
        result = reconcileUploadLease(reconciliationInput, { processIsActive: () => false });
        assert.equal(result.result, "SAFE_TO_RELEASE");
      }
      assert.equal(result.releaseReady, true);
      assert.equal(releaseUploadLease({
        ...reconciliationInput,
        reconciliationHash: result.evidenceHash,
        acknowledgement: "R4_RELEASE_UPLOAD_LEASE",
      }, { processIsActive: () => false }).lifecycle, "ARCHIVED/RELEASED");
    }

    const normal = await makeFixture("normal-three", 3);
    t.diagnostic("scenario A fixture finalized");
    let runtimeResult = runtimeDependencies(normal, "normal-three", "early-wake");
    const normalResult = await executeUploadWindow({ ...normal.request, maxChunks: 3 }, runtimeResult.dependencies);
    assert.equal(normalResult.status, "COMPLETE");
    assert.deepEqual(normalResult.rpcRequestPolicy, {
      globalRequestStartGapMs: 500,
      confirmationPollIntervalMs: 2000,
      rateLimitRetryScheduleMs: [2000, 5000],
    });
    assert.equal(runtimeResult.counters.accountSnapshotAttempts, 1);
    assert.deepEqual(runtimeResult.counters.sendChunks, [0, 1, 2]);
    const normalEntries = runtimeResult.dependencies.rpcRequestLedger.debugSafeEntries();
    const finalPreflightRead = normalEntries.filter(({ methodClass }) => methodClass === "GET_RENT_EXEMPTION").at(-1);
    const firstBlockhashRead = normalEntries.find(({ methodClass }) => methodClass === "GET_LATEST_BLOCKHASH");
    assert.ok(firstBlockhashRead.startMonotonicMs - finalPreflightRead.endMonotonicMs >= 3000);
    const normalStatusEntries = normalEntries.filter(({ methodClass }) => methodClass === "GET_SIGNATURE_STATUSES");
    assert.ok(normalStatusEntries.length < 46);
    for (let index = 1; index < normalStatusEntries.length; index += 1) {
      assert.ok(normalStatusEntries[index].startMonotonicMs - normalStatusEntries[index - 1].startMonotonicMs >= 2000);
    }
    assert.equal(normalEntries.filter(({ methodClass }) => methodClass === "SEND_RAW_TRANSACTION").length, 3);
    assert.equal(normalEntries.filter(({ methodClass }) => methodClass === "SEND_RAW_TRANSACTION").every(({ retryNumber }) => retryNumber === 0), true);
    assert.equal(runtimeResult.counters.confirmationStatuses.filter((statuses) => statuses[0] === "finalized").length, 3);
    const normalGaps = normalEntries.slice(1).map((entry, index) => entry.startMonotonicMs - normalEntries[index].startMonotonicMs);
    t.diagnostic(`scenario A minimum actual invocation gap: ${Math.min(...normalGaps)}ms; status requests: ${normalStatusEntries.length}`);
    for (const index of [0, 1]) {
      assert.ok(runtimeResult.counters.events.indexOf(`confirm:${index}`) < runtimeResult.counters.events.indexOf(`send:${index + 1}`));
      assert.ok(runtimeResult.counters.events.indexOf(`match:${index}`) < runtimeResult.counters.events.indexOf(`send:${index + 1}`));
    }
    await waitForFinalizedSignatures(connection, runtimeResult.counters.transmittedSignatures);
    const normalAccount = await connection.getAccountInfo(normal.buffer.publicKey, "confirmed");
    assert.equal(Buffer.from(normalAccount.data).subarray(METADATA_LENGTH).equals(normal.localBytes), true);
    await releaseWindow(normal, "normal-three", runtimeResult.dependencies);
    await runtimeResult.dependencies.rpcRequestScheduler.close();
    t.diagnostic("scenario A complete and archived");

    const recovery = await makeFixture("recovery", 6);
    t.diagnostic("recovery fixture finalized");
    const allRecoverySendChunks = [];

    runtimeResult = runtimeDependencies(recovery, "preflight-read-retry", "preflight-read-429");
    const first = await executeUploadWindow({ ...recovery.request, maxChunks: 3 }, runtimeResult.dependencies);
    allRecoverySendChunks.push(...runtimeResult.counters.sendChunks);
    assert.equal(first.status, "WINDOW_LIMIT");
    assert.equal(runtimeResult.counters.accountSnapshotAttempts, 3);
    assert.equal(runtimeResult.counters.signerLoads, 1);
    assert.deepEqual(runtimeResult.counters.sendChunks, [0, 1, 2]);
    await waitForFinalizedSignatures(connection, runtimeResult.counters.transmittedSignatures);
    await releaseWindow(recovery, "preflight-read-retry", runtimeResult.dependencies);
    await runtimeResult.dependencies.rpcRequestScheduler.close();
    t.diagnostic("scenario B complete and archived");

    runtimeResult = runtimeDependencies(recovery, "blockhash-exhaustion", "blockhash-429");
    await assert.rejects(executeUploadWindow(recovery.request, runtimeResult.dependencies), (error) =>
      error.classification === "RPC_RATE_LIMITED" && error.methodClass === "GET_LATEST_BLOCKHASH");
    assert.equal(runtimeResult.counters.blockhashAttempts, 3);
    assert.equal(runtimeResult.counters.buildAndSignCalls, 0);
    assert.equal(runtimeResult.counters.sendTransportCalls, 0);
    assert.deepEqual(JSON.parse(readFileSync(recovery.statePath)).deployment.buffer.chunks.slice(3).map(({ status, signature }) => ({ status, signature })), [
      { status: "PLANNED", signature: null },
      { status: "PLANNED", signature: null },
      { status: "PLANNED", signature: null },
    ]);
    await releaseWindow(recovery, "blockhash-exhaustion", runtimeResult.dependencies);
    await runtimeResult.dependencies.rpcRequestScheduler.close();
    t.diagnostic("scenario C complete and archived");

    runtimeResult = runtimeDependencies(recovery, "send-uncertainty", "send-429-after-submit");
    const uncertain = await executeUploadWindow(recovery.request, runtimeResult.dependencies);
    allRecoverySendChunks.push(...runtimeResult.counters.sendChunks);
    assert.equal(uncertain.status, "RATE_LIMITED");
    assert.equal(runtimeResult.counters.sendTransportCalls, 1);
    assert.deepEqual(runtimeResult.counters.sendChunks, [3]);
    assert.equal(JSON.parse(readFileSync(recovery.statePath)).deployment.buffer.chunks[3].status, "SENT");
    await waitForFinalizedSignatures(connection, runtimeResult.counters.transmittedSignatures);
    await releaseWindow(recovery, "send-uncertainty", runtimeResult.dependencies);
    await runtimeResult.dependencies.rpcRequestScheduler.close();
    t.diagnostic("scenario D complete and archived");

    runtimeResult = runtimeDependencies(recovery, "confirmation-exhaustion", "confirmation-429");
    await assert.rejects(executeUploadWindow(recovery.request, runtimeResult.dependencies), (error) =>
      error.classification === "RPC_RATE_LIMITED" && error.methodClass === "GET_SIGNATURE_STATUSES");
    allRecoverySendChunks.push(...runtimeResult.counters.sendChunks);
    assert.equal(runtimeResult.counters.sendTransportCalls, 1);
    assert.deepEqual(runtimeResult.counters.sendChunks, [4]);
    assert.deepEqual(runtimeResult.counters.confirmationSignatures, Array.from({ length: 3 }, () => [runtimeResult.counters.transmittedSignatures[0]]));
    assert.equal(JSON.parse(readFileSync(recovery.statePath)).deployment.buffer.chunks[5].status, "PLANNED");
    await waitForFinalizedSignatures(connection, runtimeResult.counters.transmittedSignatures);
    await runtimeResult.dependencies.rpcRequestScheduler.close();
    t.diagnostic("scenario E execution preserved unresolved state");
    runtimeResult = runtimeDependencies(recovery, "confirmation-reconciliation");
    await releaseWindow(recovery, "confirmation-exhaustion", runtimeResult.dependencies);
    await runtimeResult.dependencies.rpcRequestScheduler.close();
    t.diagnostic("scenario E reconciled and archived");

    const timeoutFixture = await makeFixture("confirmation-timeout", 2);
    runtimeResult = runtimeDependencies(timeoutFixture, "confirmation-timeout", "confirmation-timeout");
    const timedOut = await executeUploadWindow({ ...timeoutFixture.request, maxChunks: 2 }, runtimeResult.dependencies);
    assert.equal(timedOut.status, "UNKNOWN");
    assert.equal(runtimeResult.counters.sendTransportCalls, 1);
    assert.deepEqual(runtimeResult.counters.sendChunks, [0]);
    assert.ok(runtimeResult.counters.confirmationSignatures.length > 1);
    assert.equal(runtimeResult.counters.confirmationSignatures.every(([signature]) =>
      signature === runtimeResult.counters.transmittedSignatures[0]), true);
    assert.deepEqual(JSON.parse(readFileSync(timeoutFixture.statePath)).deployment.buffer.chunks.map(({ status }) => status), ["UNKNOWN", "PLANNED"]);
    await waitForFinalizedSignatures(connection, runtimeResult.counters.transmittedSignatures);
    await runtimeResult.dependencies.rpcRequestScheduler.close();
    runtimeResult = runtimeDependencies(timeoutFixture, "confirmation-timeout-reconciliation");
    await releaseWindow(timeoutFixture, "confirmation-timeout", runtimeResult.dependencies);
    await runtimeResult.dependencies.rpcRequestScheduler.close();
    t.diagnostic("confirmation timeout preserved one send and blocked next chunk");

    const abortFixture = await makeFixture("abort-during-wait", 1);
    runtimeResult = runtimeDependencies(abortFixture, "abort-during-wait", "abort-wait");
    await assert.rejects(executeUploadWindow(abortFixture.request, runtimeResult.dependencies), /injected abort during wait/);
    assert.equal(runtimeResult.counters.signerLoads, 0);
    assert.equal(runtimeResult.counters.sendTransportCalls, 0);
    assert.equal(existsSync(leasePaths(abortFixture.statePath).activeDirectory), false);
    assert.equal(runtimeResult.dependencies.rpcRequestScheduler.status().active, 0);
    assert.equal(runtimeResult.dependencies.rpcRequestScheduler.status().pending, 0);
    await runtimeResult.dependencies.rpcRequestScheduler.close();
    t.diagnostic("abort during paced wait prevented invocation and lease acquisition");

    authority = null;
    runtimeResult = null;
    runtimeResult = runtimeDependencies(recovery, "cold-resume");
    const resumed = await executeUploadWindow(recovery.request, runtimeResult.dependencies);
    allRecoverySendChunks.push(...runtimeResult.counters.sendChunks);
    assert.equal(resumed.status, "COMPLETE");
    assert.deepEqual(resumed.skippedIndexes, [0, 1, 2, 3, 4]);
    assert.deepEqual(runtimeResult.counters.sendChunks, [5]);
    assert.deepEqual(allRecoverySendChunks, [0, 1, 2, 3, 4, 5]);
    await waitForFinalizedSignatures(connection, runtimeResult.counters.transmittedSignatures);
    const finalAccount = await connection.getAccountInfo(recovery.buffer.publicKey, "confirmed");
    assert.equal(Buffer.from(finalAccount.data).subarray(METADATA_LENGTH).equals(recovery.localBytes), true);
    assert.deepEqual(JSON.parse(readFileSync(recovery.statePath)).deployment.buffer.chunks.map(({ status }) => status), ["CONFIRMED", "CONFIRMED", "CONFIRMED", "CONFIRMED", "CONFIRMED", "CONFIRMED"]);
    await releaseWindow(recovery, "cold-resume", runtimeResult.dependencies);
    await runtimeResult.dependencies.rpcRequestScheduler.close();
    t.diagnostic("scenario F complete and archived");

    assert.equal(maximumInFlight, 1);
    assert.ok(schedulerSleeps.some((ms) => ms === 3000));
    assert.ok(schedulerSleeps.some((ms) => ms === 2000));
    assert.ok(schedulerSleeps.some((ms) => ms === 5000));
    for (const ledger of requestLedgers) {
      const entries = ledger.debugSafeEntries();
      for (let index = 1; index < entries.length; index += 1) {
        assert.ok(entries[index].startMonotonicMs - entries[index - 1].startMonotonicMs >= 500);
      }
    }
  } finally {
    await stopOwnedValidator(validator);
    rmSync(runtime, { recursive: true, force: true });
  }
});
