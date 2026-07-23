import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync as nodeRenameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { hostname as currentHostname } from "node:os";
import { dirname, join } from "node:path";

import {
  APPLY_RECONCILIATION_ACKNOWLEDGEMENT,
  RELEASE_LEASE_ACKNOWLEDGEMENT,
} from "./upload-execution-contract.mjs";
import { saveStateAtomic, validateChunkRecords } from "./state.mjs";
import { createPlanFingerprint } from "./throttled-uploader.mjs";
import { deriveMaxWritePayload } from "./upload-plan.mjs";
import { readUploadTelemetry } from "./upload-execution-telemetry.mjs";

const RECONCILIATION_PROOF_VERSION = "UPLOAD_LEASE_RECONCILIATION_V2";
const ONCHAIN_PROOF_VERSION = "UPLOAD_LEASE_ONCHAIN_V1";
const APPLY_RECEIPT_VERSION = "UPLOAD_RECONCILIATION_V1";
const RELEASE_RECEIPT_VERSION = "UPLOAD_LEASE_RELEASE_V1";
const HEX_64 = /^[a-f0-9]{64}$/;
const SAFE_EXECUTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalHash(domain, value) {
  return sha256(Buffer.from(canonicalJson({ domain, value })));
}

function serializedStateBytes(state) {
  return Buffer.from(`${JSON.stringify(state, null, 2)}\n`);
}

function assertSafeExecutionId(executionId) {
  if (typeof executionId !== "string" || !SAFE_EXECUTION_ID.test(executionId)) {
    throw new Error("safe execution ID is required");
  }
}

function assertEvidenceHash(evidenceHash, label = "matching reconciliation hash") {
  if (typeof evidenceHash !== "string" || !HEX_64.test(evidenceHash)) {
    throw new Error(`${label} is required`);
  }
}

