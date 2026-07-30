export const ESCROW_ERROR_CODES = Object.freeze({
  6000: "InvalidStatus",
  6001: "InvalidAmount",
  6002: "InvalidExpiry",
  6003: "InvalidMaintainer",
  6004: "InvalidContributor",
  6005: "InvalidContributorTokenOwner",
  6006: "UnauthorizedSponsor",
  6007: "EscrowExpired",
  6008: "EscrowNotExpired",
  6009: "InvalidVault",
  6010: "InvalidExternalReference",
});

export const ANCHOR_ERROR_CODES = Object.freeze({
  2001: "ConstraintHasOne",
});

export const RECOGNIZED_PROGRAM_ERROR_NAMES = Object.freeze([
  ...Object.values(ESCROW_ERROR_CODES),
  ...Object.values(ANCHOR_ERROR_CODES),
]);

const RUNTIME_CUSTOM_FAILURE =
  /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) failed: custom program error: (0x[0-9a-fA-F]+|[0-9]+)$/;
const RUNTIME_LOG_TRUNCATION = /^log truncated$/i;

export function effectiveExpectedErrorNames(event) {
  return Object.freeze(
    event.expectedErrors.filter((value) => value !== null),
  );
}

function codeName(code) {
  return ESCROW_ERROR_CODES[code] ?? ANCHOR_ERROR_CODES[code] ?? null;
}

function parseRuntimeFailure(line) {
  if (typeof line !== "string") return null;
  const match = RUNTIME_CUSTOM_FAILURE.exec(line);
  if (!match) return null;
  const code = match[2].startsWith("0x")
    ? Number.parseInt(match[2].slice(2), 16)
    : Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(code)) return null;
  return Object.freeze({ programId: match[1], code });
}

function runtimeFailureEvidence(logs) {
  if (!Array.isArray(logs)) {
    return Object.freeze({
      failures: Object.freeze([]),
      unparseable: false,
      truncated: false,
    });
  }
  const failures = [];
  let unparseable = false;
  let truncated = false;
  for (const line of logs) {
    if (
      typeof line === "string" &&
      RUNTIME_LOG_TRUNCATION.test(line.trim())
    ) {
      truncated = true;
    }
    const looksLikeCustomFailure =
      typeof line === "string" &&
      line.startsWith("Program ") &&
      line.includes(" failed: custom program error:");
    const failure = parseRuntimeFailure(line);
    if (failure) {
      failures.push(failure);
    } else if (looksLikeCustomFailure) {
      unparseable = true;
    }
  }
  return Object.freeze({
    failures: Object.freeze(failures),
    unparseable,
    truncated,
  });
}

export function decodeProgramError({ err, logs } = {}) {
  let instructionIndex = null;
  let code = null;
  if (err && typeof err === "object" && Array.isArray(err.InstructionError)) {
    instructionIndex = Number.isInteger(err.InstructionError[0])
      ? err.InstructionError[0]
      : null;
    const detail = err.InstructionError[1];
    if (detail && typeof detail === "object" && Number.isInteger(detail.Custom)) {
      code = detail.Custom;
    }
  }

  const structuredCode = code;
  if (code === null) {
    code = runtimeFailureEvidence(logs).failures[0]?.code ?? null;
  }
  const recognizedName = code === null ? null : codeName(code);
  const diagnosticLogName =
    recognizedName === null && Array.isArray(logs)
      ? logs
          .map(
            (line) =>
              /Error Code:\s*([A-Za-z0-9_]+)/.exec(line)?.[1] ?? null,
          )
          .find((value) => value !== null) ?? null
      : null;

  return Object.freeze({
    code,
    name: recognizedName ?? diagnosticLogName,
    instructionIndex,
    structured:
      Number.isInteger(instructionIndex) &&
      Number.isInteger(structuredCode) &&
      codeName(structuredCode) !== null,
  });
}

function publicKeyString(value) {
  return typeof value?.toBase58 === "function" ? value.toBase58() : String(value);
}

export function classifyExpectedSimulationError({
  result,
  instructions,
  expectedProgramId,
  event,
}) {
  const decoded = decodeProgramError(result);
  if (result?.err === null || result?.err === undefined) {
    return Object.freeze({ status: "UNEXPECTED_SUCCESS", decoded });
  }

  const indexedInstruction =
    Number.isInteger(decoded.instructionIndex) &&
    decoded.instructionIndex >= 0 &&
    Array.isArray(instructions) &&
    decoded.instructionIndex < instructions.length
      ? instructions[decoded.instructionIndex]
      : null;
  const topLevelEscrowInstruction =
    decoded.structured &&
    indexedInstruction !== null &&
    publicKeyString(indexedInstruction.programId) ===
      publicKeyString(expectedProgramId);
  if (!topLevelEscrowInstruction) {
    return Object.freeze({ status: "INCONCLUSIVE", decoded });
  }

  const runtime = runtimeFailureEvidence(result.logs);
  const contradictory =
    runtime.truncated ||
    runtime.unparseable ||
    runtime.failures.length === 0 ||
    runtime.failures.some((failure) => failure.code !== decoded.code);
  if (contradictory) {
    return Object.freeze({ status: "INCONCLUSIVE", decoded });
  }

  const earliestFailure = runtime.failures[0];
  if (
    publicKeyString(earliestFailure.programId) !==
    publicKeyString(expectedProgramId)
  ) {
    return Object.freeze({ status: "INCONCLUSIVE", decoded });
  }

  const expected = effectiveExpectedErrorNames(event);
  return Object.freeze({
    status: expected.includes(decoded.name)
      ? "EXPECTED_ERROR"
      : "UNEXPECTED_ERROR",
    decoded,
  });
}
