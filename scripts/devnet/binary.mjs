import { createHash } from "node:crypto";

export function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

export function compareProgramBytes(
  localBytes,
  dumpBytes,
  reportedDataLength,
  { dumpSemantics } = {},
) {
  const local = Buffer.from(localBytes);
  const dump = Buffer.from(dumpBytes);
  if (reportedDataLength !== dump.length) {
    throw new Error(
      `reported ProgramData length ${reportedDataLength} differs from raw dump length ${dump.length}`,
    );
  }
  if (dump.length < local.length) {
    throw new Error("onchain dump is shorter than local artifact");
  }
  if (!dump.subarray(0, local.length).equals(local)) {
    throw new Error("onchain executable bytes differ from local artifact");
  }

  const padding = dump.subarray(local.length);
  const paddingAllZero = padding.every((byte) => byte === 0);
  if (!paddingAllZero) {
    throw new Error("onchain dump has nonzero allocation padding");
  }
  if (
    padding.length > 0 &&
    dumpSemantics !== "upgradeable-programdata-allocation"
  ) {
    throw new Error("upgradeable-loader allocation padding semantics are not proven");
  }
  const canonical = dump.subarray(0, local.length);

  return {
    localLength: local.length,
    onchainRawLength: dump.length,
    reportedDataLength,
    localRawSha256: hashBytes(local),
    onchainRawSha256: hashBytes(dump),
    onchainCanonicalLength: canonical.length,
    onchainCanonicalSha256: hashBytes(canonical),
    paddingLength: padding.length,
    paddingAllZero,
    paddingSemantics:
      padding.length === 0
        ? "none"
        : "upgradeable-programdata-allocation",
    exactExecutableMatch: true,
  };
}
