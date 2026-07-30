import assert from "node:assert/strict";
import test from "node:test";

import {
  Keypair,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  classifyExpectedSimulationError,
  effectiveExpectedErrorNames,
} from "../../scripts/devnet/business-flow-errors.mjs";
import { BUSINESS_FLOW_EXECUTION_SPEC } from "../../scripts/devnet/business-flow-spec.mjs";

const escrowProgram = Keypair.generate().publicKey;
const innerProgram = Keypair.generate().publicKey;
const otherProgram = SystemProgram.programId;
const refundEvent = BUSINESS_FLOW_EXECUTION_SPEC.events.find(
  (candidate) => candidate.id === "refund_before_expiry",
);
const unauthorizedEvent = BUSINESS_FLOW_EXECUTION_SPEC.events.find(
  (candidate) => candidate.id === "unauthorized_release",
);
const instruction = (programId) =>
  new TransactionInstruction({
    programId,
    keys: [],
    data: Buffer.alloc(0),
  });
const runtimeFailure = (programId, code) =>
  `Program ${programId.toBase58()} failed: custom program error: 0x${code.toString(16)}`;
const custom = (index, code, logs = []) => ({
  err: { InstructionError: [index, { Custom: code }] },
  logs,
});
const classify = ({
  result,
  instructions = [instruction(escrowProgram)],
  event = refundEvent,
}) =>
  classifyExpectedSimulationError({
    result,
    instructions,
    expectedProgramId: escrowProgram,
    event,
  });

test("escrow-originated structured failure proves the canonical expected error", () => {
  const result = classify({
    result: custom(0, 6008, [runtimeFailure(escrowProgram, 6008)]),
  });

  assert.equal(result.status, "EXPECTED_ERROR");
  assert.deepEqual(result.decoded, {
    code: 6008,
    name: "EscrowNotExpired",
    instructionIndex: 0,
    structured: true,
  });
});

test("explicit runtime log truncation markers make attributed failures inconclusive", () => {
  for (const marker of ["Log truncated", "log truncated", "LOG TRUNCATED"]) {
    assert.equal(
      classify({
        result: custom(0, 6008, [
          runtimeFailure(escrowProgram, 6008),
          marker,
        ]),
      }).status,
      "INCONCLUSIVE",
      marker,
    );
  }
});

test("logless recognized structured code is inconclusive", () => {
  assert.equal(classify({ result: custom(0, 6008) }).status, "INCONCLUSIVE");
});

test("wrong top-level instruction program is inconclusive", () => {
  assert.equal(
    classify({
      result: custom(0, 6008, [runtimeFailure(escrowProgram, 6008)]),
      instructions: [instruction(otherProgram)],
    }).status,
    "INCONCLUSIVE",
  );
});

test("out-of-range top-level instruction index is inconclusive", () => {
  assert.equal(
    classify({
      result: custom(1, 6008, [runtimeFailure(escrowProgram, 6008)]),
    }).status,
    "INCONCLUSIVE",
  );
});

test("human-readable Anchor logs are diagnostic only", () => {
  const result = classify({
    result: {
      err: { Other: true },
      logs: [
        "Program log: AnchorError caused by account: contributor. Error Code: EscrowNotExpired.",
      ],
    },
  });

  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.decoded.name, "EscrowNotExpired");
  assert.equal(result.decoded.structured, false);
});

test("inner CPI failure followed by propagated escrow failure is inconclusive", () => {
  assert.equal(
    classify({
      result: custom(0, 6008, [
        runtimeFailure(innerProgram, 6008),
        runtimeFailure(escrowProgram, 6008),
      ]),
    }).status,
    "INCONCLUSIVE",
  );
});

test("mismatched structured and runtime-log codes are inconclusive", () => {
  assert.equal(
    classify({
      result: custom(0, 6008, [runtimeFailure(escrowProgram, 6007)]),
    }).status,
    "INCONCLUSIVE",
  );
});

test("truncated runtime failure logs are inconclusive", () => {
  assert.equal(
    classify({
      result: custom(0, 6008, [
        `Program ${escrowProgram.toBase58()} failed: custom program error: 0x`,
      ]),
    }).status,
    "INCONCLUSIVE",
  );
});

test("unknown custom code 6999 is inconclusive even with matching runtime logs", () => {
  assert.equal(
    classify({
      result: custom(0, 6999, [runtimeFailure(escrowProgram, 6999)]),
    }).status,
    "INCONCLUSIVE",
  );
});

test("known escrow-attributed error outside the event expected set is unexpected", () => {
  assert.equal(
    classify({
      result: custom(0, 6007, [runtimeFailure(escrowProgram, 6007)]),
    }).status,
    "UNEXPECTED_ERROR",
  );
});

test("non-custom, undecodable, and absent failures never prove expected", () => {
  for (const result of [
    {
      err: { InstructionError: [0, "InvalidAccountData"] },
      logs: [],
    },
    { err: { Other: true }, logs: [] },
  ]) {
    assert.equal(classify({ result }).status, "INCONCLUSIVE");
  }
  assert.equal(
    classify({ result: { err: null, logs: [] } }).status,
    "UNEXPECTED_SUCCESS",
  );
});

test("Anchor ConstraintHasOne requires the same escrow attribution proof", () => {
  const result = classify({
    result: custom(0, 2001, [runtimeFailure(escrowProgram, 2001)]),
    event: unauthorizedEvent,
  });
  assert.equal(result.status, "EXPECTED_ERROR");
  assert.equal(result.decoded.name, "ConstraintHasOne");

  assert.equal(
    classify({
      result: custom(0, 2001, [runtimeFailure(escrowProgram, 2001)]),
      instructions: [instruction(otherProgram)],
      event: unauthorizedEvent,
    }).status,
    "INCONCLUSIVE",
  );
});

test("effective expected identities remove the inert legacy null token", () => {
  assert.deepEqual(effectiveExpectedErrorNames(unauthorizedEvent), [
    "InvalidContributorTokenOwner",
    "ConstraintHasOne",
  ]);
});
