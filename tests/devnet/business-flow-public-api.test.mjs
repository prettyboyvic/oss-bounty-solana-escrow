import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const executionModule = await import(
  "../../scripts/devnet/business-flow-execution.mjs"
);
const runnerModule = await import(
  "../../scripts/devnet/business-flow-runner.mjs"
);

test("only the canonical full-matrix executor is publicly callable", () => {
  assert.equal(typeof executionModule.executeFullMatrix, "function");
  assert.equal(
    "runAcceptanceMatrix" in executionModule,
    false,
    "the guarded raw sendStep closure must not cross the module boundary",
  );
  assert.equal(
    "runNegativeSimulations" in executionModule,
    false,
    "negative simulations must run only as selected canonical events",
  );
  assert.equal(
    "executeBusinessFlows" in runnerModule,
    false,
    "the FLOW_DEFINITIONS/signAndSend executor must not be public",
  );
});

test("runner documentation advertises only canonical execution", () => {
  const source = readFileSync(
    new URL("../../docs/BUSINESS_FLOW_RUNNER.md", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /\b(?:executeBusinessFlows|runAcceptanceMatrix|runNegativeSimulations)\b/,
  );
  assert.match(source, /\bexecuteFullMatrix\b/);
});
