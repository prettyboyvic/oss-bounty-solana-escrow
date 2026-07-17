import { spawnSync } from "node:child_process";
import { setTimeout as sleepTimer } from "node:timers/promises";

import { PublicKey } from "@solana/web3.js";

const BUFFER_METADATA_LENGTH = 37;
const MAX_WRITE_ATTEMPTS = 3;
const KEYPAIR_ARRAY = /\[(?:\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,){63}\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*\]/;

function writeAttemptLimit(buffer) {
  const limit = buffer.activeWindow?.maxAttempts ?? MAX_WRITE_ATTEMPTS;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_WRITE_ATTEMPTS) {
    throw new Error("write attempt limit must be between one and three");
  }
  return limit;
}

export function assertSafeCapturedOutput(output) {
  const value = String(output ?? "");
  if (
    /seed phrase|mnemonic|ephemeral keypair/i.test(value) ||
    KEYPAIR_ARRAY.test(value)
  ) {
    throw new Error(
      "REVISE_SECURITY_BOUNDARY: Solana CLI emitted recovery material",
    );
  }
}

export function runCapturedCommand(
  file,
  argv,
  { runner = spawnSync, cwd } = {},
) {
  if (!Array.isArray(argv) || argv.some((item) => typeof item !== "string")) {
    throw new Error("command argv must be a string array");
  }
  const result = runner(file, argv, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  assertSafeCapturedOutput(stdout);
  assertSafeCapturedOutput(stderr);
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout,
    stderr,
    error: result.error ?? null,
  };
}

export function classifyCliError(output) {
  const value = String(output ?? "");
  if (/\b429\b|too many requests|rate.?limit/i.test(value)) {
    return { classification: "RPC_RATE_LIMIT", retryable: true };
  }
  if (/max retries exceeded/i.test(value)) {
    return { classification: "RPC_MAX_RETRIES", retryable: true };
  }
  if (/timed? out|timeout/i.test(value)) {
    return { classification: "RPC_TIMEOUT", retryable: true };
  }
  return { classification: "CLI_FAILURE", retryable: false };
}

export function inspectUpgradeableBuffer(account, expected) {
  if (!account) {
    return null;
  }
  const owner = account.owner.toBase58();
  if (owner !== expected.expectedOwner) {
    throw new Error(`buffer owner mismatch: ${owner}`);
  }
  const data = Buffer.from(account.data);
  if (data.length !== expected.allocatedLength) {
    throw new Error(
      `buffer allocation mismatch: ${data.length} != ${expected.allocatedLength}`,
    );
  }
  if (account.executable || data.length < BUFFER_METADATA_LENGTH) {
    throw new Error("buffer account shape mismatch");
  }
  if (data.readUInt32LE(0) !== 1 || data[4] !== 1) {
    throw new Error("buffer state mismatch");
  }
  const authority = new PublicKey(data.subarray(5, 37)).toBase58();
  if (authority !== expected.expectedAuthority) {
    throw new Error(`buffer authority mismatch: ${authority}`);
  }
  const programBytes = data.subarray(BUFFER_METADATA_LENGTH);
  const localBytes = Buffer.from(expected.localBytes);
  let matchingBytes = 0;
  for (let index = 0; index < localBytes.length; index += 1) {
    if (programBytes[index] === localBytes[index]) {
      matchingBytes += 1;
    }
  }
  const exactBinaryMatch = programBytes.equals(localBytes);
  return {
    publicKey: expected.publicKey,
    owner,
    authority,
    dataLength: data.length,
    matchingBytes,
    totalBytes: localBytes.length,
    exactBinaryMatch,
    status: exactBinaryMatch ? "BUFFER_COMPLETE" : "BUFFER_WRITING",
  };
}

