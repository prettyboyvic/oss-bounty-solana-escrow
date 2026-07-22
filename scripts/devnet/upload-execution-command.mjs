import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { performance } from "node:perf_hooks";

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";

import { inspectUpgradeableBuffer } from "./live-deployment.mjs";
import { makeLoaderV3WriteInstruction } from "./loader-v3-codec.mjs";
import { createRpcRequestScheduler } from "./rpc-request-scheduler.mjs";
import {
  calculateFunding,
  PLAN_UPLOAD_IDENTITIES,
} from "./plan-upload-command.mjs";
import { assertDevnetGenesis, DEVNET_GENESIS_HASH } from "./safety.mjs";
import { saveStateAtomic } from "./state.mjs";
import { validateUploadStateV3 } from "./state-migration-command.mjs";
import {
  createPlanFingerprint,
  normalizeRatePolicy,
  runPersistedSequentialUpload,
} from "./throttled-uploader.mjs";
import { acquireUploadLease } from "./upload-execution-lease.mjs";
import { LIVE_UPLOAD_ACKNOWLEDGEMENT } from "./upload-execution-contract.mjs";
import { planBufferUpload } from "./upload-plan.mjs";
import {
  createConfirmedValidationSnapshot,
  validateConfirmedValidationSnapshot,
} from "./upload-validation-snapshot.mjs";

const BUFFER_METADATA_LENGTH = 37;
const PROGRAM_ACCOUNT_LENGTH = 36;
const PROGRAMDATA_METADATA_LENGTH = 45;
const CONFIRMATION_POLL_INTERVAL_MS = 2_000;
const APPLY_RECEIPT_VERSION = "UPLOAD_RECONCILIATION_V1";
const APPLY_RECEIPT_KEYS = ["appliedAt", "evidenceHash", "executionId", "leaseSha256", "onchainEvidenceFingerprint", "stateSha256Before", "transitions", "version"];
const APPLY_TRANSITION_KEYS = ["chunkIndex", "chunkSha256", "feeLamports", "from", "signature", "slot", "to"];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function hasExactKeys(value, expectedKeys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...expectedKeys].sort().join("\0");
}

function reconciliationProofRecords(state, executionId) {
  const chunks = state?.deployment?.buffer?.chunks;
  if (!Array.isArray(chunks)) return [];
  const unresolved = chunks
    .filter(({ status }) => status === "SENT" || status === "UNKNOWN")
    .map((record) => ({ record, recordedStatus: record.status }));
  if (unresolved.length > 0) return unresolved;

  const windows = state.deployment.buffer.uploadWindows;
  if (!Array.isArray(windows)) return [];
  const outcomes = windows.filter((window) => window?.executionId === executionId && window.terminal === true);
  const receipts = outcomes.length === 1 ? outcomes[0].reconciliationOutcomes : null;
  if (!Array.isArray(receipts) || receipts.length !== 1) return [];
  const [receipt] = receipts;
  if (!hasExactKeys(receipt, APPLY_RECEIPT_KEYS) || receipt.version !== APPLY_RECEIPT_VERSION ||
      receipt.executionId !== executionId || !Array.isArray(receipt.transitions) || receipt.transitions.length < 1) {
    return [];
  }
  const indices = new Set();
  const targets = [];
  for (const transition of receipt.transitions) {
    if (!hasExactKeys(transition, APPLY_TRANSITION_KEYS) ||
        !Number.isInteger(transition.chunkIndex) || indices.has(transition.chunkIndex) ||
        (transition.from !== "SENT" && transition.from !== "UNKNOWN") || transition.to !== "CONFIRMED") {
      return [];
    }
    const record = chunks[transition.chunkIndex];
    if (!record || record.index !== transition.chunkIndex || record.status !== "CONFIRMED" ||
        record.signature !== transition.signature || record.sha256 !== transition.chunkSha256) {
      return [];
    }
    indices.add(transition.chunkIndex);
    targets.push({ record, recordedStatus: transition.from });
  }
  return targets;
}

