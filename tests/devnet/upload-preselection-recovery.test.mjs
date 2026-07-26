import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createUploadTelemetryStore } from "../../scripts/devnet/upload-execution-telemetry.mjs";
import {
  leasePaths,
  reconcilePreSelectionUploadLease,
  recoverPreSelectionUploadLease,
} from "../../scripts/devnet/upload-execution-lease.mjs";

const OUTER_ID = "outer-fixture-1";
const INNER_ID = "inner-fixture-1";
const REPOSITORY_SHA = "a".repeat(40);
const BUFFER_SHA = "b".repeat(64);
const PROGRAM = "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z";
const BUFFER = "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW";
const AUTHORITY = "Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk";
const OWNER = "BPFLoaderUpgradeab1e11111111111111111111111";
const STARTED_AT = "2026-07-26T09:20:10.943Z";
const POLICY = Object.freeze({
  preSignCooldownMs: 3_000,
  globalRequestStartGapMs: 500,
  requestTimeoutMs: 15_000,
  confirmationPollIntervalMs: 2_000,
  rateLimitRetryScheduleMs: Object.freeze([2_000, 5_000]),
  interChunkDelayMs: 3_000,
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function telemetryEntry() {
  return {
    sequence: 1,
    methodClass: "GET_GENESIS_HASH",
    startMonotonicMs: 351.6283,
    endMonotonicMs: 598.6753,
    durationMs: 598.6753 - 351.6283,
    outcome: "SUCCESS",
    retryNumber: 0,
    signaturePersisted: false,
    mutationCapability: "read",
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "preselection-recovery-"));
  const statePath = join(root, "state.json");
  const activeDirectory = leasePaths(statePath).activeDirectory;
  const outerDirectory = join(root, "upload-window-host-results", OUTER_ID);
  mkdirSync(activeDirectory);
  mkdirSync(outerDirectory, { recursive: true });
  const state = {
    schemaVersion: 3,
    identities: { program: PROGRAM },
    deployment: {
      buffer: {
        publicKey: BUFFER,
        expectedOwner: OWNER,
        expectedAuthority: AUTHORITY,
        allocatedLength: 2_059,
        localBinary: { length: 2_022, sha256: "c".repeat(64) },
        planFingerprint: "d".repeat(64),
        chunks: [0, 1].map((index) => ({
          index,
          offset: index * 1_011,
          length: 1_011,
          sha256: String(index + 1).repeat(64),
          status: "PLANNED",
          signature: null,
        })),
        uploadWindows: [],
      },
    },
  };
  writeJson(statePath, state);
  const stateSha256 = sha256(readFileSync(statePath));
  const lease = {
    lifecycle: "ACTIVE",
    executionId: INNER_ID,
    pid: 21720,
    hostname: "test-host",
    startedAt: STARTED_AT,
    program: PROGRAM,
    buffer: BUFFER,
    planFingerprint: state.deployment.buffer.planFingerprint,
    stateSha256AtAcquire: stateSha256,
  };
  writeJson(join(activeDirectory, "lease.json"), lease);
  const telemetry = createUploadTelemetryStore({
    directory: activeDirectory,
    executionId: INNER_ID,
    startedAt: STARTED_AT,
    startMonotonicMs: 350.7077,
    policy: POLICY,
  });
  telemetry.recordRpcEntry(telemetryEntry());

  const stdout = `${JSON.stringify({
    classification: "UPLOAD_PROCESS_EXITED",
    uploaderInvocationCount: 1,
    childExitCode: 1,
    childSignal: null,
    cleanupCompleted: true,
  })}\n`;
  const stderr = `${JSON.stringify({
    code: "TELEMETRY_REPLAY_VALIDATION_FAILED",
    phase: "TELEMETRY_REPLAY",
    retryable: false,
    terminal: true,
  })}\n`;
  writeFileSync(join(outerDirectory, "supervisor-stdout.log"), stdout);
  writeFileSync(join(outerDirectory, "supervisor-stderr.log"), stderr);
  const expectedManifest = {
    expectedRepositorySha: REPOSITORY_SHA,
    expectedStateSha: stateSha256,
    expectedBufferSha: BUFFER_SHA,
    expectedCandidates: [0, 1],
    expectedInvocations: 1,
  };
  writeJson(join(outerDirectory, "authorization.json"), {
    schemaVersion: "UPLOAD_WINDOW_HOST_AUTHORIZATION_V2",
    executionId: OUTER_ID,
    consumedAt: "2026-07-26T09:20:09.395Z",
    hostPid: 24840,
    expectedManifest,
    expectedInvocations: 1,
    retryAllowed: false,
  });
  writeJson(join(outerDirectory, "invocation.json"), {
    schemaVersion: "UPLOAD_WINDOW_HOST_INVOCATION_V1",
    executionId: OUTER_ID,
    hostPid: 24840,
    childPid: 11952,
    childSpawnCount: 1,
    spawnedAt: "2026-07-26T09:20:10.305Z",
    retryOccurred: false,
  });
  writeJson(join(outerDirectory, "host-result.json"), {
    schemaVersion: "UPLOAD_WINDOW_HOST_RESULT_V2",
    executionId: OUTER_ID,
    expectedManifest,
    hostPid: 24840,
    childPid: 11952,
    childSpawnCount: 1,
    childExitCode: 1,
    startedAt: "2026-07-26T09:20:09.395Z",
    finishedAt: "2026-07-26T09:20:14.750Z",
    verdict: "HOST_CHILD_NONZERO",
    retryOccurred: false,
    innerTerminalStatus: "VALID",
    innerTerminalResult: {
      classification: "UPLOAD_PROCESS_EXITED",
      uploaderInvocationCount: 1,
      childExitCode: 1,
      childSignal: null,
      cleanupCompleted: true,
    },
    stdout: {
      bytes: Buffer.byteLength(stdout),
      sha256: sha256(Buffer.from(stdout)),
    },
    stderr: {
      bytes: Buffer.byteLength(stderr),
      sha256: sha256(Buffer.from(stderr)),
    },
  });

  const expected = {
    leasePath: activeDirectory,
    leaseSha256: sha256(readFileSync(join(activeDirectory, "lease.json"))),
    evidenceSha256: sha256(readFileSync(join(activeDirectory, "telemetry.json"))),
    outerExecutionId: OUTER_ID,
    innerExecutionId: INNER_ID,
    repositorySha: REPOSITORY_SHA,
    stateSha256,
    bufferSha256: BUFFER_SHA,
    program: PROGRAM,
    buffer: BUFFER,
    authority: AUTHORITY,
    candidateIndexes: [0, 1],
    zeroSend: true,
    deadOwner: true,
  };
  const input = {
    statePath,
    outerEvidenceDirectory: outerDirectory,
    expected,
    observations: {
      repositorySha: REPOSITORY_SHA,
      bufferDataSha256: BUFFER_SHA,
      programAbsent: true,
      confirmedChunksMatch: true,
      buffer: {
        address: BUFFER,
        owner: OWNER,
        authority: AUTHORITY,
        allocation: state.deployment.buffer.allocatedLength,
      },
      retainedProcessesClear: true,
      operationLockAbsent: true,
    },
  };
  return { root, statePath, activeDirectory, outerDirectory, state, input };
}

const deadOwner = Object.freeze({ ownerProcessStatus: () => "DEAD" });
const recoveryAdapters = Object.freeze({
  ...deadOwner,
  refreshInput: async (input) => input,
});

test("incident-shaped pre-selection evidence is recovery eligible only with complete zero-send proof", () => {
  const value = fixture();
  const result = reconcilePreSelectionUploadLease(value.input, deadOwner);
  assert.equal(result.result, "RECOVERY_ELIGIBLE");
  assert.equal(result.lifecycle, "FAILED_PRE_SELECTION_STALE_SAFE");
  assert.match(result.recoveryHash, /^[a-f0-9]{64}$/);
  assert.equal(result.stateMutation, false);
  assert.equal(result.onchainWrite, false);
});

test("pre-selection reconciliation rejects every ambiguous ownership or evidence boundary", () => {
  const cases = [
    {
      name: "live owner",
      mutate() {},
      adapters: { ownerProcessStatus: () => "LIVE" },
    },
    {
      name: "ambiguous owner",
      mutate() {},
      adapters: { ownerProcessStatus: () => "AMBIGUOUS" },
    },
    {
      name: "lease hash",
      mutate(value) { value.input.expected.leaseSha256 = "0".repeat(64); },
      adapters: deadOwner,
    },
    {
      name: "execution ID",
      mutate(value) { value.input.expected.innerExecutionId = "different-inner"; },
      adapters: deadOwner,
    },
    {
      name: "state drift",
      mutate(value) {
        const state = JSON.parse(readFileSync(value.statePath));
        state.deployment.buffer.uploadWindows.push({ terminal: false });
        writeJson(value.statePath, state);
      },
      adapters: deadOwner,
    },
    {
      name: "buffer drift",
      mutate(value) { value.input.observations.bufferDataSha256 = "0".repeat(64); },
      adapters: deadOwner,
    },
    {
      name: "retained process",
      mutate(value) { value.input.observations.retainedProcessesClear = false; },
      adapters: deadOwner,
    },
    {
      name: "operation lock",
      mutate(value) { value.input.observations.operationLockAbsent = false; },
      adapters: deadOwner,
    },
    {
      name: "candidate signature",
      mutate(value) {
        const state = JSON.parse(readFileSync(value.statePath));
        state.deployment.buffer.chunks[0].signature = "public-signature";
        writeJson(value.statePath, state);
        value.input.expected.stateSha256 = sha256(readFileSync(value.statePath));
      },
      adapters: deadOwner,
    },
    {
      name: "candidate SENT",
      mutate(value) {
        const state = JSON.parse(readFileSync(value.statePath));
        state.deployment.buffer.chunks[0].status = "SENT";
        writeJson(value.statePath, state);
        value.input.expected.stateSha256 = sha256(readFileSync(value.statePath));
      },
      adapters: deadOwner,
    },
    {
      name: "candidate UNKNOWN",
      mutate(value) {
        const state = JSON.parse(readFileSync(value.statePath));
        state.deployment.buffer.chunks[0].status = "UNKNOWN";
        writeJson(value.statePath, state);
        value.input.expected.stateSha256 = sha256(readFileSync(value.statePath));
      },
      adapters: deadOwner,
    },
    {
      name: "non-candidate SENT",
      mutate(value) {
        const state = JSON.parse(readFileSync(value.statePath));
        state.deployment.buffer.chunks.push({
          index: 2,
          offset: 2_022,
          length: 1,
          sha256: "3".repeat(64),
          status: "SENT",
          signature: "public-signature",
        });
        writeJson(value.statePath, state);
        value.input.expected.stateSha256 = sha256(readFileSync(value.statePath));
      },
      adapters: deadOwner,
    },
    {
      name: "outer-to-inner time substitution",
      mutate(value) {
        const invocationPath = join(value.outerDirectory, "invocation.json");
        const invocation = JSON.parse(readFileSync(invocationPath));
        invocation.spawnedAt = "2026-07-26T09:21:10.305Z";
        writeJson(invocationPath, invocation);
      },
      adapters: deadOwner,
    },
    {
      name: "outer process-chain mismatch",
      mutate(value) {
        const hostResultPath = join(value.outerDirectory, "host-result.json");
        const hostResult = JSON.parse(readFileSync(hostResultPath));
        hostResult.childPid += 1;
        writeJson(hostResultPath, hostResult);
      },
      adapters: deadOwner,
    },
    {
      name: "send evidence",
      mutate(value) {
        const telemetry = createUploadTelemetryStore({
          directory: value.activeDirectory,
          executionId: INNER_ID,
          startedAt: STARTED_AT,
          startMonotonicMs: 350.7077,
          policy: POLICY,
        });
        telemetry.recordPreSignCooldown({
          chunkIndex: 0,
          required: true,
          startedMonotonicMs: 1_000,
          finishedMonotonicMs: 4_000,
        });
        telemetry.recordSendStart({ chunkIndex: 0, monotonicMs: 4_000 });
        value.input.expected.evidenceSha256 = sha256(
          readFileSync(join(value.activeDirectory, "telemetry.json")),
        );
      },
      adapters: deadOwner,
    },
    {
      name: "unexpected lease file",
      mutate(value) { writeFileSync(join(value.activeDirectory, "unexpected.bin"), "x"); },
      adapters: deadOwner,
    },
    {
      name: "missing outer evidence",
      mutate(value) { value.input.outerEvidenceDirectory = join(value.root, "missing"); },
      adapters: deadOwner,
    },
  ];
  for (const scenario of cases) {
    const value = fixture();
    scenario.mutate(value);
    const result = reconcilePreSelectionUploadLease(value.input, scenario.adapters);
    assert.equal(result.result, "RECOVERY_INELIGIBLE", scenario.name);
  }
});

test("authorized recovery writes a hash-bound result before archiving only the bound lease", async () => {
  const value = fixture();
  const stateBytes = readFileSync(value.statePath);
  const decoy = join(value.root, "unrelated-lease");
  mkdirSync(decoy);
  writeFileSync(join(decoy, "lease.json"), "decoy");
  const eligible = reconcilePreSelectionUploadLease(value.input, deadOwner);
  const archiveEvents = [];
  const request = {
    ...value.input,
    recoveryHash: eligible.recoveryHash,
    acknowledgement: "R4_RECOVER_PRE_SELECTION_LEASE",
  };
  const first = await recoverPreSelectionUploadLease(request, {
    ...recoveryAdapters,
    now: () => "2026-07-26T10:00:00.000Z",
    renameSync(source, destination) {
      archiveEvents.push("rename");
      renameSync(source, destination);
    },
    flushDirectory() {
      archiveEvents.push("flush");
    },
  });
  const archiveDirectory = leasePaths(
    value.statePath,
    INNER_ID,
    eligible.recoveryHash,
  ).archiveDirectory;
  assert.equal(first.lifecycle, "ARCHIVED/RECOVERED");
  assert.equal(first.idempotent, false);
  assert.equal(existsSync(value.activeDirectory), false);
  assert.equal(existsSync(archiveDirectory), true);
  assert.equal(existsSync(join(archiveDirectory, "recovery.json")), true);
  assert.deepEqual(archiveEvents, ["rename", "flush", "flush"]);
  assert.deepEqual(readFileSync(value.statePath), stateBytes);
  assert.equal(readFileSync(join(decoy, "lease.json"), "utf8"), "decoy");

  const second = await recoverPreSelectionUploadLease(request, {
    ...recoveryAdapters,
    now: () => "2026-07-26T10:00:01.000Z",
  });
  assert.equal(second.idempotent, true);
  assert.equal(second.recoveryHash, first.recoveryHash);
});

test("archive failure preserves the eligible active lease and does not change state", async () => {
  const value = fixture();
  const stateBytes = readFileSync(value.statePath);
  const eligible = reconcilePreSelectionUploadLease(value.input, deadOwner);
  await assert.rejects(() => recoverPreSelectionUploadLease({
    ...value.input,
    recoveryHash: eligible.recoveryHash,
    acknowledgement: "R4_RECOVER_PRE_SELECTION_LEASE",
  }, {
    ...recoveryAdapters,
    renameSync() {
      throw new Error("injected archive failure");
    },
  }), /archive failure/);
  assert.equal(existsSync(value.activeDirectory), true);
  assert.deepEqual(readFileSync(value.statePath), stateBytes);
});

test("a different lease path cannot reuse another recovery authorization", async () => {
  const first = fixture();
  const second = fixture();
  const firstEligible = reconcilePreSelectionUploadLease(first.input, deadOwner);
  const secondEligible = reconcilePreSelectionUploadLease(second.input, deadOwner);
  assert.notEqual(firstEligible.recoveryHash, secondEligible.recoveryHash);
  await assert.rejects(() => recoverPreSelectionUploadLease({
    ...second.input,
    recoveryHash: firstEligible.recoveryHash,
    acknowledgement: "R4_RECOVER_PRE_SELECTION_LEASE",
  }, recoveryAdapters), /STALE|DRIFT|evidence/i);
  assert.equal(existsSync(second.activeDirectory), true);
});

test("recovery refreshes process and finalized observations while owning the lock", async () => {
  const value = fixture();
  const eligible = reconcilePreSelectionUploadLease(value.input, deadOwner);
  await assert.rejects(
    () => recoverPreSelectionUploadLease({
      ...value.input,
      recoveryHash: eligible.recoveryHash,
      acknowledgement: "R4_RECOVER_PRE_SELECTION_LEASE",
    }, {
      ...deadOwner,
      async refreshInput(input) {
        assert.equal(
          existsSync(`${value.statePath}.upload-lease-operation-lock`),
          true,
        );
        return {
          ...input,
          observations: {
            ...input.observations,
            retainedProcessesClear: false,
          },
        };
      },
    }),
    /STALE|DRIFT|evidence/i,
  );
  assert.equal(existsSync(value.activeDirectory), true);
});

test("idempotent recovery rejects corrupted archived evidence", async () => {
  const value = fixture();
  const eligible = reconcilePreSelectionUploadLease(value.input, deadOwner);
  const request = {
    ...value.input,
    recoveryHash: eligible.recoveryHash,
    acknowledgement: "R4_RECOVER_PRE_SELECTION_LEASE",
  };
  await recoverPreSelectionUploadLease(request, recoveryAdapters);
  const archiveDirectory = leasePaths(
    value.statePath,
    INNER_ID,
    eligible.recoveryHash,
  ).archiveDirectory;
  writeFileSync(join(archiveDirectory, "telemetry.json"), "{}\n");
  await assert.rejects(
    () => recoverPreSelectionUploadLease(request, recoveryAdapters),
    /archived pre-selection/i,
  );
});
