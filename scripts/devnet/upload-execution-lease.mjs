import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync as nodeRenameSync,
  writeFileSync,
} from "node:fs";
import { hostname as currentHostname } from "node:os";
import { dirname, join } from "node:path";

import { RELEASE_LEASE_ACKNOWLEDGEMENT } from "./upload-execution-contract.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function leasePaths(statePath, executionId, evidenceHash) {
  const activeDirectory = `${statePath}.upload-lease`;
  const archiveRoot = join(dirname(statePath), "history", "upload-leases");
  return {
    activeDirectory,
    metadataPath: join(activeDirectory, "lease.json"),
    archiveRoot,
    archiveDirectory: executionId && evidenceHash
      ? join(archiveRoot, `${executionId}--${evidenceHash}`)
      : null,
  };
}

function validateAcquireInput(input) {
  const stringFields = ["executionId", "hostname", "startedAt", "program", "buffer", "planFingerprint", "stateSha256"];
  if (!Number.isInteger(input.pid) || input.pid < 1 || stringFields.some((field) => typeof input[field] !== "string" || input[field].length === 0)) {
    throw new Error("complete public lease metadata is required");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.planFingerprint) || !/^[a-f0-9]{64}$/i.test(input.stateSha256)) {
    throw new Error("complete public lease metadata is required");
  }
}