function confirmedChunksMatch(state, accountData) {
  const payload = Buffer.from(accountData).subarray(BUFFER_METADATA_LENGTH);
  const chunks = state?.deployment?.buffer?.chunks;
  if (!Array.isArray(chunks)) return false;
  return chunks
    .filter(({ status }) => status === "CONFIRMED")
    .every(({ offset, length, sha256: expectedSha256 }) =>
      Number.isSafeInteger(offset) && offset >= 0 &&
      Number.isSafeInteger(length) && length > 0 &&
      offset + length <= payload.length &&
      sha256(payload.subarray(offset, offset + length)) === expectedSha256,
    );
}

function defaultContract() {
  return {
    url: "https://api.devnet.solana.com",
    genesis: DEVNET_GENESIS_HASH,
    program: PLAN_UPLOAD_IDENTITIES.program,
    buffer: PLAN_UPLOAD_IDENTITIES.buffer,
    authority: PLAN_UPLOAD_IDENTITIES.authority,
    owner: PLAN_UPLOAD_IDENTITIES.loader,
  };
}

function validationSnapshotExpected(expected, stateSha256) {
  return {
    bufferAddress: expected.buffer,
    owner: expected.owner,
    authority: expected.authority,
    allocation: expected.allocation,
    stateSha256,
    binarySha256: expected.binarySha256,
    planFingerprint: expected.planFingerprint,
  };
}

function recordRpc(adapters, methodClass, operation, { signaturePersisted = false, mutationCapability = "read" } = {}) {
  const scheduler = adapters.rpcRequestScheduler;
  if (scheduler) return scheduler.schedule({ methodClass, signaturePersisted, mutationCapability }, operation);
  const ledger = adapters.rpcRequestLedger;
  if (!ledger) return operation();
  return ledger.record({ methodClass, retryNumber: 0, signaturePersisted, mutationCapability }, operation);
}

function expectedCheckpoint(localBytes, state, contract) {
  const buffer = state.deployment?.buffer;
  return {
    program: contract.program,
    buffer: contract.buffer,
    authority: contract.authority,
    owner: contract.owner,
    allocation: localBytes.length + BUFFER_METADATA_LENGTH,
    binaryLength: localBytes.length,
    binarySha256: sha256(localBytes),
    planFingerprint: buffer?.planFingerprint,
  };
}

function assertRequest(request, contract) {
  if (request.acknowledgement !== LIVE_UPLOAD_ACKNOWLEDGEMENT) throw new Error("explicit devnet-write acknowledgement is required");
  if (request.url !== contract.url) throw new Error("exact devnet RPC mismatch");
  if (request.program !== contract.program) throw new Error("program ID mismatch");
  if (request.buffer !== contract.buffer) throw new Error("buffer address mismatch");
  normalizeRatePolicy({ maxChunksPerWindow: request.maxChunks, minimumDelayMs: request.delayMs });
}

