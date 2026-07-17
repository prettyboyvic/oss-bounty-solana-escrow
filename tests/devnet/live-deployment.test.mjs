import assert from "node:assert/strict";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";

import {
  assertSafeCapturedOutput,
  classifyCliError,
  executeWriteAttempt,
  inspectUpgradeableBuffer,
  recordWriteAttempt,
  runCapturedCommand,
} from "../../scripts/devnet/live-deployment.mjs";

const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const AUTHORITY = "Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk";
const BUFFER = "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW";

function bufferAccount(programBytes) {
  const data = Buffer.alloc(37 + programBytes.length);
  data.writeUInt32LE(1, 0);
  data[4] = 1;
  new PublicKey(AUTHORITY).toBuffer().copy(data, 5);
  programBytes.copy(data, 37);
  return {
    owner: new PublicKey(LOADER),
    executable: false,
    lamports: 1,
    data,
  };
}

test("inspects exact and partial upgradeable-loader buffer bytes", () => {
  const local = Buffer.from([1, 2, 3, 4]);
  assert.deepEqual(
    inspectUpgradeableBuffer(bufferAccount(local), {
      publicKey: BUFFER,
      expectedOwner: LOADER,
      expectedAuthority: AUTHORITY,
      allocatedLength: 41,
      localBytes: local,
    }),
    {
      publicKey: BUFFER,
      owner: LOADER,
      authority: AUTHORITY,
      dataLength: 41,
      matchingBytes: 4,
      totalBytes: 4,
      exactBinaryMatch: true,
      status: "BUFFER_COMPLETE",
    },
  );

  const partial = inspectUpgradeableBuffer(
    bufferAccount(Buffer.from([1, 2, 0, 0])),
    {
      publicKey: BUFFER,
      expectedOwner: LOADER,
      expectedAuthority: AUTHORITY,
      allocatedLength: 41,
      localBytes: local,
    },
  );
  assert.equal(partial.status, "BUFFER_WRITING");
  assert.equal(partial.matchingBytes, 2);
  assert.equal(partial.exactBinaryMatch, false);
});

test("buffer inspection rejects wrong owner, authority, allocation and state", () => {
  const local = Buffer.from([1, 2, 3, 4]);
  const expected = {
    publicKey: BUFFER,
    expectedOwner: LOADER,
    expectedAuthority: AUTHORITY,
    allocatedLength: 41,
    localBytes: local,
  };
  assert.throws(
    () => inspectUpgradeableBuffer({ ...bufferAccount(local), owner: PublicKey.default }, expected),
    /owner mismatch/,
  );
  const wrongAuthority = bufferAccount(local);
  PublicKey.default.toBuffer().copy(wrongAuthority.data, 5);
  assert.throws(
    () => inspectUpgradeableBuffer(wrongAuthority, expected),
    /authority mismatch/,
  );
  assert.throws(
    () => inspectUpgradeableBuffer(bufferAccount(Buffer.alloc(5)), expected),
    /allocation mismatch/,
  );
  const wrongState = bufferAccount(local);
  wrongState.data.writeUInt32LE(2, 0);
  assert.throws(
    () => inspectUpgradeableBuffer(wrongState, expected),
    /state mismatch/,
  );
});

