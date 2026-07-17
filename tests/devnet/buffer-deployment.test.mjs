import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildCloseBufferCommand,
  buildFinalizeBufferCommand,
  buildWriteBufferCommand,
  classifyBufferLifecycle,
  classifyWriteOutcome,
} from "../../scripts/devnet/deploy.mjs";

const RPC = "https://api.devnet.solana.com";
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const AUTHORITY = "Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk";
const BUFFER = "11111111111111111111111111111111";
const PROGRAM = "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z";

function commandInput() {
  const repoRoot = mkdtempSync(join(tmpdir(), "buffer-command-"));
  return {
    repoRoot,
    rpcUrl: RPC,
    binaryPath: join(repoRoot, "target", "program.so"),
    binaryLength: 395144,
    authorityPath: join(
      repoRoot,
      ".devnet",
      "deployment-authority.devnet-keypair.json",
    ),
    bufferSignerPath: join(
      repoRoot,
      ".devnet",
      "deploy-buffer.devnet-keypair.json",
    ),
    programKeypairPath: join(
      repoRoot,
      ".devnet",
      "program.devnet-keypair.json",
    ),
    authorityPublicKey: AUTHORITY,
    bufferPublicKey: BUFFER,
  };
}

test("write-buffer always supplies the repository-managed buffer signer", () => {
  const input = commandInput();
  const args = buildWriteBufferCommand(input);

  assert.deepEqual(args, [
    "program",
    "write-buffer",
    "--url",
    RPC,
    "--use-rpc",
    "--keypair",
    input.authorityPath,
    "--fee-payer",
    input.authorityPath,
    "--buffer",
    input.bufferSignerPath,
    "--buffer-authority",
    input.authorityPath,
    "--max-len",
    "395144",
    "--output",
    "json",
    input.binaryPath,
  ]);
  assert.equal(args.includes("--skip-preflight"), false);
});

test("finalize uses the same explicit buffer and no program filepath", () => {
  const input = commandInput();
  const args = buildFinalizeBufferCommand(input);

  assert.deepEqual(args, [
    "program",
    "deploy",
    "--url",
    RPC,
    "--use-rpc",
    "--keypair",
    input.authorityPath,
    "--fee-payer",
    input.authorityPath,
    "--program-id",
    input.programKeypairPath,
    "--buffer",
    input.bufferPublicKey,
    "--upgrade-authority",
    input.authorityPath,
    "--max-len",
    "395144",
    "--output",
    "json",
  ]);
  assert.equal(args.includes(input.binaryPath), false);
  assert.equal(args.includes(input.bufferSignerPath), false);
  assert.equal(args.includes("--final"), false);
});

test("buffer signer must stay under .devnet and argv contains no secret material", () => {
  const input = commandInput();
  assert.throws(
    () =>
      buildWriteBufferCommand({
        ...input,
        bufferSignerPath: join(input.repoRoot, "outside-keypair.json"),
      }),
    /\.devnet/,
  );

  const serialized = JSON.stringify(buildWriteBufferCommand(input));
  assert.doesNotMatch(serialized, /mnemonic|seed phrase|secretKey|\[(\d+,){10}/i);
});

test("valid partial buffer resumes and complete buffer finalizes", () => {
  const localBytes = Buffer.from([1, 2, 3, 4]);
  const expected = {
    publicKey: BUFFER,
    owner: LOADER,
    authority: AUTHORITY,
    allocatedLength: 41,
    localBytes,
  };

  assert.deepEqual(
    classifyBufferLifecycle(
      {
        publicKey: BUFFER,
        owner: LOADER,
        authority: AUTHORITY,
        dataLength: 41,
        programBytes: Buffer.from([1, 2, 0, 0]),
      },
      expected,
      null,
    ),
    { status: "BUFFER_WRITING", action: "RESUME", retryEligible: true },
  );
  assert.deepEqual(
    classifyBufferLifecycle(
      {
        publicKey: BUFFER,
        owner: LOADER,
        authority: AUTHORITY,
        dataLength: 41,
        programBytes: localBytes,
      },
      expected,
      null,
    ),
    { status: "BUFFER_COMPLETE", action: "FINALIZE", retryEligible: true },
  );
});

test("buffer owner, authority, allocation and recorded address mismatches reject", () => {
  const expected = {
    publicKey: BUFFER,
    owner: LOADER,
    authority: AUTHORITY,
    allocatedLength: 41,
    localBytes: Buffer.from([1, 2, 3, 4]),
  };
  const observed = {
    publicKey: BUFFER,
    owner: LOADER,
    authority: AUTHORITY,
    dataLength: 41,
    programBytes: Buffer.from([1, 2, 0, 0]),
  };

  for (const [change, message] of [
    [{ owner: "OtherLoader" }, /owner mismatch/],
    [{ authority: "other" }, /authority mismatch/],
    [{ dataLength: 42 }, /allocation mismatch/],
    [{ publicKey: PROGRAM }, /recorded address mismatch/],
  ]) {
    assert.throws(
      () => classifyBufferLifecycle({ ...observed, ...change }, expected, null),
      message,
    );
  }
});

test("absent recorded buffer is uncertain after a creation signature", () => {
  assert.deepEqual(
    classifyBufferLifecycle(
      null,
      {
        publicKey: BUFFER,
        owner: LOADER,
        authority: AUTHORITY,
        allocatedLength: 41,
        localBytes: Buffer.from([1, 2, 3, 4]),
        creationSignature: "recorded-signature",
      },
      null,
    ),
    {
      status: "UNCERTAIN",
      action: "STOP",
      retryEligible: false,
      reason: "recorded buffer creation is not observable",
    },
  );
});

test("RPC 429 preserves the signer and confirmed failure is never success", () => {
  assert.deepEqual(classifyWriteOutcome({ rpcErrorCode: 429 }), {
    status: "BUFFER_WRITING",
    retryEligible: true,
    regenerateBuffer: false,
    errorClassification: "RPC_RATE_LIMIT",
  });
  assert.deepEqual(
    classifyWriteOutcome({
      signature: "failed-signature",
      slot: 123,
      metaErr: { InstructionError: [0, "Custom"] },
    }),
    {
      status: "CONFIRMED_FAILED",
      retryEligible: false,
      regenerateBuffer: false,
      signature: "failed-signature",
      slot: 123,
    },
  );
});

test("terminal deployed program never uploads again", () => {
  assert.deepEqual(
    classifyBufferLifecycle(
      null,
      {
        publicKey: BUFFER,
        owner: LOADER,
        authority: AUTHORITY,
        allocatedLength: 41,
        localBytes: Buffer.from([1, 2, 3, 4]),
      },
      { executable: true, exactBinaryMatch: true },
    ),
    {
      status: "PROGRAM_DEPLOYED",
      action: "NONE",
      retryEligible: false,
    },
  );
});

test("close buffer requires an explicit recovery decision", () => {
  const input = commandInput();
  assert.throws(() => buildCloseBufferCommand(input), /explicit recovery decision/);
  const args = buildCloseBufferCommand({
    ...input,
    recoveryDecision: "CLOSE_BUFFER",
  });
  assert.deepEqual(args.slice(0, 3), ["program", "close", BUFFER]);
  assert.equal(args.includes(input.authorityPath), true);
  assert.equal(args.includes(AUTHORITY), true);
});