export async function preflightUploadExecution(request, adapters) {
  const contract = adapters.contract ?? defaultContract();
  assertRequest(request, contract);
  const rpc = adapters.rpc;
  if (!rpc || rpc.rpcEndpoint !== request.url) throw new Error("explicit live RPC adapter mismatch");
  const genesis = await recordRpc(adapters, "GET_GENESIS_HASH", () => rpc.getGenesisHash());
  assertDevnetGenesis(genesis, contract.genesis);

  const programKey = new PublicKey(request.program);
  const bufferKey = new PublicKey(request.buffer);
  const programAccount = await recordRpc(adapters, "GET_ACCOUNT_INFO", () => rpc.getAccountInfo(programKey, "confirmed"));
  if (programAccount !== null) throw new Error("UNEXPECTED_EXISTING_PROGRAM");
  const bufferResponse = await recordRpc(adapters, "GET_ACCOUNT_INFO", () =>
    rpc.getAccountInfoAndContext(bufferKey, { commitment: "finalized" }));
  const capturedAtMonotonicMs = (adapters.monotonicNow ?? (() => performance.now()))();
  const bufferAccount = bufferResponse?.value;
  if (!bufferAccount) throw new Error("buffer account is absent");

  const localBytes = readFileSync(request.binaryPath);
  const stateBytes = readFileSync(request.statePath);
  const state = JSON.parse(stateBytes.toString("utf8"));
  const stateSha256 = sha256(stateBytes);
  const expected = expectedCheckpoint(localBytes, state, contract);
  validateUploadStateV3(state, expected);
  const observedBuffer = inspectUpgradeableBuffer(bufferAccount, {
    publicKey: request.buffer,
    expectedOwner: expected.owner,
    expectedAuthority: expected.authority,
    allocatedLength: expected.allocation,
    localBytes,
  });
  const bufferBytes = Buffer.from(bufferAccount.data).subarray(BUFFER_METADATA_LENGTH);
  const plan = planBufferUpload({
    localBytes,
    bufferBytes,
    buffer: bufferKey,
    authority: new PublicKey(expected.authority),
  });
  const fingerprint = createPlanFingerprint({
    program: expected.program,
    buffer: expected.buffer,
    authority: expected.authority,
    allocation: expected.allocation,
    binarySha256: expected.binarySha256,
    maxPayload: plan.maxPayload,
    chunks: plan.chunks,
  });
  if (fingerprint !== expected.planFingerprint) throw new Error("plan fingerprint mismatch");
  for (const [record, chunk] of state.deployment.buffer.chunks.map((record, index) => [record, plan.chunks[index]])) {
    if (!chunk || record.index !== chunk.index || record.offset !== chunk.offset || record.length !== chunk.length || record.sha256 !== chunk.sha256) {
      throw new Error("plan chunk evidence mismatch");
    }
  }
  const validationSnapshot = createConfirmedValidationSnapshot({
    bufferAddress: expected.buffer,
    owner: observedBuffer.owner,
    authority: observedBuffer.authority,
    allocation: observedBuffer.dataLength,
    lamports: bufferAccount.lamports,
    accountData: bufferAccount.data,
    finalizedSlot: bufferResponse?.context?.slot,
    capturedAtMonotonicMs,
    stateSha256,
    binarySha256: expected.binarySha256,
    planFingerprint: expected.planFingerprint,
  });
  const confirmedValidation = validateConfirmedValidationSnapshot({
    snapshot: validationSnapshot,
    expected: validationSnapshotExpected(expected, stateSha256),
    chunks: plan.chunks,
    records: state.deployment.buffer.chunks,
    localBytes,
    nowMonotonicMs: capturedAtMonotonicMs,
  });

  const balanceLamports = await recordRpc(adapters, "GET_BALANCE", () =>
    rpc.getBalance(new PublicKey(expected.authority), "confirmed"));
  const programAccountRentLamports = await recordRpc(adapters, "GET_RENT_EXEMPTION", () =>
    rpc.getMinimumBalanceForRentExemption(PROGRAM_ACCOUNT_LENGTH, "confirmed"));
  const programDataRentLamports = await recordRpc(adapters, "GET_RENT_EXEMPTION", () =>
    rpc.getMinimumBalanceForRentExemption(PROGRAMDATA_METADATA_LENGTH + localBytes.length, "confirmed"));
  const funding = calculateFunding({
    balanceLamports,
    programAccountRentLamports,
    programDataRentLamports,
    remainingChunks: plan.remainingChunks,
  });
  if (funding.status !== "SUFFICIENT") throw new Error("BLOCKED_FUNDING");
  return {
    verifiedGenesis: genesis,
    state,
    stateSha256,
    localBytes,
    expected,
    observedBuffer,
    bufferDataSha256: sha256(bufferAccount.data),
    validationSnapshot,
    confirmedValidation,
    plan,
    funding,
    observations: {
      genesisVerified: true,
      programAbsent: true,
      confirmedChunksMatch: true,
      buffer: {
        address: expected.buffer,
        owner: observedBuffer.owner,
        authority: observedBuffer.authority,
        allocation: observedBuffer.dataLength,
        finalizedSlot: validationSnapshot.finalizedSlot,
        planFingerprint: expected.planFingerprint,
      },
    },
    liveWriteExecuted: false,
  };
}

