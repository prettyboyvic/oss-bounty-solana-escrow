import {
  assertAllowedRpcUrl,
  assertSignerPathContained,
} from "./safety.mjs";

export const UPGRADEABLE_LOADER =
  "BPFLoaderUpgradeab1e11111111111111111111111";

export function buildDeployCommand({
  repoRoot,
  rpcUrl,
  binaryPath,
  binaryLength,
  authorityPath,
  programKeypairPath,
  bufferSignerPath,
}) {
  assertAllowedRpcUrl(rpcUrl, "devnet");
  const paths = validateDeploymentPaths({
    repoRoot,
    authorityPath,
    programKeypairPath,
    bufferSignerPath,
  });
  assertBinary(binaryPath, binaryLength);
  return [
    "program",
    "deploy",
    "--url",
    rpcUrl,
    "--use-rpc",
    "--keypair",
    paths.authorityPath,
    "--fee-payer",
    paths.authorityPath,
    "--program-id",
    paths.programKeypairPath,
    "--buffer",
    paths.bufferSignerPath,
    "--upgrade-authority",
    paths.authorityPath,
    "--max-len",
    String(binaryLength),
    "--output",
    "json",
    binaryPath,
  ];
}

function assertBinary(binaryPath, binaryLength) {
  if (!binaryPath || !Number.isInteger(binaryLength) || binaryLength <= 0) {
    throw new Error("verified deployment binary and length are required");
  }
}

function validateDeploymentPaths({
  repoRoot,
  authorityPath,
  programKeypairPath,
  bufferSignerPath,
}) {
  if (!repoRoot) {
    throw new Error("repository root is required for signer containment");
  }
  if (!authorityPath) {
    throw new Error("explicit deployment authority path is required");
  }
  if (!programKeypairPath) {
    throw new Error("explicit program keypair path is required");
  }
  if (!bufferSignerPath) {
    throw new Error("explicit repository-managed buffer signer is required");
  }
  return {
    authorityPath: assertSignerPathContained(repoRoot, authorityPath),
    programKeypairPath: assertSignerPathContained(repoRoot, programKeypairPath),
    bufferSignerPath: assertSignerPathContained(repoRoot, bufferSignerPath),
  };
}

function validateAuthorityPath(repoRoot, authorityPath) {
  if (!repoRoot) {
    throw new Error("repository root is required for signer containment");
  }
  if (!authorityPath) {
    throw new Error("explicit deployment authority path is required");
  }
  return assertSignerPathContained(repoRoot, authorityPath);
}

export function buildWriteBufferCommand(input) {
  assertAllowedRpcUrl(input.rpcUrl, "devnet");
  const paths = validateDeploymentPaths(input);
  assertBinary(input.binaryPath, input.binaryLength);
  return [
    "program",
    "write-buffer",
    "--url",
    input.rpcUrl,
    "--use-rpc",
    "--keypair",
    paths.authorityPath,
    "--fee-payer",
    paths.authorityPath,
    "--buffer",
    paths.bufferSignerPath,
    "--buffer-authority",
    paths.authorityPath,
    "--max-len",
    String(input.binaryLength),
    "--output",
    "json",
    input.binaryPath,
  ];
}

export function buildFinalizeBufferCommand(input) {
  assertAllowedRpcUrl(input.rpcUrl, "devnet");
  const authorityPath = validateAuthorityPath(
    input.repoRoot,
    input.authorityPath,
  );
  if (!input.programKeypairPath) {
    throw new Error("explicit program keypair path is required");
  }
  const programKeypairPath = assertSignerPathContained(
    input.repoRoot,
    input.programKeypairPath,
  );
  if (!input.bufferPublicKey) {
    throw new Error("recorded public buffer address is required");
  }
  assertBinary(input.binaryPath, input.binaryLength);
  return [
    "program",
    "deploy",
    "--url",
    input.rpcUrl,
    "--use-rpc",
    "--keypair",
    authorityPath,
    "--fee-payer",
    authorityPath,
    "--program-id",
    programKeypairPath,
    "--buffer",
    input.bufferPublicKey,
    "--upgrade-authority",
    authorityPath,
    "--max-len",
    String(input.binaryLength),
    "--output",
    "json",
  ];
}

