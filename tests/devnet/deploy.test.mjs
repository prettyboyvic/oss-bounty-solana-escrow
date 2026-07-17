import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildDeployCommand,
  classifyProgramAccount,
  recoverDeployment,
} from "../../scripts/devnet/deploy.mjs";

const REPO_ROOT = mkdtempSync(join(tmpdir(), "deploy-command-"));
const INPUT = {
  repoRoot: REPO_ROOT,
  rpcUrl: "https://api.devnet.solana.com",
  binaryPath: join(REPO_ROOT, "target", "program.so"),
  binaryLength: 395144,
  authorityPath: join(REPO_ROOT, ".devnet", "deployment-authority.devnet-keypair.json"),
  programKeypairPath: join(REPO_ROOT, ".devnet", "program.devnet-keypair.json"),
  bufferSignerPath: join(REPO_ROOT, ".devnet", "deploy-buffer.devnet-keypair.json"),
};

test("deploy command uses explicit devnet identities and exact max length", () => {
  const args = buildDeployCommand(INPUT);
  assert.deepEqual(args, [
    "program",
    "deploy",
    "--url",
    INPUT.rpcUrl,
    "--use-rpc",
    "--keypair",
    INPUT.authorityPath,
    "--fee-payer",
    INPUT.authorityPath,
    "--program-id",
    INPUT.programKeypairPath,
    "--buffer",
    INPUT.bufferSignerPath,
    "--upgrade-authority",
    INPUT.authorityPath,
    "--max-len",
    String(INPUT.binaryLength),
    "--output",
    "json",
    INPUT.binaryPath,
  ]);
  assert.equal(args.includes("--final"), false);
});

test("deploy command rejects mainnet and missing explicit paths", () => {
  assert.throws(
    () => buildDeployCommand({ ...INPUT, rpcUrl: "mainnet-beta" }),
    /explicit Solana devnet RPC/,
  );
  assert.throws(
    () => buildDeployCommand({ ...INPUT, authorityPath: "" }),
    /authority path/,
  );
  assert.throws(
    () => buildDeployCommand({ ...INPUT, bufferSignerPath: "" }),
    /buffer signer/,
  );
});

test("absent program selects initial deploy", () => {
  assert.deepEqual(
    classifyProgramAccount(null, {
      authority: "authority",
      binaryMatch: false,
    }),
    { disposition: "initial_deploy" },
  );
});

test("matching executable program selects recovery without redeploy", () => {
  assert.deepEqual(
    classifyProgramAccount(
      {
        executable: true,
        owner: "BPFLoaderUpgradeab1e11111111111111111111111",
        authority: "authority",
      },
      { authority: "authority", binaryMatch: true },
    ),
    { disposition: "recovered", redeploy: false },
  );
});

test("existing authority, loader, executable or binary mismatch is BLOCKED", () => {
  for (const [observed, expectedText] of [
    [
      {
        executable: true,
        owner: "BPFLoaderUpgradeab1e11111111111111111111111",
        authority: "other",
      },
      "authority mismatch",
    ],
    [
      {
        executable: false,
        owner: "BPFLoaderUpgradeab1e11111111111111111111111",
        authority: "authority",
      },
      "not executable",
    ],
    [
      { executable: true, owner: "OtherLoader", authority: "authority" },
      "loader mismatch",
    ],
  ]) {
    assert.throws(
      () =>
        classifyProgramAccount(observed, {
          authority: "authority",
          binaryMatch: true,
        }),
      new RegExp(expectedText),
    );
  }
  assert.throws(
    () =>
      classifyProgramAccount(
        {
          executable: true,
          owner: "BPFLoaderUpgradeab1e11111111111111111111111",
          authority: "authority",
        },
        { authority: "authority", binaryMatch: false },
      ),
    /binary mismatch/,
  );
});

test("uncertain deployment recovers only from a complete account and binary match", () => {
  assert.deepEqual(
    recoverDeployment(
      {
        executable: true,
        owner: "BPFLoaderUpgradeab1e11111111111111111111111",
        authority: "authority",
      },
      { authority: "authority" },
      { exactExecutableMatch: true },
    ),
    {
      status: "recovered",
      provenance: "recovered",
      redeploy: false,
    },
  );

  assert.throws(
    () =>
      recoverDeployment(
        {
          executable: true,
          owner: "BPFLoaderUpgradeab1e11111111111111111111111",
          authority: "authority",
        },
        { authority: "authority" },
        null,
      ),
    /binary verification is required/,
  );
});

test("uncertain deployment never retries while the canonical account is absent", () => {
  assert.deepEqual(
    recoverDeployment(null, { authority: "authority" }, null),
    {
      status: "unresolved",
      provenance: "uncertain",
      redeploy: false,
      reason: "canonical program account is absent",
    },
  );
});
