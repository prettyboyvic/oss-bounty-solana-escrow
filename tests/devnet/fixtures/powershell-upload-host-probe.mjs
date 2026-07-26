import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runOwnedHostChild,
  runUploadWindowHost,
  verifyAuthorizationManifest,
} from "../../../scripts/devnet/upload-window-host.mjs";

const FAKE_CHILD = fileURLToPath(new URL("./fake-upload-supervisor.mjs", import.meta.url));
const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const argv = process.argv.slice(2);

const result = await runUploadWindowHost(argv, {
  repoRoot,
  async verifyManifest(parsed) {
    const state = {
      schemaVersion: 3,
      deployment: {
        buffer: {
          planFingerprint: parsed.manifest.expectedPlanFingerprint,
          chunks: [0, 1, 2, 3, 4].map((index) => ({
            index,
            offset: index * 2,
            length: 2,
            sha256: "a".repeat(64),
            status: "PLANNED",
            signature: null,
          })),
        },
      },
    };
    const stateBytes = Buffer.from(JSON.stringify(state));
    const binaryBytes = Buffer.from("abcdefghij");
    return verifyAuthorizationManifest(parsed, {
      repoRoot,
      collectRepositorySnapshot: async () => ({
        root: repoRoot,
        branch: "main",
        head: parsed.manifest.expectedRepositorySha,
        originMain: parsed.manifest.expectedRepositorySha,
        ahead: 0,
        behind: 0,
        clean: true,
        gitOperationActive: false,
        resultRootIgnored: true,
      }),
      pathExists: () => false,
      readStateBytes: () => stateBytes,
      readBinaryBytes: () => binaryBytes,
      sha256(bytes) {
        if (bytes === stateBytes) return parsed.manifest.expectedStateSha;
        if (bytes === binaryBytes) return parsed.manifest.expectedBinarySha;
        return "a".repeat(64);
      },
      buildCandidateEvidenceDigest: () => ({
        schema: "R4_CANDIDATE_EVIDENCE_V1",
        sha256: parsed.manifest.expectedCandidateEvidenceSha,
      }),
      verifyFinalizedBuffer: async () => ({
        sha256: parsed.manifest.expectedBufferSha,
      }),
    });
  },
  runChild(input) {
    return runOwnedHostChild({
      ...input,
      command: process.execPath,
      args: [FAKE_CHILD, "--mode", "success"],
    });
  },
  emitFinal: () => {},
  emitEmergency: () => {},
});

process.stdout.write(`${JSON.stringify({
  verdict: result.verdict,
  exitCode: result.exitCode,
  childSpawnCount: result.childSpawnCount,
  durableResultPersisted: result.durableResultPersisted,
  errorSummary: result.errorSummary ?? null,
})}\n`);