test("captured command uses argv and never exposes recovery material", () => {
  const calls = [];
  const result = runCapturedCommand("solana", ["program", "show", BUFFER], {
    runner(file, argv, options) {
      calls.push({ file, argv, options });
      return { status: 0, stdout: '{"ok":true}', stderr: "" };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].argv, ["program", "show", BUFFER]);
  assert.equal(calls[0].options.shell, false);

  assert.throws(
    () =>
      assertSafeCapturedOutput(
        "Recover the ephemeral keypair with this seed phrase: word ".repeat(12),
      ),
    /REVISE_SECURITY_BOUNDARY/,
  );
  assert.throws(
    () => assertSafeCapturedOutput(`[${Array(64).fill(7).join(",")}]`),
    /REVISE_SECURITY_BOUNDARY/,
  );
});

test("classifies bounded retry errors without retaining raw output", () => {
  assert.deepEqual(classifyCliError("429 Too Many Requests"), {
    classification: "RPC_RATE_LIMIT",
    retryable: true,
  });
  assert.deepEqual(classifyCliError("Max retries exceeded"), {
    classification: "RPC_MAX_RETRIES",
    retryable: true,
  });
  assert.deepEqual(classifyCliError("request timed out"), {
    classification: "RPC_TIMEOUT",
    retryable: true,
  });
  assert.deepEqual(classifyCliError("transaction failed"), {
    classification: "CLI_FAILURE",
    retryable: false,
  });
});

test("records no more than three public write attempts", () => {
  let state = {
    deployment: {
      buffer: {
        status: "PLANNED",
        writeAttempts: [],
        lastConfirmedProgress: null,
        lastRpcError: null,
        retryEligible: true,
      },
    },
  };
  state = recordWriteAttempt(state, {
    startedAt: "a",
    completedAt: "b",
    outcome: "RPC_RATE_LIMIT",
    observed: { status: "BUFFER_WRITING", matchingBytes: 10, totalBytes: 20 },
  });
  assert.equal(state.deployment.buffer.status, "BUFFER_WRITING");
  assert.equal(state.deployment.buffer.lastConfirmedProgress, null);
  assert.deepEqual(state.deployment.buffer.lastObservedComparison, {
    matchingBytes: 10,
    totalBytes: 20,
    exactBinaryMatch: false,
    progressReliability: "NOT_AN_UPLOAD_OFFSET",
  });
  assert.equal(JSON.stringify(state).includes("Too Many Requests"), false);

  state = recordWriteAttempt(state, {
    startedAt: "c",
    completedAt: "d",
    outcome: "SUCCESS",
    observed: { status: "BUFFER_COMPLETE", matchingBytes: 20, totalBytes: 20 },
  });
  assert.equal(state.deployment.buffer.status, "BUFFER_COMPLETE");
  assert.equal(state.deployment.buffer.retryEligible, false);

  state.deployment.buffer.writeAttempts.push({ number: 3 });
  assert.throws(
    () => recordWriteAttempt(state, { outcome: "SUCCESS" }),
    /three live write attempts/,
  );
});

test("executes one explicit attempt and persists verified completion", async () => {
  const local = Buffer.from([1, 2, 3, 4]);
  const state = {
    deployment: {
      buffer: {
        publicKey: BUFFER,
        expectedOwner: LOADER,
        expectedAuthority: AUTHORITY,
        allocatedLength: 41,
        status: "PLANNED",
        writeAttempts: [],
        lastConfirmedProgress: null,
        lastRpcError: null,
        retryEligible: true,
      },
    },
  };
  const result = await executeWriteAttempt({
    state,
    argv: ["program", "write-buffer", "--buffer", "fixed-path"],
    bufferArgument: "fixed-path",
    localBytes: local,
    runner: () => ({ status: 0, stdout: '{"buffer":"public"}', stderr: "" }),
    getBufferAccount: async () => bufferAccount(local),
    now: (() => {
      const values = ["start", "finish"];
      return () => values.shift();
    })(),
  });
  assert.equal(result.state.deployment.buffer.status, "BUFFER_COMPLETE");
  assert.equal(result.state.deployment.buffer.writeAttempts.length, 1);
  assert.equal(JSON.stringify(result.state).includes("stdout"), false);
  assert.equal(result.observed.exactBinaryMatch, true);
});

test("rate limit preserves partial buffer and absent account becomes uncertain", async () => {
  const local = Buffer.from([1, 2, 3, 4]);
  const base = {
    deployment: {
      buffer: {
        publicKey: BUFFER,
        expectedOwner: LOADER,
        expectedAuthority: AUTHORITY,
        allocatedLength: 41,
        status: "PLANNED",
        writeAttempts: [],
        lastConfirmedProgress: null,
        lastRpcError: null,
        retryEligible: true,
      },
    },
  };
  const partial = await executeWriteAttempt({
    state: base,
    argv: ["program", "write-buffer", "--buffer", "fixed-path"],
    bufferArgument: "fixed-path",
    localBytes: local,
    runner: () => ({ status: 1, stdout: "", stderr: "429 Too Many Requests" }),
    getBufferAccount: async () => bufferAccount(Buffer.from([1, 2, 0, 0])),
    now: () => "time",
  });
  assert.equal(partial.state.deployment.buffer.status, "BUFFER_WRITING");
  assert.equal(partial.state.deployment.buffer.retryEligible, true);
  assert.equal(partial.state.deployment.buffer.lastRpcError, "RPC_RATE_LIMIT");

  const absent = await executeWriteAttempt({
    state: base,
    argv: ["program", "write-buffer", "--buffer", "fixed-path"],
    bufferArgument: "fixed-path",
    localBytes: local,
    runner: () => ({ status: 1, stdout: "", stderr: "request timed out" }),
    getBufferAccount: async () => null,
    queryAttempts: 2,
    sleep: async () => {},
    now: () => "time",
  });
  assert.equal(absent.state.deployment.buffer.status, "UNCERTAIN");
  assert.equal(absent.state.deployment.buffer.retryEligible, false);
  assert.equal(absent.queries, 2);
});

test("write execution requires exactly the recorded buffer argument", async () => {
  const state = {
    deployment: {
      buffer: {
        publicKey: BUFFER,
        expectedOwner: LOADER,
        expectedAuthority: AUTHORITY,
        allocatedLength: 41,
        status: "PLANNED",
        writeAttempts: [],
        lastConfirmedProgress: null,
        lastRpcError: null,
        retryEligible: true,
      },
    },
  };
  let runs = 0;
  const common = {
    state,
    localBytes: Buffer.from([1, 2, 3, 4]),
    bufferArgument: "fixed-path",
    runner: () => {
      runs += 1;
      return { status: 0, stdout: "", stderr: "" };
    },
    getBufferAccount: async () => null,
    sleep: async () => {},
  };

  await assert.rejects(
    executeWriteAttempt({
      ...common,
      argv: ["program", "write-buffer", "--buffer", "other-path"],
    }),
    /recorded buffer argument/,
  );
  await assert.rejects(
    executeWriteAttempt({
      ...common,
      argv: [
        "program",
        "write-buffer",
        "--buffer",
        "fixed-path",
        "--buffer",
        "fixed-path",
      ],
    }),
    /exactly one --buffer/,
  );
  assert.equal(runs, 0);
});