export function acquireUploadLease(input) {
  validateAcquireInput(input);
  if (sha256(readFileSync(input.statePath)) !== input.stateSha256) {
    throw new Error("STATE_HASH_DRIFT before lease acquisition");
  }
  const paths = leasePaths(input.statePath);
  try {
    mkdirSync(paths.activeDirectory);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("ACTIVE_UPLOAD_LEASE already exists");
    throw error;
  }
  const metadata = {
    lifecycle: "ACTIVE",
    executionId: input.executionId,
    pid: input.pid,
    hostname: input.hostname,
    startedAt: input.startedAt,
    program: input.program,
    buffer: input.buffer,
    planFingerprint: input.planFingerprint,
    stateSha256AtAcquire: input.stateSha256,
  };
  const temporary = join(paths.activeDirectory, "lease.json.tmp");
  writeFileSync(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
  nodeRenameSync(temporary, paths.metadataPath);
  return { status: "ACTIVE", executionId: input.executionId, stateMutation: true, onchainWrite: false };
}

function failure(result, lifecycle = "RECONCILIATION_REQUIRED") {
  return {
    command: "reconcile-upload-lease",
    result,
    lifecycle,
    stateMutation: false,
    onchainWrite: false,
  };
}

function defaultProcessIsActive(pid, recordedHostname) {
  if (recordedHostname !== currentHostname()) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function completeLease(lease) {
  return lease?.lifecycle === "ACTIVE" &&
    typeof lease.executionId === "string" &&
    Number.isInteger(lease.pid) && lease.pid > 0 &&
    typeof lease.hostname === "string" && lease.hostname.length > 0 &&
    typeof lease.startedAt === "string" && lease.startedAt.length > 0 &&
    typeof lease.program === "string" &&
    typeof lease.buffer === "string" &&
    /^[a-f0-9]{64}$/i.test(lease.planFingerprint ?? "") &&
    /^[a-f0-9]{64}$/i.test(lease.stateSha256AtAcquire ?? "");
}

function reconcileAtDirectory(input, adapters, leaseDirectory) {
  let lease;
  let state;
  let stateBytes;
  try {
    lease = readJson(join(leaseDirectory, "lease.json"));
    stateBytes = readFileSync(input.statePath);
    state = JSON.parse(stateBytes.toString("utf8"));
  } catch {
    return failure("INSUFFICIENT_EVIDENCE");
  }
  if (!completeLease(lease) || lease.executionId !== input.executionId) {
    return failure("INSUFFICIENT_EVIDENCE");
  }
  const processIsActive = adapters.processIsActive ?? defaultProcessIsActive;
  if (processIsActive(lease.pid, lease.hostname)) return failure("ACTIVE_PROCESS", "ACTIVE");

  const buffer = state?.deployment?.buffer;
  if (state?.schemaVersion !== 3 || !buffer || !Array.isArray(buffer.chunks) || !Array.isArray(buffer.uploadWindows)) {
    return failure("INSUFFICIENT_EVIDENCE");
  }
  if (buffer.chunks.some((chunk) => chunk.status === "SENT" || chunk.status === "UNKNOWN")) {
    return failure("UNRESOLVED_SENT_OR_UNKNOWN");
  }
  const expected = input.expected;
  const observed = input.observations;
  const identityMatches =
    lease.program === expected.program &&
    lease.buffer === expected.buffer &&
    lease.planFingerprint === expected.planFingerprint &&
    state.identities?.program === expected.program &&
    buffer.publicKey === expected.buffer &&
    buffer.expectedAuthority === expected.authority &&
    buffer.expectedOwner === expected.owner &&
    buffer.allocatedLength === expected.allocation &&
    buffer.planFingerprint === expected.planFingerprint;
  const onchainMatches =
    observed?.genesisVerified === true &&
    observed?.programAbsent === true &&
    observed?.confirmedChunksMatch === true &&
    observed?.buffer?.address === expected.buffer &&
    observed?.buffer?.owner === expected.owner &&
    observed?.buffer?.authority === expected.authority &&
    observed?.buffer?.allocation === expected.allocation &&
    observed?.buffer?.planFingerprint === expected.planFingerprint;
  if (!identityMatches || !onchainMatches) return failure("IDENTITY_OR_ONCHAIN_MISMATCH");

  const terminalOutcome = buffer.uploadWindows.find((window) =>
    window?.executionId === input.executionId && window.terminal === true,
  );
  if (!terminalOutcome) return failure("INSUFFICIENT_EVIDENCE");
  const stateSha256 = sha256(stateBytes);
  const evidenceHash = sha256(Buffer.from(JSON.stringify({
    executionId: input.executionId,
    stateSha256,
    lease: {
      program: lease.program,
      buffer: lease.buffer,
      planFingerprint: lease.planFingerprint,
      stateSha256AtAcquire: lease.stateSha256AtAcquire,
    },
    expected,
    observations: observed,
    terminalOutcome,
  })));
  return {
    command: "reconcile-upload-lease",
    result: "SAFE_TO_RELEASE",
    lifecycle: "SAFE_TO_RELEASE",
    executionId: input.executionId,
    stateSha256,
    evidenceHash,
    stateMutation: false,
    onchainWrite: false,
  };
}

export function reconcileUploadLease(input, adapters = {}) {
  return reconcileAtDirectory(input, adapters, leasePaths(input.statePath).activeDirectory);
}

export function releaseUploadLease(input, adapters = {}) {
  if (input.acknowledgement !== RELEASE_LEASE_ACKNOWLEDGEMENT) {
    throw new Error("explicit lease-release acknowledgement is required");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.reconciliationHash ?? "")) {
    throw new Error("matching reconciliation hash is required");
  }
  const paths = leasePaths(input.statePath, input.executionId, input.reconciliationHash);
  const activeExists = existsSync(paths.activeDirectory);
  const archiveExists = existsSync(paths.archiveDirectory);
  if (!activeExists && !archiveExists) throw new Error("matching upload lease was not found");

  const directory = activeExists ? paths.activeDirectory : paths.archiveDirectory;
  const fresh = reconcileAtDirectory(input, adapters, directory);
  if (fresh.result !== "SAFE_TO_RELEASE") {
    throw new Error(`lease is not SAFE_TO_RELEASE: ${fresh.result}`);
  }
  if (fresh.evidenceHash !== input.reconciliationHash) {
    throw new Error("STATE_HASH_DRIFT_OR_STALE_EVIDENCE");
  }
  if (!activeExists) {
    return {
      command: "release-upload-lease",
      lifecycle: "ARCHIVED/RELEASED",
      executionId: input.executionId,
      evidenceHash: fresh.evidenceHash,
      idempotent: true,
      stateMutation: false,
      onchainWrite: false,
    };
  }
  mkdirSync(paths.archiveRoot, { recursive: true });
  const rename = adapters.renameSync ?? nodeRenameSync;
  try {
    rename(paths.activeDirectory, paths.archiveDirectory);
  } catch (error) {
    throw new Error(`atomic lease archive failed: ${error.message}`);
  }
  return {
    command: "release-upload-lease",
    lifecycle: "ARCHIVED/RELEASED",
    executionId: input.executionId,
    evidenceHash: fresh.evidenceHash,
    idempotent: false,
    stateMutation: true,
    onchainWrite: false,
  };
}