export function buildCloseBufferCommand(input) {
  if (input.recoveryDecision !== "CLOSE_BUFFER") {
    throw new Error("buffer close requires an explicit recovery decision");
  }
  assertAllowedRpcUrl(input.rpcUrl, "devnet");
  const authorityPath = validateAuthorityPath(
    input.repoRoot,
    input.authorityPath,
  );
  if (!input.bufferPublicKey || !input.authorityPublicKey) {
    throw new Error("public buffer and recipient addresses are required");
  }
  return [
    "program",
    "close",
    input.bufferPublicKey,
    "--url",
    input.rpcUrl,
    "--keypair",
    authorityPath,
    "--authority",
    authorityPath,
    "--recipient",
    input.authorityPublicKey,
    "--output",
    "json",
  ];
}

export function classifyBufferLifecycle(observed, expected, programObserved) {
  if (programObserved?.executable) {
    if (!programObserved.exactBinaryMatch) {
      throw new Error("deployed program binary mismatch");
    }
    return {
      status: "PROGRAM_DEPLOYED",
      action: "NONE",
      retryEligible: false,
    };
  }
  if (observed === null) {
    if (expected.creationSignature) {
      return {
        status: "UNCERTAIN",
        action: "STOP",
        retryEligible: false,
        reason: "recorded buffer creation is not observable",
      };
    }
    return { status: "PLANNED", action: "CREATE", retryEligible: true };
  }
  if (observed.publicKey !== expected.publicKey) {
    throw new Error("buffer recorded address mismatch");
  }
  if (observed.owner !== expected.owner) {
    throw new Error("buffer owner mismatch");
  }
  if (observed.authority !== expected.authority) {
    throw new Error("buffer authority mismatch");
  }
  if (observed.dataLength !== expected.allocatedLength) {
    throw new Error("buffer allocation mismatch");
  }
  if (
    Buffer.isBuffer(observed.programBytes) &&
    Buffer.isBuffer(expected.localBytes) &&
    observed.programBytes.equals(expected.localBytes)
  ) {
    return {
      status: "BUFFER_COMPLETE",
      action: "FINALIZE",
      retryEligible: true,
    };
  }
  return {
    status: "BUFFER_WRITING",
    action: "RESUME",
    retryEligible: true,
  };
}

export function classifyWriteOutcome(observed) {
  if (observed.rpcErrorCode === 429) {
    return {
      status: "BUFFER_WRITING",
      retryEligible: true,
      regenerateBuffer: false,
      errorClassification: "RPC_RATE_LIMIT",
    };
  }
  if (observed.signature && observed.slot != null && observed.metaErr != null) {
    return {
      status: "CONFIRMED_FAILED",
      retryEligible: false,
      regenerateBuffer: false,
      signature: observed.signature,
      slot: observed.slot,
    };
  }
  if (observed.signature && observed.slot != null && observed.metaErr === null) {
    return {
      status: "CONFIRMED_SUCCESS",
      retryEligible: true,
      regenerateBuffer: false,
      signature: observed.signature,
      slot: observed.slot,
    };
  }
  return {
    status: "UNCERTAIN",
    retryEligible: false,
    regenerateBuffer: false,
    errorClassification: "UNCLASSIFIED",
  };
}

export function classifyProgramAccount(observed, expected) {
  if (observed === null) {
    return { disposition: "initial_deploy" };
  }
  if (!observed.executable) {
    throw new Error("existing canonical program account is not executable");
  }
  if (observed.owner !== UPGRADEABLE_LOADER) {
    throw new Error(
      `existing canonical program loader mismatch: ${observed.owner}`,
    );
  }
  if (observed.authority !== expected.authority) {
    throw new Error(
      `existing canonical program authority mismatch: ${observed.authority}`,
    );
  }
  if (!expected.binaryMatch) {
    throw new Error("existing canonical program binary mismatch");
  }
  return { disposition: "recovered", redeploy: false };
}

export function recoverDeployment(observed, expected, binaryEvidence) {
  if (observed === null) {
    return {
      status: "unresolved",
      provenance: "uncertain",
      redeploy: false,
      reason: "canonical program account is absent",
    };
  }
  if (!binaryEvidence?.exactExecutableMatch) {
    throw new Error("complete binary verification is required for recovery");
  }
  classifyProgramAccount(observed, {
    ...expected,
    binaryMatch: true,
  });
  return {
    status: "recovered",
    provenance: "recovered",
    redeploy: false,
  };
}