export function leasePaths(statePath, executionId, evidenceHash) {
  if (executionId !== undefined && executionId !== null) assertSafeExecutionId(executionId);
  if (evidenceHash !== undefined && evidenceHash !== null) assertEvidenceHash(evidenceHash);
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
  assertSafeExecutionId(input.executionId);
  const stringFields = ["hostname", "startedAt", "program", "buffer", "planFingerprint", "stateSha256"];
  if (!Number.isInteger(input.pid) || input.pid < 1 || stringFields.some((field) => typeof input[field] !== "string" || input[field].length === 0)) {
    throw new Error("complete public lease metadata is required");
  }
  if (!HEX_64.test(input.planFingerprint) || !HEX_64.test(input.stateSha256)) {
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
    SAFE_EXECUTION_ID.test(lease.executionId ?? "") &&
    Number.isInteger(lease.pid) && lease.pid > 0 &&
    typeof lease.hostname === "string" && lease.hostname.length > 0 &&
    typeof lease.startedAt === "string" && lease.startedAt.length > 0 &&
    typeof lease.program === "string" && lease.program.length > 0 &&
    typeof lease.buffer === "string" && lease.buffer.length > 0 &&
    HEX_64.test(lease.planFingerprint ?? "") &&
    HEX_64.test(lease.stateSha256AtAcquire ?? "");
}

function validateStoredPlan(state, expected) {
  if (state?.schemaVersion !== 3 || !expected || !HEX_64.test(expected.binarySha256 ?? "")) return false;
  const buffer = state.deployment?.buffer;
  if (!buffer || !Array.isArray(buffer.uploadWindows)) return false;
  const checks = [
    [state.identities?.program, expected.program],
    [buffer.publicKey, expected.buffer],
    [buffer.expectedAuthority, expected.authority],
    [buffer.expectedOwner, expected.owner],
    [buffer.allocatedLength, expected.allocation],
    [buffer.localBinary?.length, expected.binaryLength],
    [buffer.localBinary?.sha256, expected.binarySha256],
    [buffer.planFingerprint, expected.planFingerprint],
  ];
  if (checks.some(([actual, wanted]) => actual !== wanted)) return false;
  if (!Number.isInteger(expected.binaryLength) || expected.binaryLength < 1 || expected.allocation !== expected.binaryLength + 37) return false;
  try {
    validateChunkRecords(buffer.chunks);
    if (buffer.chunks.reduce((total, chunk) => total + chunk.length, 0) !== expected.binaryLength) return false;
    const maxPayload = deriveMaxWritePayload({ buffer: expected.buffer, authority: expected.authority });
    const fingerprint = createPlanFingerprint({
      program: expected.program,
      buffer: expected.buffer,
      authority: expected.authority,
      allocation: expected.allocation,
      binarySha256: expected.binarySha256,
      maxPayload,
      chunks: buffer.chunks,
    });
    return fingerprint === expected.planFingerprint;
  } catch {
    return false;
  }
}

function uniqueTerminalOutcome(state, executionId) {
  const windows = state?.deployment?.buffer?.uploadWindows;
  if (!Array.isArray(windows)) return null;
  const matches = windows.filter((window) => window?.executionId === executionId && window.terminal === true);
  return matches.length === 1 ? matches[0] : null;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function completeTransactionEvidence(value) {
  const required = [
    "chunkIndex", "recordedStatus", "signature", "signatureStatusFound",
    "confirmationStatus", "statusSlot", "statusErr", "transactionFound",
    "transactionSignature", "signatureCount", "slot", "feeLamports", "metaErr",
    "legacyMessage", "instructionCount", "innerInstructionCount",
    "instructionDecoded", "program", "accountCount", "buffer", "authority",
    "bufferWritable", "authoritySigner", "offset", "payloadLength",
    "payloadSha256", "payloadExactMatch", "onchainLength", "onchainSha256",
    "onchainExactMatch", "snapshotSlot",
  ];
  return value !== null && typeof value === "object" && required.every((key) => hasOwn(value, key));
}

function transactionProjection(value) {
  return {
    chunkIndex: value.chunkIndex,
    recordedStatus: value.recordedStatus,
    signature: value.signature,
    confirmationStatus: value.confirmationStatus,
    statusSlot: value.statusSlot,
    statusErr: value.statusErr,
    transactionSignature: value.transactionSignature,
    signatureCount: value.signatureCount,
    slot: value.slot,
    feeLamports: value.feeLamports,
    metaErr: value.metaErr,
    legacyMessage: value.legacyMessage,
    instructionCount: value.instructionCount,
    innerInstructionCount: value.innerInstructionCount,
    instructionDecoded: value.instructionDecoded,
    program: value.program,
    accountCount: value.accountCount,
    buffer: value.buffer,
    authority: value.authority,
    bufferWritable: value.bufferWritable,
    authoritySigner: value.authoritySigner,
    offset: value.offset,
    payloadLength: value.payloadLength,
    payloadSha256: value.payloadSha256,
    payloadExactMatch: value.payloadExactMatch,
    onchainLength: value.onchainLength,
    onchainSha256: value.onchainSha256,
    onchainExactMatch: value.onchainExactMatch,
  };
}

function evaluateChunkProofs(chunks, observations, expected, receiptTargets = []) {
  const proofTargets = [
    ...chunks
      .filter((chunk) => chunk.status === "SENT" || chunk.status === "UNKNOWN")
      .map((chunk) => ({ chunk, from: chunk.status, proposed: true })),
    ...receiptTargets.map(({ chunk, from }) => ({ chunk, from, proposed: false })),
  ];
  if (new Set(proofTargets.map(({ chunk }) => chunk.index)).size !== proofTargets.length) {
    return { failure: "INSUFFICIENT_EVIDENCE" };
  }
  const transactions = observations?.transactions;
  if (!Array.isArray(transactions) || transactions.length !== proofTargets.length) {
    return { failure: "INSUFFICIENT_EVIDENCE" };
  }
  const byIndex = new Map();
  for (const evidence of transactions) {
    if (!Number.isInteger(evidence?.chunkIndex) || byIndex.has(evidence.chunkIndex)) return { failure: "INSUFFICIENT_EVIDENCE" };
    byIndex.set(evidence.chunkIndex, evidence);
  }
  const transitions = [];
  const verifiedTransactions = [];
  const normalizedTransactions = [];
  for (const target of proofTargets) {
    const { chunk } = target;
    const evidence = byIndex.get(chunk.index);
    if (!evidence) return { failure: "INSUFFICIENT_EVIDENCE" };
    if (!hasOwn(evidence, "signatureStatusFound") || !hasOwn(evidence, "transactionFound")) return { failure: "INSUFFICIENT_EVIDENCE" };
    if (evidence.signatureStatusFound !== true || evidence.transactionFound !== true || evidence.confirmationStatus !== "finalized") {
      return { failure: "UNRESOLVED_SENT_OR_UNKNOWN" };
    }
    if (!completeTransactionEvidence(evidence)) return { failure: "INSUFFICIENT_EVIDENCE" };
    if (typeof evidence.statusErr !== "boolean" || typeof evidence.metaErr !== "boolean") return { failure: "INSUFFICIENT_EVIDENCE" };
    if (evidence.statusErr || evidence.metaErr) return { failure: "CONFIRMED_TRANSACTION_FAILURE" };
    const integers = [evidence.statusSlot, evidence.signatureCount, evidence.slot, evidence.feeLamports, evidence.instructionCount, evidence.innerInstructionCount, evidence.accountCount, evidence.offset, evidence.payloadLength, evidence.onchainLength, evidence.snapshotSlot];
    if (integers.some((item) => !Number.isSafeInteger(item) || item < 0) || !HEX_64.test(evidence.payloadSha256 ?? "") || !HEX_64.test(evidence.onchainSha256 ?? "")) {
      return { failure: "INSUFFICIENT_EVIDENCE" };
    }
    const transactionMatches =
      evidence.recordedStatus === target.from &&
      evidence.signature === chunk.signature &&
      evidence.transactionSignature === chunk.signature &&
      evidence.signatureCount === 1 &&
      evidence.statusSlot === evidence.slot &&
      evidence.legacyMessage === true &&
      evidence.instructionCount === 1 &&
      evidence.innerInstructionCount === 0 &&
      evidence.instructionDecoded === true &&
      evidence.program === expected.owner &&
      evidence.accountCount === 2 &&
      evidence.buffer === expected.buffer &&
      evidence.authority === expected.authority &&
      evidence.bufferWritable === true &&
      evidence.authoritySigner === true &&
      evidence.offset === chunk.offset &&
      evidence.payloadLength === chunk.length &&
      evidence.payloadSha256 === chunk.sha256 &&
      evidence.payloadExactMatch === true;
    if (!transactionMatches) return { failure: "TRANSACTION_EVIDENCE_MISMATCH" };
    if (evidence.snapshotSlot < evidence.slot || observations.bufferContextSlot < evidence.slot) return { failure: "INSUFFICIENT_EVIDENCE" };
    const onchainMatches =
      evidence.onchainLength === chunk.length &&
      evidence.onchainSha256 === chunk.sha256 &&
      evidence.onchainExactMatch === true;
    if (!onchainMatches) return { failure: "IDENTITY_OR_ONCHAIN_MISMATCH" };
    if (target.proposed) {
      transitions.push({
        chunkIndex: chunk.index,
        from: target.from,
        to: "CONFIRMED",
        signature: chunk.signature,
        slot: evidence.slot,
        feeLamports: evidence.feeLamports,
        chunkSha256: chunk.sha256,
      });
    }
    verifiedTransactions.push({ chunkIndex: chunk.index, signature: chunk.signature, slot: evidence.slot, feeLamports: evidence.feeLamports });
    normalizedTransactions.push(transactionProjection(evidence));
  }
  return { transitions, verifiedTransactions, normalizedTransactions };
}

const RECEIPT_KEYS = ["appliedAt", "evidenceHash", "executionId", "leaseSha256", "onchainEvidenceFingerprint", "stateSha256Before", "transitions", "version"];
const TRANSITION_KEYS = ["chunkIndex", "chunkSha256", "feeLamports", "from", "signature", "slot", "to"];

function exactKeys(value, expectedKeys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...expectedKeys].sort().join("\0");
}

function appliedReceiptTargets(receipts, executionId, leaseSha256, chunks) {
  if (!Array.isArray(receipts) || receipts.length !== 1) return null;
  const [receipt] = receipts;
  if (!exactKeys(receipt, RECEIPT_KEYS) ||
      receipt.version !== APPLY_RECEIPT_VERSION ||
      receipt.executionId !== executionId ||
      typeof receipt.appliedAt !== "string" || receipt.appliedAt.length === 0 ||
      !HEX_64.test(receipt.evidenceHash ?? "") ||
      !HEX_64.test(receipt.stateSha256Before ?? "") ||
      !HEX_64.test(receipt.onchainEvidenceFingerprint ?? "") ||
      receipt.leaseSha256 !== leaseSha256 ||
      !Array.isArray(receipt.transitions) || receipt.transitions.length < 1) {
    return null;
  }
  const indices = new Set();
  const targets = [];
  for (const transition of receipt.transitions) {
    if (!exactKeys(transition, TRANSITION_KEYS) || !Number.isInteger(transition.chunkIndex) || indices.has(transition.chunkIndex)) return null;
    const chunk = chunks[transition.chunkIndex];
    if (!chunk ||
        (transition.from !== "SENT" && transition.from !== "UNKNOWN") ||
        transition.to !== "CONFIRMED" ||
        chunk.status !== "CONFIRMED" ||
        chunk.signature !== transition.signature ||
        chunk.sha256 !== transition.chunkSha256 ||
        !Number.isSafeInteger(transition.slot) || transition.slot < 0 ||
        !Number.isSafeInteger(transition.feeLamports) || transition.feeLamports < 0) {
      return null;
    }
    indices.add(transition.chunkIndex);
    targets.push({ chunk, from: transition.from, transition });
  }
  return { receipt, targets };
}

function verifiedAppliedReceipt(receiptInfo, onchainEvidenceFingerprint, normalizedTransactions) {
  if (!receiptInfo || receiptInfo.receipt.onchainEvidenceFingerprint !== onchainEvidenceFingerprint) {
    return false;
  }
  const byIndex = new Map(normalizedTransactions.map((transaction) => [transaction.chunkIndex, transaction]));
  return receiptInfo.targets.every(({ transition }) => {
    const transaction = byIndex.get(transition.chunkIndex);
    return transaction && transaction.recordedStatus === transition.from &&
      transaction.signature === transition.signature &&
      transaction.slot === transition.slot &&
      transaction.feeLamports === transition.feeLamports &&
      transaction.payloadSha256 === transition.chunkSha256 &&
      transaction.onchainSha256 === transition.chunkSha256;
  });
}

function reconstructReceiptPreState(state, receiptInfo, expected) {
  if (!receiptInfo) return null;
  const reconstructed = structuredClone(state);
  const terminalOutcome = uniqueTerminalOutcome(reconstructed, receiptInfo.receipt.executionId);
  const chunks = reconstructed?.deployment?.buffer?.chunks;
  if (!terminalOutcome || !Array.isArray(chunks) || !Array.isArray(terminalOutcome.reconciliationOutcomes) || terminalOutcome.reconciliationOutcomes.length !== 1) {
    return null;
  }
  delete terminalOutcome.reconciliationOutcomes;
  for (const { transition } of receiptInfo.targets) {
    const chunk = chunks[transition.chunkIndex];
    if (!chunk || chunk.status !== "CONFIRMED") return null;
    chunk.status = transition.from;
  }
  const unresolved = chunks.filter(({ status }) => status === "SENT" || status === "UNKNOWN");
  if (unresolved.length !== receiptInfo.targets.length) return null;
  const targetByIndex = new Map(receiptInfo.targets.map(({ transition }) => [transition.chunkIndex, transition]));
  if (!unresolved.every((chunk) => {
    const transition = targetByIndex.get(chunk.index);
    return transition && transition.from === chunk.status && transition.signature === chunk.signature && transition.chunkSha256 === chunk.sha256;
  })) {
    return null;
  }
  if (!validateStoredPlan(reconstructed, expected) || sha256(serializedStateBytes(reconstructed)) !== receiptInfo.receipt.stateSha256Before) {
    return null;
  }
  return { state: reconstructed, terminalOutcome };
}

function expectedEvidenceProjection(expected) {
  return {
    genesis: expected.genesis,
    program: expected.program,
    buffer: expected.buffer,
    authority: expected.authority,
    owner: expected.owner,
    allocation: expected.allocation,
    binaryLength: expected.binaryLength,
    binarySha256: expected.binarySha256,
    planFingerprint: expected.planFingerprint,
  };
}

function reconciliationEvidenceHash({
  executionId,
  preStateSha256,
  leaseSha256,
  lease,
  expected,
  terminalOutcome,
  onchainEvidenceFingerprint,
  normalizedTransactions,
  proposedTransitions,
}) {
  return canonicalHash(RECONCILIATION_PROOF_VERSION, {
    version: RECONCILIATION_PROOF_VERSION,
    executionId,
    preStateSha256,
    leaseSha256,
    lease: {
      executionId: lease.executionId,
      program: lease.program,
      buffer: lease.buffer,
      planFingerprint: lease.planFingerprint,
      stateSha256AtAcquire: lease.stateSha256AtAcquire,
    },
    expected: expectedEvidenceProjection(expected),
    terminalOutcomeSha256: canonicalHash("UPLOAD_WINDOW_TERMINAL_V1", terminalOutcome),
    onchainEvidenceFingerprint,
    transactions: normalizedTransactions,
    proposedTransitions,
  });
}

function reconcileAtDirectory(input, adapters, leaseDirectory) {
  let lease;
  let leaseBytes;
  let state;
  let stateBytes;
  try {
    assertSafeExecutionId(input.executionId);
    leaseBytes = readFileSync(join(leaseDirectory, "lease.json"));
    lease = JSON.parse(leaseBytes.toString("utf8"));
    stateBytes = readFileSync(input.statePath);
    state = JSON.parse(stateBytes.toString("utf8"));
  } catch {
    return failure("INSUFFICIENT_EVIDENCE");
  }
  if (!completeLease(lease) || lease.executionId !== input.executionId) return failure("INSUFFICIENT_EVIDENCE");
  const processIsActive = adapters.processIsActive ?? defaultProcessIsActive;
  if (processIsActive(lease.pid, lease.hostname)) return failure("ACTIVE_PROCESS", "ACTIVE");

  const preStateSha256 = sha256(stateBytes);
  const leaseSha256 = sha256(leaseBytes);
  if (input.expected?.stateSha256 !== preStateSha256) return failure("STATE_HASH_DRIFT");
  const storedBuffer = state?.deployment?.buffer;
  const storedIdentityMatches =
    state?.identities?.program === input.expected?.program &&
    storedBuffer?.publicKey === input.expected?.buffer &&
    storedBuffer?.expectedAuthority === input.expected?.authority &&
    storedBuffer?.expectedOwner === input.expected?.owner &&
    storedBuffer?.allocatedLength === input.expected?.allocation &&
    storedBuffer?.localBinary?.length === input.expected?.binaryLength &&
    storedBuffer?.localBinary?.sha256 === input.expected?.binarySha256 &&
    storedBuffer?.planFingerprint === input.expected?.planFingerprint;
  if (!storedIdentityMatches) return failure("IDENTITY_OR_ONCHAIN_MISMATCH");
  if (!validateStoredPlan(state, input.expected)) return failure("INSUFFICIENT_EVIDENCE");
  const buffer = state.deployment.buffer;
  const expected = input.expected;
  const observed = input.observations;
  const identityMatches =
    lease.program === expected.program &&
    lease.buffer === expected.buffer &&
    lease.planFingerprint === expected.planFingerprint;
  const onchainMatches =
    observed?.genesisVerified === true &&
    observed?.verifiedGenesis === expected.genesis &&
    observed?.programAbsent === true &&
    observed?.confirmedChunksMatch === true &&
    HEX_64.test(observed?.bufferDataSha256 ?? "") &&
    Number.isSafeInteger(observed?.programContextSlot) && observed.programContextSlot >= 0 &&
    Number.isSafeInteger(observed?.bufferContextSlot) && observed.bufferContextSlot >= 0 &&
    observed?.buffer?.address === expected.buffer &&
    observed?.buffer?.owner === expected.owner &&
    observed?.buffer?.authority === expected.authority &&
    observed?.buffer?.allocation === expected.allocation &&
    observed?.buffer?.planFingerprint === expected.planFingerprint;
  if (!identityMatches || !onchainMatches) return failure("IDENTITY_OR_ONCHAIN_MISMATCH");

  const terminalOutcome = uniqueTerminalOutcome(state, input.executionId);
  if (!terminalOutcome) return failure("INSUFFICIENT_EVIDENCE");
  const unresolvedCount = buffer.chunks.filter((chunk) => chunk.status === "SENT" || chunk.status === "UNKNOWN").length;
  const storedReceipts = terminalOutcome.reconciliationOutcomes;
  let receiptInfo = null;
  if (storedReceipts !== undefined) {
    receiptInfo = appliedReceiptTargets(storedReceipts, input.executionId, leaseSha256, buffer.chunks);
    if (!receiptInfo || unresolvedCount > 0) return failure("INSUFFICIENT_EVIDENCE");
  }
  if (terminalOutcome.status === "RPC_OUTCOME_UNKNOWN" && unresolvedCount === 0 && !receiptInfo) {
    return failure("INSUFFICIENT_EVIDENCE");
  }
  const evaluated = evaluateChunkProofs(buffer.chunks, observed, expected, receiptInfo?.targets ?? []);
  if (evaluated.failure) return failure(evaluated.failure);

  const minimumEvidenceSlot = evaluated.normalizedTransactions.reduce((maximum, item) => Math.max(maximum, item.slot), 0);
  const onchainProjection = {
    version: ONCHAIN_PROOF_VERSION,
    genesis: observed.verifiedGenesis,
    programAbsent: true,
    minimumEvidenceSlot,
    bufferDataSha256: observed.bufferDataSha256,
    buffer: {
      address: observed.buffer.address,
      owner: observed.buffer.owner,
      authority: observed.buffer.authority,
      allocation: observed.buffer.allocation,
    },
    confirmedChunksMatch: true,
    transactions: evaluated.normalizedTransactions,
  };
  const onchainEvidenceFingerprint = canonicalHash(ONCHAIN_PROOF_VERSION, onchainProjection);
  if (receiptInfo && !verifiedAppliedReceipt(receiptInfo, onchainEvidenceFingerprint, evaluated.normalizedTransactions)) {
    return failure("INSUFFICIENT_EVIDENCE");
  }
  if (receiptInfo) {
    const reconstructed = reconstructReceiptPreState(state, receiptInfo, expected);
    if (!reconstructed) return failure("INSUFFICIENT_EVIDENCE");
    const priorEvidenceHash = reconciliationEvidenceHash({
      executionId: input.executionId,
      preStateSha256: receiptInfo.receipt.stateSha256Before,
      leaseSha256,
      lease,
      expected,
      terminalOutcome: reconstructed.terminalOutcome,
      onchainEvidenceFingerprint,
      normalizedTransactions: evaluated.normalizedTransactions,
      proposedTransitions: receiptInfo.receipt.transitions,
    });
    if (priorEvidenceHash !== receiptInfo.receipt.evidenceHash) return failure("INSUFFICIENT_EVIDENCE");
  }
  const evidenceHash = reconciliationEvidenceHash({
    executionId: input.executionId,
    preStateSha256,
    leaseSha256,
    lease,
    expected,
    terminalOutcome,
    onchainEvidenceFingerprint,
    normalizedTransactions: evaluated.normalizedTransactions,
    proposedTransitions: evaluated.transitions,
  });
  return {
    command: "reconcile-upload-lease",
    result: "SAFE_TO_RELEASE",
    lifecycle: "SAFE_TO_RELEASE",
    executionId: input.executionId,
    releaseReady: evaluated.transitions.length === 0,
    preStateSha256,
    stateSha256: preStateSha256,
    leaseSha256,
    onchainEvidenceFingerprint,
    evidenceHash,
    verifiedTransactions: evaluated.verifiedTransactions,
    proposedTransitions: evaluated.transitions,
    stateMutation: false,
    onchainWrite: false,
  };
}

export function reconcileUploadLease(input, adapters = {}) {
  return reconcileAtDirectory(input, adapters, leasePaths(input.statePath).activeDirectory);
}

function matchingAppliedReceipt(state, executionId, evidenceHash, leaseSha256) {
  const outcome = uniqueTerminalOutcome(state, executionId);
  const chunks = state?.deployment?.buffer?.chunks;
  if (!outcome || !Array.isArray(chunks) || !Array.isArray(outcome.reconciliationOutcomes)) return null;
  const receiptInfo = appliedReceiptTargets(outcome.reconciliationOutcomes, executionId, leaseSha256, chunks);
  return receiptInfo?.receipt.evidenceHash === evidenceHash ? receiptInfo.receipt : null;
}

function restoreStateBytesAtomic(statePath, originalBytes) {
  const temporary = `${statePath}.reconciliation-rollback.tmp`;
  writeFileSync(temporary, originalBytes);
  nodeRenameSync(temporary, statePath);
  if (sha256(readFileSync(statePath)) !== sha256(originalBytes)) throw new Error("rollback verification failed");
}

function validateAppliedState(state, expected, executionId, receipt, leaseSha256) {
  const outcome = uniqueTerminalOutcome(state, executionId);
  const receiptInfo = appliedReceiptTargets(outcome?.reconciliationOutcomes, executionId, leaseSha256, state?.deployment?.buffer?.chunks);
  return validateStoredPlan(state, expected) &&
    receiptInfo?.receipt.evidenceHash === receipt.evidenceHash &&
    reconstructReceiptPreState(state, receiptInfo, expected) !== null;
}

function operationLockPath(statePath) {
  return `${statePath}.upload-lease-operation-lock`;
}

function acquireOperationLock(statePath) {
  const lockPath = operationLockPath(statePath);
  try {
    mkdirSync(lockPath);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("UPLOAD_LEASE_OPERATION_BUSY");
    throw error;
  }
  return lockPath;
}

export function applyUploadReconciliation(input, adapters = {}) {
  if (input.acknowledgement !== APPLY_RECONCILIATION_ACKNOWLEDGEMENT) {
    throw new Error("explicit upload-reconciliation acknowledgement is required");
  }
  assertEvidenceHash(input.reconciliationHash);
  const lockPath = acquireOperationLock(input.statePath);
  try {
    const fresh = reconcileUploadLease(input, adapters);
    if (fresh.result !== "SAFE_TO_RELEASE") throw new Error("STATE_HASH_DRIFT_OR_STALE_EVIDENCE");
    if (fresh.evidenceHash !== input.reconciliationHash) {
      const state = readJson(input.statePath);
      const receipt = matchingAppliedReceipt(state, input.executionId, input.reconciliationHash, fresh.leaseSha256);
      if (receipt && fresh.releaseReady && fresh.proposedTransitions.length === 0) {
        return {
          command: "apply-upload-reconciliation",
          status: "ALREADY_APPLIED",
          executionId: input.executionId,
          evidenceHash: input.reconciliationHash,
          stateMutation: false,
          onchainWrite: false,
        };
      }
      throw new Error("STATE_HASH_DRIFT_OR_STALE_EVIDENCE");
    }
    if (fresh.proposedTransitions.length === 0) throw new Error("no upload reconciliation transitions are available");

    const originalBytes = readFileSync(input.statePath);
    const leaseBytes = readFileSync(leasePaths(input.statePath).metadataPath);
    if (sha256(originalBytes) !== fresh.preStateSha256 || sha256(leaseBytes) !== fresh.leaseSha256) {
      throw new Error("STATE_HASH_DRIFT_OR_STALE_EVIDENCE");
    }
    const next = JSON.parse(originalBytes.toString("utf8"));
    if (!originalBytes.equals(serializedStateBytes(next))) {
      throw new Error("state must use canonical atomic serialization before reconciliation apply");
    }
    const chunks = next.deployment.buffer.chunks;
    for (const transition of fresh.proposedTransitions) {
      const chunk = chunks[transition.chunkIndex];
      if (!chunk || chunk.status !== transition.from || chunk.signature !== transition.signature || chunk.sha256 !== transition.chunkSha256 || transition.to !== "CONFIRMED") {
        throw new Error("STATE_HASH_DRIFT_OR_STALE_EVIDENCE");
      }
      chunk.status = "CONFIRMED";
    }
    const terminalOutcome = uniqueTerminalOutcome(next, input.executionId);
    if (!terminalOutcome) throw new Error("STATE_HASH_DRIFT_OR_STALE_EVIDENCE");
    terminalOutcome.reconciliationOutcomes ??= [];
    if (!Array.isArray(terminalOutcome.reconciliationOutcomes) || terminalOutcome.reconciliationOutcomes.some((receipt) => receipt?.evidenceHash === fresh.evidenceHash)) {
      throw new Error("reconciliation evidence replay conflict");
    }
    const receipt = {
      version: APPLY_RECEIPT_VERSION,
      executionId: input.executionId,
      evidenceHash: fresh.evidenceHash,
      appliedAt: (adapters.now ?? (() => new Date().toISOString()))(),
      stateSha256Before: fresh.preStateSha256,
      leaseSha256: fresh.leaseSha256,
      onchainEvidenceFingerprint: fresh.onchainEvidenceFingerprint,
      transitions: structuredClone(fresh.proposedTransitions),
    };
    terminalOutcome.reconciliationOutcomes.push(receipt);

    const save = adapters.saveStateAtomic ?? saveStateAtomic;
    try {
      save(input.statePath, next);
      const reread = readJson(input.statePath);
      if (!validateAppliedState(reread, input.expected, input.executionId, receipt, fresh.leaseSha256)) {
        throw new Error("post-write validation failed");
      }
    } catch {
      try {
        restoreStateBytesAtomic(input.statePath, originalBytes);
      } catch {
        throw new Error("reconciliation apply failed and rollback verification failed");
      }
      throw new Error("reconciliation apply failed; original state restored");
    }
    return {
      command: "apply-upload-reconciliation",
      status: "APPLIED",
      executionId: input.executionId,
      evidenceHash: fresh.evidenceHash,
      preStateSha256: fresh.preStateSha256,
      postStateSha256: sha256(readFileSync(input.statePath)),
      proposedTransitions: structuredClone(fresh.proposedTransitions),
      stateMutation: true,
      onchainWrite: false,
    };
  } finally {
    rmdirSync(lockPath);
  }
}

function releaseReceiptPath(archiveDirectory) {
  return join(archiveDirectory, "release.json");
}

function completeReleaseReceipt(receipt, input, fresh) {
  return exactKeys(receipt, ["authorization", "evidenceHash", "executionId", "leaseSha256", "stateSha256", "version"]) &&
    receipt.version === RELEASE_RECEIPT_VERSION &&
    receipt.authorization === "SAFE_TO_ARCHIVE" &&
    receipt.executionId === input.executionId &&
    receipt.evidenceHash === input.reconciliationHash &&
    receipt.stateSha256 === fresh.preStateSha256 &&
    receipt.leaseSha256 === fresh.leaseSha256;
}

function verifyTelemetryStateBinding(statePath, directory, executionId) {
  const state = readJson(statePath);
  const outcome = uniqueTerminalOutcome(state, executionId);
  if (!outcome) throw new Error("telemetry terminal state is missing");
  const evidence = readUploadTelemetry(directory);
  const reference = outcome.telemetryEvidence;
  if (reference === undefined) {
    if (evidence.availability === "UNAVAILABLE") return evidence;
    throw new Error("telemetry state reference is missing");
  }
  if (!exactKeys(reference, ["sha256", "verdict"]) ||
      !["COMPLETE", "INCOMPLETE"].includes(reference.verdict) ||
      !HEX_64.test(reference.sha256) ||
      evidence.availability !== "AVAILABLE" ||
      evidence.verdict !== reference.verdict ||
      evidence.sha256 !== reference.sha256) {
    throw new Error("telemetry state binding is invalid");
  }
  const lease = readJson(join(directory, "lease.json"));
  if (evidence.snapshot.executionId !== executionId ||
      evidence.snapshot.executionId !== lease.executionId ||
      evidence.snapshot.startedAt !== outcome.startedAt ||
      evidence.snapshot.startedAt !== lease.startedAt) {
    throw new Error("telemetry execution/start binding is invalid");
  }
  if ((evidence.snapshot.finishedAt ?? null) !== (outcome.finishedAt ?? null)) {
    throw new Error("telemetry terminal finish timestamp binding is invalid");
  }
  return evidence;
}

export function releaseUploadLease(input, adapters = {}) {
  if (input.acknowledgement !== RELEASE_LEASE_ACKNOWLEDGEMENT) {
    throw new Error("explicit lease-release acknowledgement is required");
  }
  assertEvidenceHash(input.reconciliationHash);
  const lockPath = acquireOperationLock(input.statePath);
  try {
    const paths = leasePaths(input.statePath, input.executionId, input.reconciliationHash);
    const activeExists = existsSync(paths.activeDirectory);
    const archiveExists = existsSync(paths.archiveDirectory);
    if (activeExists && archiveExists) throw new Error("ambiguous active and archived upload lease");
    if (!activeExists && !archiveExists) throw new Error("matching upload lease was not found");

    const directory = activeExists ? paths.activeDirectory : paths.archiveDirectory;
    const fresh = reconcileAtDirectory(input, adapters, directory);
    if (fresh.result === "STATE_HASH_DRIFT" || fresh.evidenceHash !== input.reconciliationHash) {
      throw new Error("STATE_HASH_DRIFT_OR_STALE_EVIDENCE");
    }
    if (fresh.result !== "SAFE_TO_RELEASE") throw new Error(`lease is not SAFE_TO_RELEASE: ${fresh.result}`);
    if (!fresh.releaseReady || fresh.proposedTransitions.length !== 0) {
      throw new Error("reconciliation transitions must be applied before lease release; evidence is not release-ready");
    }
    const telemetryBefore = verifyTelemetryStateBinding(
      input.statePath,
      directory,
      input.executionId,
    );
    if (!activeExists) {
      let receipt;
      try {
        receipt = readJson(releaseReceiptPath(paths.archiveDirectory));
      } catch {
        throw new Error("archived upload lease release receipt is invalid");
      }
      if (!completeReleaseReceipt(receipt, input, fresh)) throw new Error("archived upload lease release receipt is invalid");
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
    const receipt = {
      version: RELEASE_RECEIPT_VERSION,
      authorization: "SAFE_TO_ARCHIVE",
      executionId: input.executionId,
      evidenceHash: fresh.evidenceHash,
      stateSha256: fresh.preStateSha256,
      leaseSha256: fresh.leaseSha256,
    };
    const receiptPath = releaseReceiptPath(paths.activeDirectory);
    if (existsSync(receiptPath)) {
      let stored;
      try {
        stored = readJson(receiptPath);
      } catch {
        throw new Error("active upload lease release receipt is invalid");
      }
      if (!completeReleaseReceipt(stored, input, fresh)) throw new Error("active upload lease release receipt is invalid");
    } else {
      const temporary = join(paths.activeDirectory, "release.json.tmp");
      try {
        writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
        nodeRenameSync(temporary, receiptPath);
      } catch {
        throw new Error("atomic lease release receipt write failed");
      }
    }

    const rename = adapters.renameSync ?? nodeRenameSync;
    const telemetryBytesBefore = telemetryBefore.availability === "AVAILABLE"
      ? readFileSync(join(paths.activeDirectory, "telemetry.json"))
      : null;
    try {
      rename(paths.activeDirectory, paths.archiveDirectory);
    } catch {
      throw new Error("atomic lease archive failed");
    }
    if (telemetryBefore.availability === "AVAILABLE") {
      let telemetryAfter;
      let telemetryBytesAfter;
      try {
        telemetryAfter = readUploadTelemetry(paths.archiveDirectory);
        telemetryBytesAfter = readFileSync(join(paths.archiveDirectory, "telemetry.json"));
      } catch {
        throw new Error("telemetry archive integrity verification failed");
      }
      if (telemetryAfter.availability !== "AVAILABLE" ||
          telemetryAfter.sha256 !== telemetryBefore.sha256 ||
          !telemetryBytesAfter.equals(telemetryBytesBefore)) {
        throw new Error("telemetry archive integrity verification failed");
      }
    }
    verifyTelemetryStateBinding(
      input.statePath,
      paths.archiveDirectory,
      input.executionId,
    );
    return {
      command: "release-upload-lease",
      lifecycle: "ARCHIVED/RELEASED",
      executionId: input.executionId,
      evidenceHash: fresh.evidenceHash,
      idempotent: false,
      stateMutation: true,
      onchainWrite: false,
    };
  } finally {
    rmdirSync(lockPath);
  }
}