export async function collectLeaseReconciliationInput(request, adapters) {
  const contract = adapters.contract ?? defaultContract();
  if (request.url !== contract.url || request.program !== contract.program || request.buffer !== contract.buffer) {
    throw new Error("lease reconciliation identity mismatch");
  }
  const rpc = adapters.rpc;
  if (!rpc || rpc.rpcEndpoint !== request.url) throw new Error("explicit live RPC adapter mismatch");
  if (typeof request.binaryPath !== "string" || request.binaryPath.length === 0) {
    throw new Error("explicit binary path is required");
  }
  const stateBytes = readFileSync(request.statePath);
  const state = JSON.parse(stateBytes.toString("utf8"));
  const localBytes = readFileSync(request.binaryPath);
  const buffer = state.deployment?.buffer;
  const expected = {
    genesis: contract.genesis,
    program: contract.program,
    buffer: contract.buffer,
    authority: contract.authority,
    owner: contract.owner,
    allocation: localBytes.length + BUFFER_METADATA_LENGTH,
    binaryLength: localBytes.length,
    binarySha256: sha256(localBytes),
    planFingerprint: buffer?.planFingerprint,
    stateSha256: sha256(stateBytes),
  };
  validateUploadStateV3(state, expected);
  const plan = planBufferUpload({
    localBytes,
    bufferBytes: Buffer.alloc(localBytes.length),
    buffer: new PublicKey(expected.buffer),
    authority: new PublicKey(expected.authority),
  });
  const planFingerprint = createPlanFingerprint({
    program: expected.program,
    buffer: expected.buffer,
    authority: expected.authority,
    allocation: expected.allocation,
    binarySha256: expected.binarySha256,
    maxPayload: plan.maxPayload,
    chunks: plan.chunks,
  });
  if (planFingerprint !== expected.planFingerprint) throw new Error("plan fingerprint mismatch");
  if (buffer.chunks.length !== plan.chunks.length) throw new Error("plan chunk count mismatch");
  for (const [record, chunk] of buffer.chunks.map((record, index) => [record, plan.chunks[index]])) {
    if (!chunk || record.index !== chunk.index || record.offset !== chunk.offset || record.length !== chunk.length || record.sha256 !== chunk.sha256) {
      throw new Error("plan chunk evidence mismatch");
    }
  }

  const genesis = await recordRpc(adapters, "GET_GENESIS_HASH", () => rpc.getGenesisHash());
  assertDevnetGenesis(genesis, contract.genesis);
  const transactions = [];
  let minimumContextSlot = 0;
  for (const { record, recordedStatus } of reconciliationProofRecords(state, request.executionId)) {
    const statusResponse = await recordRpc(adapters, "GET_SIGNATURE_STATUSES", () =>
      rpc.getSignatureStatuses([record.signature], { searchTransactionHistory: true }), { signaturePersisted: true });
    const status = Array.isArray(statusResponse?.value) && statusResponse.value.length === 1 && statusResponse.value[0] && typeof statusResponse.value[0] === "object"
      ? statusResponse.value[0]
      : null;
    const transaction = await recordRpc(adapters, "GET_TRANSACTION", () =>
      rpc.getTransaction(record.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 }), { signaturePersisted: true });
    const transactionFound = transaction !== null && typeof transaction === "object" && !Array.isArray(transaction);
    const transactionMeta = transaction?.meta !== null && typeof transaction?.meta === "object" && !Array.isArray(transaction.meta)
      ? transaction.meta
      : null;
    const transactionSlot = Number.isSafeInteger(transaction?.slot) && transaction.slot >= 0 ? transaction.slot : null;
    if (transactionSlot !== null) minimumContextSlot = Math.max(minimumContextSlot, transactionSlot);
    const signatures = Array.isArray(transaction?.transaction?.signatures) ? transaction.transaction.signatures : [];
    const message = transaction?.transaction?.message;
    const legacyMessage = (transaction?.version === undefined || transaction.version === "legacy") &&
      Array.isArray(message?.accountKeys) && Array.isArray(message?.instructions);
    const instructionCount = Array.isArray(message?.instructions) ? message.instructions.length : 0;
    const innerInstructionCount = Array.isArray(transactionMeta?.innerInstructions)
      ? transactionMeta.innerInstructions.length
      : null;
    let instruction = null;
    try {
      if (legacyMessage && instructionCount === 1) {
        instruction = Transaction.populate(message).instructions[0] ?? null;
      }
    } catch {
      instruction = null;
    }
    const keys = Array.isArray(instruction?.keys) ? instruction.keys : [];
    const data = Buffer.isBuffer(instruction?.data) ? instruction.data : null;
    let offset = null;
    let payload = null;
    if (data && data.length >= 16 && data.readUInt32LE(0) === 1) {
      const declaredLength = data.readBigUInt64LE(8);
      if (declaredLength <= BigInt(Number.MAX_SAFE_INTEGER) && data.length === 16 + Number(declaredLength)) {
        offset = data.readUInt32LE(4);
        payload = data.subarray(16);
      }
    }
    const expectedBytes = localBytes.subarray(record.offset, record.offset + record.length);
    transactions.push({
      chunkIndex: record.index,
      recordedStatus,
      signature: record.signature,
      signatureStatusFound: status !== null,
      confirmationStatus: typeof status?.confirmationStatus === "string" ? status.confirmationStatus : null,
      statusSlot: Number.isSafeInteger(status?.slot) && status.slot >= 0 ? status.slot : null,
      statusErr: status && Object.hasOwn(status, "err") ? status.err !== null : null,
      transactionFound,
      transactionSignature: typeof signatures[0] === "string" ? signatures[0] : null,
      signatureCount: signatures.length,
      slot: transactionSlot,
      feeLamports: Number.isSafeInteger(transactionMeta?.fee) && transactionMeta.fee >= 0 ? transactionMeta.fee : null,
      metaErr: transactionMeta && Object.hasOwn(transactionMeta, "err") ? transactionMeta.err !== null : null,
      legacyMessage,
      instructionCount,
      innerInstructionCount,
      instructionDecoded: payload !== null,
      program: instruction?.programId?.toBase58?.() ?? null,
      accountCount: keys.length,
      buffer: keys[0]?.pubkey?.toBase58?.() ?? null,
      authority: keys[1]?.pubkey?.toBase58?.() ?? null,
      bufferWritable: keys[0]?.isWritable === true && keys[0]?.isSigner === false,
      authoritySigner: keys[1]?.isSigner === true,
      offset,
      payloadLength: payload?.length ?? 0,
      payloadSha256: payload ? sha256(payload) : null,
      payloadExactMatch: payload?.equals(expectedBytes) === true,
      onchainLength: 0,
      onchainSha256: sha256(Buffer.alloc(0)),
      onchainExactMatch: false,
      snapshotSlot: null,
    });
  }

  const accountOptions = { commitment: "finalized", minContextSlot: minimumContextSlot };
  const accountsResponse = await recordRpc(adapters, "GET_ACCOUNT_INFO", () =>
    rpc.getMultipleAccountsInfoAndContext([
      new PublicKey(expected.program),
      new PublicKey(expected.buffer),
    ], accountOptions));
  const accountContextSlot = accountsResponse?.context?.slot;
  if (!Number.isSafeInteger(accountContextSlot) || accountContextSlot < minimumContextSlot || !Array.isArray(accountsResponse?.value) || accountsResponse.value.length !== 2) {
    throw new Error("program/buffer finalized context invariant mismatch");
  }
  const [programAccount, account] = accountsResponse.value;
  if (programAccount !== null) throw new Error("UNEXPECTED_EXISTING_PROGRAM");
  const programContextSlot = accountContextSlot;
  const bufferContextSlot = accountContextSlot;
  if (!account || account.executable || account.owner.toBase58() !== expected.owner || account.data.length !== expected.allocation || Buffer.from(account.data).readUInt32LE(0) !== 1 || account.data[4] !== 1) {
    throw new Error("buffer on-chain invariant mismatch");
  }
  const authority = new PublicKey(Buffer.from(account.data).subarray(5, 37)).toBase58();
  if (authority !== expected.authority) throw new Error("buffer authority mismatch");
  const accountData = Buffer.from(account.data);
  const onchainPayload = accountData.subarray(BUFFER_METADATA_LENGTH);
  for (const evidence of transactions) {
    const record = buffer.chunks[evidence.chunkIndex];
    const bytes = onchainPayload.subarray(record.offset, record.offset + record.length);
    evidence.onchainLength = bytes.length;
    evidence.onchainSha256 = sha256(bytes);
    evidence.onchainExactMatch = bytes.length === record.length && evidence.onchainSha256 === record.sha256;
    evidence.snapshotSlot = bufferContextSlot;
  }
  return {
    statePath: request.statePath,
    executionId: request.executionId,
    expected,
    observations: {
      genesisVerified: true,
      verifiedGenesis: genesis,
      programAbsent: true,
      programContextSlot,
      confirmedChunksMatch: confirmedChunksMatch(state, accountData),
      bufferDataSha256: sha256(accountData),
      bufferContextSlot,
      buffer: {
        address: expected.buffer,
        owner: expected.owner,
        authority,
        allocation: account.data.length,
        planFingerprint: expected.planFingerprint,
      },
      transactions,
    },
  };
}

