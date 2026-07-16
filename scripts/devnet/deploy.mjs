import { assertAllowedRpcUrl } from "./safety.mjs";

export const UPGRADEABLE_LOADER =
  "BPFLoaderUpgradeab1e11111111111111111111111";

export function buildDeployCommand({
  rpcUrl,
  binaryPath,
  binaryLength,
  authorityPath,
  programKeypairPath,
}) {
  assertAllowedRpcUrl(rpcUrl, "devnet");
  if (!authorityPath) {
    throw new Error("explicit deployment authority path is required");
  }
  if (!programKeypairPath) {
    throw new Error("explicit program keypair path is required");
  }
  if (!binaryPath || !Number.isInteger(binaryLength) || binaryLength <= 0) {
    throw new Error("verified deployment binary and length are required");
  }
  return [
    "program",
    "deploy",
    "--url",
    rpcUrl,
    "--use-rpc",
    "--keypair",
    authorityPath,
    "--fee-payer",
    authorityPath,
    "--program-id",
    programKeypairPath,
    "--upgrade-authority",
    authorityPath,
    "--max-len",
    String(binaryLength),
    "--output",
    "json",
    binaryPath,
  ];
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