export function summarizeSignatureHistory(
  signatures,
  { baselineCount = 0 } = {},
) {
  if (!Array.isArray(signatures)) {
    throw new Error("signature history must be an array");
  }
  if (!Number.isInteger(baselineCount) || baselineCount < 0) {
    throw new Error("signature history baseline must be a nonnegative integer");
  }
  const sanitized = signatures.map((entry) => {
    if (
      typeof entry?.signature !== "string" ||
      !Number.isInteger(entry.slot)
    ) {
      throw new Error("signature history entry is invalid");
    }
    return {
      signature: entry.signature,
      slot: entry.slot,
      err: structuredClone(entry.err ?? null),
    };
  });
  const successful = sanitized.filter((entry) => entry.err === null).length;
  return {
    total: sanitized.length,
    successful,
    failed: sanitized.length - successful,
    newSinceWindow: Math.max(0, sanitized.length - baselineCount),
    newest: sanitized[0] ?? null,
  };
}

function sanitizeSignatureHistorySummary(summary) {
  const counts = [
    summary?.total,
    summary?.successful,
    summary?.failed,
    summary?.newSinceWindow,
  ];
  if (counts.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error("signature history summary counts are invalid");
  }
  if (
    summary.successful + summary.failed !== summary.total ||
    summary.newSinceWindow > summary.total
  ) {
    throw new Error("signature history summary is inconsistent");
  }
  const newest = summary.newest;
  if (
    newest !== null &&
    (typeof newest?.signature !== "string" || !Number.isInteger(newest.slot))
  ) {
    throw new Error("signature history newest entry is invalid");
  }
  return {
    total: summary.total,
    successful: summary.successful,
    failed: summary.failed,
    newSinceWindow: summary.newSinceWindow,
    newest: newest
      ? {
          signature: newest.signature,
          slot: newest.slot,
          err: structuredClone(newest.err ?? null),
        }
      : null,
  };
}

export function recordWriteAttempt(state, attempt) {
  const next = structuredClone(state);
  const buffer = next.deployment?.buffer;
  if (!buffer || !Array.isArray(buffer.writeAttempts)) {
    throw new Error("deployment buffer state is required");
  }
  if (buffer.activeWindow && buffer.activeWindow.status !== "OPEN") {
    throw new Error("active write window is not open");
  }
  const attemptLimit = writeAttemptLimit(buffer);
  if (buffer.writeAttempts.length >= attemptLimit) {
    throw new Error("live write attempt limit is already reached");
  }
  const number = buffer.writeAttempts.length + 1;
  buffer.writeAttempts.push({
    number,
    startedAt: attempt.startedAt ?? null,
    completedAt: attempt.completedAt ?? null,
    outcome: attempt.outcome,
    signature: attempt.signature ?? null,
    ...(attempt.signatureHistoryAfter
      ? {
          signatureHistoryAfter: sanitizeSignatureHistorySummary(
            attempt.signatureHistoryAfter,
          ),
        }
      : {}),
  });
  const observed = attempt.observed ?? null;
  buffer.lastObservedComparison = observed
    ? {
        matchingBytes: observed.matchingBytes,
        totalBytes: observed.totalBytes,
        exactBinaryMatch: observed.status === "BUFFER_COMPLETE",
        progressReliability: "NOT_AN_UPLOAD_OFFSET",
      }
    : null;
  buffer.lastConfirmedProgress =
    observed?.status === "BUFFER_COMPLETE"
      ? {
          matchingBytes: observed.totalBytes,
          totalBytes: observed.totalBytes,
        }
      : null;
  buffer.status = observed?.status ?? "UNCERTAIN";
  buffer.lastRpcError =
    attempt.outcome === "SUCCESS" ? null : attempt.outcome;
  buffer.retryEligible =
    buffer.status === "BUFFER_WRITING" && number < attemptLimit;
  if (buffer.status === "BUFFER_COMPLETE") {
    buffer.retryEligible = false;
  }
  if (buffer.activeWindow) {
    buffer.activeWindow.attemptsUsed = number;
    buffer.activeWindow.status =
      buffer.status === "BUFFER_COMPLETE"
        ? "COMPLETE"
        : number >= buffer.activeWindow.maxAttempts
          ? "EXHAUSTED"
          : "OPEN";
  }
  return next;
}