function appendWindowOutcome(statePath, outcome) {
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const windows = state.deployment?.buffer?.uploadWindows;
  if (!Array.isArray(windows)) throw new Error("upload windows are required");
  if (windows.some(({ executionId }) => executionId === outcome.executionId)) {
    throw new Error("duplicate upload execution ID");
  }
  windows.push(outcome);
  saveStateAtomic(statePath, state);
}

function classifyTerminalError(statePath, error) {
  if (/signer mismatch/i.test(String(error?.message))) return "SIGNER_MISMATCH";
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    if (state.deployment?.buffer?.chunks?.some((chunk) => chunk.status === "SENT" || chunk.status === "UNKNOWN")) {
      return "RPC_OUTCOME_UNKNOWN";
    }
  } catch {
    return "STATE_PERSISTENCE_ERROR";
  }
  return "EXECUTION_ERROR";
}

export async function executeUploadWindow(request, adapters) {
  const preflight = await preflightUploadExecution(request, adapters);
  const currentStateSha256 = sha256(readFileSync(request.statePath));
  const currentLocalBytes = readFileSync(request.binaryPath);
  const confirmedValidation = validateConfirmedValidationSnapshot({
    snapshot: preflight.validationSnapshot,
    expected: validationSnapshotExpected(preflight.expected, currentStateSha256),
    chunks: preflight.plan.chunks,
    records: preflight.state.deployment.buffer.chunks,
    localBytes: currentLocalBytes,
    nowMonotonicMs: (adapters.monotonicNow ?? (() => performance.now()))(),
  });
  const executionId = (adapters.executionId ?? randomUUID)();
  const startedAt = (adapters.now ?? (() => new Date().toISOString()))();
  acquireUploadLease({
    statePath: request.statePath,
    executionId,
    pid: adapters.pid ?? process.pid,
    hostname: adapters.hostname ?? hostname(),
    startedAt,
    program: preflight.expected.program,
    buffer: preflight.expected.buffer,
    planFingerprint: preflight.expected.planFingerprint,
    stateSha256: preflight.stateSha256,
  });

  const chunks = preflight.plan.chunks.map((chunk) => ({
    ...chunk,
    bytes: currentLocalBytes.subarray(chunk.offset, chunk.offset + chunk.length),
  }));
  let authority;
  let preSignCoolOffComplete = false;
  const sign = async (chunk) => {
    if (!preSignCoolOffComplete && adapters.rpcRequestScheduler) {
      await adapters.rpcRequestScheduler.waitForCoolOff(3000);
      preSignCoolOffComplete = true;
    }
    authority ??= await adapters.loadAuthorityKeypair(request.authorityPath);
    if (authority?.publicKey?.toBase58() !== preflight.expected.authority) {
      throw new Error("buffer authority signer mismatch");
    }
    const latestBlockhash = await adapters.getLatestBlockhash({
      statePath: request.statePath,
      chunkIndex: chunk.index,
    });
    return adapters.buildAndSign({
      chunk,
      latestBlockhash,
      authority,
      buffer: new PublicKey(preflight.expected.buffer),
    });
  };

  let result;
  let liveWriteAttempted = false;
  const completedConfirmations = [];
  try {
    result = await runPersistedSequentialUpload({
      statePath: request.statePath,
      checkpoint: preflight.expected,
      chunks,
      confirmedChunkIndexes: confirmedValidation.confirmedIndexes,
      policy: { maxChunksPerWindow: request.maxChunks, minimumDelayMs: request.delayMs },
      sign,
      send: async (signed, chunk) => {
        liveWriteAttempted = true;
        return adapters.sendRawTransaction(signed.rawTransaction, chunk);
      },
      confirm: adapters.confirmSignature,
      readChunkMatches: adapters.readChunkMatches,
      sleep: adapters.sleep,
      monotonicNow: adapters.monotonicNow,
      onEvent(event) {
        if (event.status === "CONFIRMED" && event.confirmationDurationMs !== undefined) {
          completedConfirmations.push({ chunkIndex: event.index, confirmationDurationMs: event.confirmationDurationMs });
        }
      },
    });
  } catch (error) {
    appendWindowOutcome(request.statePath, {
      executionId,
      status: classifyTerminalError(request.statePath, error),
      terminal: true,
      startedAt,
      finishedAt: (adapters.now ?? (() => new Date().toISOString()))(),
      maxChunks: request.maxChunks,
      delayMs: request.delayMs,
      confirmedIndexes: completedConfirmations.map(({ chunkIndex }) => chunkIndex),
      confirmations: completedConfirmations,
    });
    throw error;
  }
  appendWindowOutcome(request.statePath, {
    executionId,
    status: result.status,
    terminal: true,
    startedAt,
    finishedAt: (adapters.now ?? (() => new Date().toISOString()))(),
    maxChunks: request.maxChunks,
    delayMs: request.delayMs,
    processed: result.processed,
    sent: result.sent,
    confirmedIndexes: result.confirmedIndexes,
    confirmations: result.confirmations,
    skippedIndexes: result.skippedIndexes,
  });
  return {
    command: "upload-buffer-throttled",
    executionId,
    status: result.status,
    processed: result.processed,
    sent: result.sent,
    confirmedIndexes: result.confirmedIndexes,
    confirmations: result.confirmations,
    skippedIndexes: result.skippedIndexes,
    leaseLifecycle: "RECONCILIATION_REQUIRED",
    liveWriteAttempted,
    liveWriteExecuted: result.confirmedIndexes.length > 0 ? true : liveWriteAttempted ? null : false,
    stateMutation: true,
    ...(adapters.rpcRequestLedger ? { rpcRequestSummary: adapters.rpcRequestLedger.summary() } : {}),
    ...(adapters.rpcRequestPolicy ? { rpcRequestPolicy: adapters.rpcRequestPolicy } : {}),
  };
}

