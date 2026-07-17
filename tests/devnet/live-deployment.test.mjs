import assert from "node:assert/strict";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";

import {
  assertSafeCapturedOutput,
  classifyCliError,
  executeWriteAttempt,
  inspectUpgradeableBuffer,
  openWriteWindow,
  recordWriteAttempt,
  runCapturedCommand,
  summarizeSignatureHistory,
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
    /attempt limit/,
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

test("opens a new window without losing prior attempts or changing buffer", () => {
  const priorAttempts = [1, 2, 3].map((number) => ({
    number,
    outcome: "RPC_MAX_RETRIES",
  }));
  const state = {
    deployment: {
      verdict: "BLOCKED_WITH_RESUMABLE_BUFFER",
      buffer: {
        publicKey: BUFFER,
        status: "BUFFER_WRITING",
        creationSignature: "creation-signature",
        writeAttempts: priorAttempts,
        retryEligible: false,
        lastRpcError: "RPC_MAX_RETRIES",
      },
    },
  };

  const next = openWriteWindow(state, {
    id: "R3C",
    openedAt: "2026-07-17T12:00:00Z",
    expectedBufferPublicKey: BUFFER,
    previousWindowId: "R3B",
    baselineSignatureCount: 60,
    baselineNewestSignature: "newest-signature",
  });

  assert.equal(next.deployment.buffer.publicKey, BUFFER);
  assert.equal(next.deployment.buffer.creationSignature, "creation-signature");
  assert.deepEqual(next.deployment.buffer.writeAttempts, []);
  assert.equal(next.deployment.buffer.retryEligible, true);
  assert.equal(next.deployment.buffer.lastRpcError, null);
  assert.equal(next.deployment.verdict, "IN_PROGRESS");
  assert.deepEqual(next.deployment.buffer.writeWindows, [
    {
      id: "R3B",
      status: "BLOCKED_WITH_RESUMABLE_BUFFER",
      attempts: priorAttempts,
    },
  ]);
  assert.deepEqual(next.deployment.buffer.activeWindow, {
    id: "R3C",
    openedAt: "2026-07-17T12:00:00Z",
    maxAttempts: 3,
    attemptsUsed: 0,
    status: "OPEN",
    baselineSignatureCount: 60,
    baselineNewestSignature: "newest-signature",
  });
});

test("new window rejects buffer mismatch and an already open window", () => {
  const base = {
    deployment: {
      buffer: {
        publicKey: BUFFER,
        status: "BUFFER_WRITING",
        writeAttempts: [],
      },
    },
  };
  assert.throws(
    () =>
      openWriteWindow(base, {
        id: "R3C",
        openedAt: "time",
        expectedBufferPublicKey: PublicKey.default.toBase58(),
      }),
    /buffer identity mismatch/,
  );
  const active = structuredClone(base);
  active.deployment.buffer.activeWindow = { id: "other", status: "OPEN" };
  assert.throws(
    () =>
      openWriteWindow(active, {
        id: "R3C",
        openedAt: "time",
        expectedBufferPublicKey: BUFFER,
      }),
    /write window is already open/,
  );
});

test("one-attempt window exhausts after its only recorded attempt", () => {
  const state = {
    deployment: {
      verdict: "BLOCKED_WITH_RESUMABLE_BUFFER",
      buffer: {
        publicKey: BUFFER,
        status: "BUFFER_WRITING",
        writeAttempts: [{ number: 1 }, { number: 2 }, { number: 3 }],
        retryEligible: false,
      },
    },
  };
  let next = openWriteWindow(state, {
    id: "R3E",
    openedAt: "2026-07-17T12:00:00Z",
    expectedBufferPublicKey: BUFFER,
    previousWindowId: "R3D",
    maxAttempts: 1,
  });

  assert.equal(next.deployment.buffer.activeWindow.maxAttempts, 1);
  next = recordWriteAttempt(next, {
    outcome: "RPC_MAX_RETRIES",
    observed: { status: "BUFFER_WRITING", matchingBytes: 1, totalBytes: 4 },
  });
  assert.equal(next.deployment.buffer.activeWindow.attemptsUsed, 1);
  assert.equal(next.deployment.buffer.activeWindow.status, "EXHAUSTED");
  assert.equal(next.deployment.buffer.retryEligible, false);
  assert.throws(
    () => recordWriteAttempt(next, { outcome: "RPC_MAX_RETRIES" }),
    /not open/,
  );
});

test("write window rejects attempt limits outside one through three", () => {
  const state = {
    deployment: {
      buffer: {
        publicKey: BUFFER,
        status: "BUFFER_WRITING",
        writeAttempts: [],
      },
    },
  };
  for (const maxAttempts of [0, 4]) {
    assert.throws(
      () =>
        openWriteWindow(state, {
          id: "R3E",
          openedAt: "time",
          expectedBufferPublicKey: BUFFER,
          maxAttempts,
        }),
      /attempt limit/,
    );
  }
});

test("attempt recording updates and closes the active window", () => {
  const base = {
    deployment: {
      buffer: {
        status: "BUFFER_WRITING",
        writeAttempts: [],
        lastConfirmedProgress: null,
        lastRpcError: null,
        retryEligible: true,
        activeWindow: {
          id: "R3C",
          status: "OPEN",
          maxAttempts: 3,
          attemptsUsed: 0,
        },
      },
    },
  };
  let next = recordWriteAttempt(base, {
    outcome: "RPC_MAX_RETRIES",
    observed: { status: "BUFFER_WRITING", matchingBytes: 1, totalBytes: 4 },
  });
  assert.equal(next.deployment.buffer.activeWindow.attemptsUsed, 1);
  assert.equal(next.deployment.buffer.activeWindow.status, "OPEN");
  next = recordWriteAttempt(next, {
    outcome: "RPC_MAX_RETRIES",
    observed: { status: "BUFFER_WRITING", matchingBytes: 2, totalBytes: 4 },
  });
  next = recordWriteAttempt(next, {
    outcome: "RPC_MAX_RETRIES",
    observed: { status: "BUFFER_WRITING", matchingBytes: 3, totalBytes: 4 },
  });
  assert.equal(next.deployment.buffer.activeWindow.attemptsUsed, 3);
  assert.equal(next.deployment.buffer.activeWindow.status, "EXHAUSTED");
  assert.equal(next.deployment.buffer.retryEligible, false);

  const complete = recordWriteAttempt(base, {
    outcome: "SUCCESS",
    observed: { status: "BUFFER_COMPLETE", matchingBytes: 4, totalBytes: 4 },
  });
  assert.equal(complete.deployment.buffer.activeWindow.status, "COMPLETE");
});

test("summarizes signature history without inventing an aggregate signature", () => {
  const summary = summarizeSignatureHistory(
    [
      {
        signature: "newest-signature",
        slot: 12,
        err: null,
        memo: "must not be retained",
        blockTime: 123,
      },
      { signature: "failed-signature", slot: 11, err: { Custom: 1 } },
      { signature: "older-signature", slot: 10, err: null },
    ],
    { baselineCount: 1 },
  );

  assert.deepEqual(summary, {
    total: 3,
    successful: 2,
    failed: 1,
    newSinceWindow: 2,
    newest: {
      signature: "newest-signature",
      slot: 12,
      err: null,
    },
  });
  assert.equal(Object.hasOwn(summary, "signature"), false);
  assert.equal(JSON.stringify(summary).includes("must not be retained"), false);
});

test("attempt capture stores only the sanitized signature-history summary", () => {
  const state = {
    deployment: {
      buffer: {
        status: "BUFFER_WRITING",
        writeAttempts: [],
        lastConfirmedProgress: null,
        lastRpcError: null,
        retryEligible: true,
      },
    },
  };
  const signatureHistoryAfter = summarizeSignatureHistory([
    { signature: "confirmed-signature", slot: 20, err: null },
  ]);

  const next = recordWriteAttempt(state, {
    outcome: "RPC_MAX_RETRIES",
    observed: { status: "BUFFER_WRITING", matchingBytes: 1, totalBytes: 4 },
    signatureHistoryAfter: {
      ...signatureHistoryAfter,
      rawOutput: "must not be retained",
    },
    rawOutput: "must not be retained",
  });

  assert.deepEqual(
    next.deployment.buffer.writeAttempts[0].signatureHistoryAfter,
    signatureHistoryAfter,
  );
  assert.equal(next.deployment.buffer.writeAttempts[0].signature, null);
  assert.equal(JSON.stringify(next).includes("must not be retained"), false);
});
