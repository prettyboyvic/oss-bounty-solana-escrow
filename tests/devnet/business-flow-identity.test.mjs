import assert from "node:assert/strict";
import test from "node:test";

import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
  BUSINESS_FLOW_EXECUTION_ID_PATTERN,
  assertBusinessFlowExecutionId,
  deriveBusinessFlowMint,
} from "../../scripts/devnet/business-flow-identity.mjs";

const FIXTURE = Object.freeze({
  executionId: "exec-1",
  genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  programId: "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z",
  sponsorBase: "CY5KKnfh1TdSCmm3PuwCrCL5aGLEaqm8ZHiK8Q6AqDHq",
});

test("manifest-v2 business-flow execution IDs use the narrow scoped contract", () => {
  assert.equal(BUSINESS_FLOW_EXECUTION_ID_PATTERN.source, "^[a-z0-9][a-z0-9-]{0,63}$");
  for (const value of ["exec-1", "matrix-1", "u1", "u2", "a", "a".repeat(64)]) {
    assert.equal(assertBusinessFlowExecutionId(value), value);
  }
  for (const value of [
    "",
    "Exec-1",
    "a_b",
    "a.b",
    "../escape",
    "nested/path",
    "nested\\path",
    "line\nbreak",
    "é",
    "a".repeat(65),
    null,
  ]) {
    assert.throws(
      () => assertBusinessFlowExecutionId(value),
      /Phase-4B manifest-v2 business-flow execution ID/,
    );
  }
});

test("deterministic mint derivation binds the public canonical preimage", async () => {
  const first = await deriveBusinessFlowMint(FIXTURE);
  const second = await deriveBusinessFlowMint({ ...FIXTURE });

  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first), [
    "algorithm",
    "domain",
    "encoding",
    "executionId",
    "genesisHash",
    "programId",
    "sponsorBase",
    "tokenProgram",
    "seed",
    "mint",
  ]);
  assert.equal(first.algorithm, "SOLANA_CREATE_WITH_SEED_SHA256_V1");
  assert.equal(first.domain, "R4_BUSINESS_FLOW_MINT_V2");
  assert.equal(first.encoding, "UTF-8");
  assert.match(first.seed, /^bfm2-[0-9a-f]{27}$/);
  assert.equal(Buffer.byteLength(first.seed, "utf8"), 32);
  assert.equal(first.tokenProgram, TOKEN_PROGRAM_ID.toBase58());
  assert.equal(
    first.mint,
    (
      await PublicKey.createWithSeed(
        new PublicKey(FIXTURE.sponsorBase),
        first.seed,
        TOKEN_PROGRAM_ID,
      )
    ).toBase58(),
  );

  const mutations = [
    { executionId: "exec-2" },
    { genesisHash: `${FIXTURE.genesisHash}-other` },
    { programId: SystemProgram.programId.toBase58() },
    { sponsorBase: "DG2kRnmBhZVAusBUfG7eGqUHNXo2rQJ3Z1PCLrUURceT" },
  ];
  for (const mutation of mutations) {
    const changed = await deriveBusinessFlowMint({ ...FIXTURE, ...mutation });
    assert.notEqual(changed.seed, first.seed);
    assert.notEqual(changed.mint, first.mint);
  }
});

test("mint derivation rejects noncanonical execution IDs instead of normalizing", async () => {
  await assert.rejects(
    deriveBusinessFlowMint({ ...FIXTURE, executionId: "Exec-1" }),
    /Phase-4B manifest-v2 business-flow execution ID/,
  );
});