export function encodeBase58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      const value = digits[index] * 256 + carry;
      digits[index] = value % 58;
      carry = Math.floor(value / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  for (let index = 0; index < bytes.length - 1 && bytes[index] === 0; index += 1) digits.push(0);
  return digits.reverse().map((digit) => alphabet[digit]).join("");
}

export function createProductionUploadDependencies(url, {
  bufferAddress = PLAN_UPLOAD_IDENTITIES.buffer,
  connection: injectedConnection,
  monotonicNow,
  schedulerSleep,
  transactionSleep,
} = {}) {
  const connection = injectedConnection ?? new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  const sleep = transactionSleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const requestMonotonicNow = monotonicNow ?? (() => performance.now());
  const rpcRequestScheduler = createRpcRequestScheduler({
    monotonicNow: requestMonotonicNow,
    ...(schedulerSleep ? { sleep: schedulerSleep } : {}),
  });
  const rpcRequestLedger = rpcRequestScheduler.ledger;
  const schedulerPolicy = rpcRequestScheduler.policy();
  const rpcRequestPolicy = Object.freeze({
    globalRequestStartGapMs: schedulerPolicy.minimumRequestStartGapMs,
    confirmationPollIntervalMs: CONFIRMATION_POLL_INTERVAL_MS,
    rateLimitRetryScheduleMs: Object.freeze([...schedulerPolicy.retryBackoffMs]),
  });
  return {
    rpc: connection,
    rpcRequestLedger,
    rpcRequestPolicy,
    rpcRequestScheduler,
    monotonicNow: requestMonotonicNow,
    loadAuthorityKeypair(path) {
      const bytes = JSON.parse(readFileSync(path, "utf8"));
      return Keypair.fromSecretKey(Uint8Array.from(bytes));
    },
    getLatestBlockhash: ({ statePath, chunkIndex } = {}) => rpcRequestScheduler.schedule({
      methodClass: "GET_LATEST_BLOCKHASH",
      signaturePersisted: false,
      mutationCapability: "read",
    }, () => connection.getLatestBlockhash("confirmed"), {
      beforeAttempt() {
        if (typeof statePath !== "string" || !Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
          throw new Error("blockhash checkpoint context is required");
        }
        let state;
        try {
          state = JSON.parse(readFileSync(statePath, "utf8"));
        } catch {
          throw new Error("blockhash checkpoint drift");
        }
        const record = state?.deployment?.buffer?.chunks?.[chunkIndex];
        if (!record || record.index !== chunkIndex || record.status !== "PLANNED" || record.signature !== null) {
          throw new Error("blockhash checkpoint drift");
        }
      },
    }),
    buildAndSign({ chunk, latestBlockhash, authority, buffer }) {
      const transaction = new Transaction({
        feePayer: authority.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
      }).add(makeLoaderV3WriteInstruction({
        buffer,
        authority: authority.publicKey,
        offset: chunk.offset,
        bytes: chunk.bytes,
      }));
      transaction.sign(authority);
      return {
        signature: encodeBase58(transaction.signature),
        rawTransaction: transaction.serialize(),
      };
    },
    sendRawTransaction: (rawTransaction) => rpcRequestScheduler.schedule({
      methodClass: "SEND_RAW_TRANSACTION",
      signaturePersisted: true,
      mutationCapability: "write",
    }, () => connection.sendRawTransaction(rawTransaction, { maxRetries: 0, skipPreflight: true })),
    async confirmSignature(signature, timeoutMs) {
      const deadlineMonotonicMs = requestMonotonicNow() + timeoutMs;
      let lastStatusAttemptStartMs = null;
      while (requestMonotonicNow() < deadlineMonotonicMs) {
        const response = await rpcRequestScheduler.schedule({
          methodClass: "GET_SIGNATURE_STATUSES",
          signaturePersisted: true,
          mutationCapability: "read",
        }, () => connection.getSignatureStatuses([signature], { searchTransactionHistory: true }), {
          ...(lastStatusAttemptStartMs === null ? {} : {
            notBeforeMonotonicMs: lastStatusAttemptStartMs + CONFIRMATION_POLL_INTERVAL_MS,
          }),
          onInvocationStart({ startMonotonicMs }) {
            lastStatusAttemptStartMs = startMonotonicMs;
          },
        });
        const status = response.value[0];
        if (status?.err || status?.confirmationStatus === "finalized") return status;
        if (lastStatusAttemptStartMs + CONFIRMATION_POLL_INTERVAL_MS >= deadlineMonotonicMs) return null;
      }
      return null;
    },
    async readChunkMatches(chunk) {
      const account = await rpcRequestScheduler.schedule({
        methodClass: "GET_ACCOUNT_INFO",
        signaturePersisted: true,
        mutationCapability: "read",
      }, () => connection.getAccountInfo(new PublicKey(bufferAddress), "confirmed"));
      if (!account) return false;
      return Buffer.from(account.data)
        .subarray(BUFFER_METADATA_LENGTH + chunk.offset, BUFFER_METADATA_LENGTH + chunk.offset + chunk.length)
        .equals(chunk.bytes);
    },
    sleep,
  };
}