export function openWriteWindow(state, input) {
  const next = structuredClone(state);
  const deployment = next.deployment;
  const buffer = deployment?.buffer;
  if (!buffer || buffer.publicKey !== input.expectedBufferPublicKey) {
    throw new Error("buffer identity mismatch while opening write window");
  }
  if (buffer.status !== "BUFFER_WRITING") {
    throw new Error(`cannot open write window from ${buffer.status}`);
  }
  if (buffer.activeWindow?.status === "OPEN") {
    throw new Error("a write window is already open");
  }
  if (!input.id || !input.openedAt) {
    throw new Error("write window id and openedAt are required");
  }
  const maxAttempts = input.maxAttempts ?? MAX_WRITE_ATTEMPTS;
  if (
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > MAX_WRITE_ATTEMPTS
  ) {
    throw new Error("write attempt limit must be between one and three");
  }

  buffer.writeWindows = Array.isArray(buffer.writeWindows)
    ? buffer.writeWindows
    : [];
  const priorAttempts = Array.isArray(buffer.writeAttempts)
    ? buffer.writeAttempts
    : [];
  if (priorAttempts.length > 0) {
    buffer.writeWindows.push({
      id: input.previousWindowId ?? "previous",
      status: deployment.verdict ?? "UNKNOWN",
      attempts: priorAttempts,
    });
  }
  buffer.writeAttempts = [];
  buffer.retryEligible = true;
  buffer.lastRpcError = null;
  buffer.activeWindow = {
    id: input.id,
    openedAt: input.openedAt,
    maxAttempts,
    attemptsUsed: 0,
    status: "OPEN",
    baselineSignatureCount: input.baselineSignatureCount ?? null,
    baselineNewestSignature: input.baselineNewestSignature ?? null,
  };
  deployment.verdict = "IN_PROGRESS";
  return next;
}

export async function executeWriteAttempt({
  state,
  argv,
  bufferArgument,
  localBytes,
  getBufferAccount,
  runner = spawnSync,
  queryAttempts = 3,
  queryDelayMs = 2_000,
  sleep = (duration) => sleepTimer(duration),
  now = () => new Date().toISOString(),
}) {
  const buffer = state.deployment?.buffer;
  if (!buffer) {
    throw new Error("deployment buffer state is required");
  }
  if (buffer.writeAttempts.length >= writeAttemptLimit(buffer)) {
    throw new Error("live write attempt limit is already reached");
  }
  if (!Array.isArray(argv)) {
    throw new Error("write command argv is required");
  }
  const bufferIndexes = argv
    .map((value, index) => (value === "--buffer" ? index : -1))
    .filter((index) => index >= 0);
  if (bufferIndexes.length !== 1) {
    throw new Error("write command must contain exactly one --buffer");
  }
  if (!bufferArgument || argv[bufferIndexes[0] + 1] !== bufferArgument) {
    throw new Error("write command does not use the recorded buffer argument");
  }
  const startedAt = now();
  const command = runCapturedCommand("solana", argv, { runner });
  const failure = command.ok
    ? { classification: "SUCCESS", retryable: false }
    : classifyCliError(`${command.stderr}\n${command.stdout}`);

  let account = null;
  let queries = 0;
  let lastQueryError = null;
  for (let attempt = 1; attempt <= queryAttempts; attempt += 1) {
    queries = attempt;
    try {
      account = await getBufferAccount();
      if (account) {
        break;
      }
    } catch (error) {
      lastQueryError = error;
    }
    if (attempt < queryAttempts) {
      await sleep(queryDelayMs);
    }
  }
  const observed = account
    ? inspectUpgradeableBuffer(account, {
        publicKey: buffer.publicKey,
        expectedOwner: buffer.expectedOwner,
        expectedAuthority: buffer.expectedAuthority,
        allocatedLength: buffer.allocatedLength,
        localBytes,
      })
    : null;
  const completedAt = now();
  const next = recordWriteAttempt(state, {
    startedAt,
    completedAt,
    outcome: lastQueryError && !observed
      ? "RPC_QUERY_FAILURE"
      : failure.classification,
    observed,
  });
  return {
    state: next,
    command: { ok: command.ok, status: command.status },
    observed,
    queries,
  };
}
