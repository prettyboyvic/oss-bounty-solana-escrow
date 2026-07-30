import assert from "node:assert/strict";
import test from "node:test";

import { Keypair, Message, PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { DEVNET_GENESIS_HASH } from "../../scripts/devnet/safety.mjs";
import { deriveBusinessFlowMint } from "../../scripts/devnet/business-flow-identity.mjs";
import { BUSINESS_FLOW_EXECUTION_SPEC } from "../../scripts/devnet/business-flow-spec.mjs";
import {
  buildStepInstructions,
  createBusinessFlowExecutionRegistry,
  hashNormalizedMessageTemplate,
  normalizedMessageTemplate,
  prepareExactLegacyTransaction,
  reconstructExactLegacyMessage,
  verifyPreparedSignature,
} from "../../scripts/devnet/business-flow-transaction-factory.mjs";

function signer(byte) {
  return Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => byte));
}

function address(byte) {
  return signer(byte).publicKey;
}

async function fixture() {
  const signers = {
    sponsor: signer(1),
    maintainer: signer(2),
    contributor: signer(3),
    mintAuthority: signer(4),
  };
  const programId = address(5);
  const derivation = await deriveBusinessFlowMint({
    executionId: "matrix-1",
    genesisHash: DEVNET_GENESIS_HASH,
    programId,
    sponsorBase: signers.sponsor.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  return {
    signers,
    context: {
      executionId: "matrix-1",
      genesisHash: DEVNET_GENESIS_HASH,
      programId,
      sponsor: signers.sponsor.publicKey,
      maintainer: signers.maintainer.publicKey,
      contributor: signers.contributor.publicKey,
      mintAuthority: signers.mintAuthority.publicKey,
      mint: new PublicKey(derivation.mint),
      mintSeed: derivation.seed,
      mintLamports: 1_461_600,
      decimals: 6,
      setupMintAmount: 3_000_000n,
      amount: 1_000_000n,
      sponsorToken: address(6),
      contributorToken: address(7),
      releaseExpiry: 1_800_000_100n,
      refundExpiry: 1_800_000_200n,
      expiryPolicyIds: {
        release: "release-expiry-policy-v1",
        refund: "refund-expiry-policy-v1",
        cancel: "cancel-expiry-policy-v1",
      },
      instances: {
        release: { escrow: address(8), vault: address(9), externalRefHash: Buffer.alloc(32, 11) },
        refund: { escrow: address(10), vault: address(11), externalRefHash: Buffer.alloc(32, 12) },
        cancel: { escrow: address(12), vault: address(13), externalRefHash: Buffer.alloc(32, 13) },
      },
      recentBlockhash: address(14).toBase58(),
      lastValidBlockHeight: 987_654,
    },
  };
}

const noncanonicalArrayMutations = [
  ["enumerable named property", (array) => {
    array.extra = "x";
  }],
  ["non-enumerable named property", (array) => {
    Object.defineProperty(array, "hidden", { value: "x" });
  }],
  ["symbol property", (array) => {
    array[Symbol("extra")] = "x";
  }],
  ["custom prototype", (array) => {
    Object.setPrototypeOf(array, Object.create(Array.prototype));
  }],
  ["accessor numeric index", (array) => {
    const value = array[0];
    Object.defineProperty(array, "0", {
      configurable: true,
      enumerable: true,
      get: () => value,
    });
  }],
  ["sparse numeric index", (array) => {
    delete array[0];
  }],
  ["non-enumerable numeric index balanced by a named property", (array) => {
    const value = array[0];
    Object.defineProperty(array, "0", {
      configurable: true,
      enumerable: false,
      value,
      writable: true,
    });
    array.extra = "x";
  }],
];

test("factory rejects every noncanonical builder output before schema validation", async () => {
  const { context } = await fixture();
  const canonical = createBusinessFlowExecutionRegistry();

  for (const [label, mutate] of noncanonicalArrayMutations) {
    const registry = createBusinessFlowExecutionRegistry({
      builderOverrides: {
        "cancel-escrow-v1": async (ctx) => {
          const instructions = await buildStepInstructions(
            "cancel:cancel",
            ctx,
            canonical,
          );
          mutate(instructions);
          return instructions;
        },
      },
    });
    await assert.rejects(
      buildStepInstructions("cancel:cancel", context, registry),
      /canonical instruction array/,
      label,
    );
  }
});

test("factory rejects every noncanonical instruction keys array before normalization", async () => {
  const { context } = await fixture();
  const canonical = createBusinessFlowExecutionRegistry();

  for (const [label, mutate] of noncanonicalArrayMutations) {
    const registry = createBusinessFlowExecutionRegistry({
      builderOverrides: {
        "cancel-escrow-v1": async (ctx) => {
          const [instruction] = await buildStepInstructions(
            "cancel:cancel",
            ctx,
            canonical,
          );
          mutate(instruction.keys);
          return [instruction];
        },
      },
    });
    await assert.rejects(
      normalizedMessageTemplate("cancel:cancel", context, registry),
      /canonical instruction keys/,
      label,
    );
  }
});

test("factory proves every supported legacy message shape and public signature", async () => {
  const { context, signers } = await fixture();
  const registry = createBusinessFlowExecutionRegistry();
  const events = BUSINESS_FLOW_EXECUTION_SPEC.events.filter((entry) => entry.kind !== "WAIT");
  assert.equal(events.length, 15);

  for (const event of events) {
    const instructions = await buildStepInstructions(event.id, context, registry);
    assert.equal(instructions.length, event.instructionCount, event.id);

    const template = await normalizedMessageTemplate(event.id, context, registry);
    const templateJson = JSON.stringify(template);
    assert.doesNotMatch(templateJson, /recentBlockhash|lastValidBlockHeight|signature/i);
    if (event.instructionBuilderId.includes("initialize-")) {
      assert.doesNotMatch(templateJson, /1800000(100|200)/);
    }

    const prepared = await prepareExactLegacyTransaction(event.id, context, signers, registry);
    assert.equal((prepared.messageBytes[0] & 0x80), 0, event.id);
    assert.doesNotThrow(() => Message.from(prepared.messageBytes));
    assert.deepEqual(
      Transaction.from(prepared.wireBytes).serializeMessage(),
      prepared.messageBytes,
      event.id,
    );
    assert.deepEqual(
      await reconstructExactLegacyMessage(event.id, context, registry),
      prepared.messageBytes,
      event.id,
    );
    assert.equal(prepared.feePayer, signers[event.feePayerRole].publicKey.toBase58());
    assert.deepEqual(
      prepared.signers.map((entry) => entry.publicKey),
      [event.feePayerRole, ...event.requiredNonPayerSignerRoles]
        .filter((role, index, roles) => roles.indexOf(role) === index)
        .map((role) => signers[role].publicKey.toBase58()),
      event.id,
    );
    for (const signature of prepared.signers) {
      assert.equal(verifyPreparedSignature(prepared.messageBytes, signature), true, event.id);
    }
    assert.equal(prepared.instructions.length, event.instructionCount);
  }
});

test("exact proof changes on blockhash, expiry, account, instruction, signer, and order", async () => {
  const { context, signers } = await fixture();
  const registry = createBusinessFlowExecutionRegistry();
  const original = await prepareExactLegacyTransaction("release:initialize", context, signers, registry);

  const variants = [
    { ...context, recentBlockhash: address(15).toBase58() },
    { ...context, releaseExpiry: context.releaseExpiry + 1n },
    { ...context, contributor: address(16) },
    { ...context, amount: context.amount + 1n },
  ];
  for (const changed of variants) {
    const rebuilt = await reconstructExactLegacyMessage("release:initialize", changed, registry);
    assert.notDeepEqual(rebuilt, original.messageBytes);
  }

  const alteredMessage = Buffer.from(original.messageBytes);
  alteredMessage[alteredMessage.length - 1] ^= 1;
  assert.equal(verifyPreparedSignature(alteredMessage, original.signers[0]), false);

  const wrongSigners = { ...signers, sponsor: signer(17) };
  await assert.rejects(
    prepareExactLegacyTransaction("release:initialize", context, wrongSigners, registry),
    /does not match context/,
  );

  const reversedRegistry = createBusinessFlowExecutionRegistry({
    builderOverrides: {
      "initialize-release-escrow-v1": async (ctx) => {
        const [instruction] = await buildStepInstructions(
          "release:initialize",
          ctx,
          registry,
        );
        return [
          {
            ...instruction,
            keys: instruction.keys.toReversed(),
          },
        ];
      },
    },
  });
  await assert.rejects(
    reconstructExactLegacyMessage(
      "release:initialize",
      context,
      reversedRegistry,
    ),
    /instruction schema/,
  );
});

test("factory rejects waits, unknown steps, and incomplete registries", async () => {
  const { context, signers } = await fixture();
  const registry = createBusinessFlowExecutionRegistry();
  await assert.rejects(
    prepareExactLegacyTransaction("refund:wait_expiry", context, signers, registry),
    /does not produce a transaction/,
  );
  await assert.rejects(
    prepareExactLegacyTransaction("future:versioned", context, signers, registry),
    /unsupported business-flow step/,
  );
  const incomplete = { ...registry, builders: registry.builders.slice(1) };
  await assert.rejects(
    buildStepInstructions("setup:create_mint", context, incomplete),
    /missing required ID/,
  );
});

test("normalized initialize template abstracts only typed expiry bytes", async () => {
  const { context } = await fixture();
  const registry = createBusinessFlowExecutionRegistry();
  const original = await normalizedMessageTemplate(
    "release:initialize",
    context,
    registry,
  );
  const changed = async (mutation) =>
    normalizedMessageTemplate(
      "release:initialize",
      mutation,
      registry,
    );

  assert.notDeepEqual(
    await changed({ ...context, amount: context.amount + 1n }),
    original,
  );
  assert.notDeepEqual(
    await changed({
      ...context,
      instances: {
        ...context.instances,
        release: {
          ...context.instances.release,
          externalRefHash: Buffer.alloc(32, 99),
        },
      },
    }),
    original,
  );
  assert.notDeepEqual(
    await changed({ ...context, maintainer: address(18) }),
    original,
  );
  assert.deepEqual(
    await changed({ ...context, releaseExpiry: context.releaseExpiry + 1n }),
    original,
  );
  assert.notDeepEqual(
    await changed({
      ...context,
      expiryPolicyIds: {
        ...context.expiryPolicyIds,
        release: "release-expiry-policy-v2",
      },
    }),
    original,
  );

  assert.equal(original.executionSpecHash.length, 64);
  assert.equal(original.order, 4);
  assert.equal(original.feePayer, context.sponsor.toBase58());
  assert.deepEqual(original.requiredSignerPublicKeys, [
    context.sponsor.toBase58(),
  ]);
  assert.deepEqual(original.instructions[0].dynamicFields, [
    {
      name: "expiry",
      type: "i64le",
      offset: 48,
      length: 8,
      policyId: "release-expiry-policy-v1",
    },
  ]);
  assert.equal("recentBlockhash" in original, false);
  assert.equal("lastValidBlockHeight" in original, false);
  assert.equal(JSON.stringify(original).includes("1800000100"), false);

  for (const field of [
    ["feePayer", address(19).toBase58()],
    ["requiredSignerPublicKeys", [address(20).toBase58()]],
    ["order", original.order + 1],
    ["executionSpecHash", "f".repeat(64)],
  ]) {
    const mutated = structuredClone(original);
    mutated[field[0]] = field[1];
    assert.notEqual(
      hashNormalizedMessageTemplate(mutated),
      hashNormalizedMessageTemplate(original),
    );
  }

  const malformedRegistry = createBusinessFlowExecutionRegistry({
    builderOverrides: {
      "initialize-release-escrow-v1": async (ctx) => {
        const [instruction] = await buildStepInstructions(
          "release:initialize",
          ctx,
          registry,
        );
        instruction.data = instruction.data.subarray(0, 119);
        return [instruction];
      },
    },
  });
  await assert.rejects(
    normalizedMessageTemplate(
      "release:initialize",
      context,
      malformedRegistry,
    ),
    /instruction schema/,
  );
});

test("registry distinguishes implemented builders from deferred integrations", async () => {
  const { context } = await fixture();
  const registry = createBusinessFlowExecutionRegistry();
  for (const section of ["verifiers", "simulations", "waits"]) {
    assert.ok(registry[section].every((entry) => entry.status === "deferred"));
  }
  await assert.rejects(
    buildStepInstructions("setup:create_mint", context, {
      ...registry,
      verifiers: registry.verifiers.map((entry) => ({
        ...entry,
        status: "implemented",
        implementation: () => undefined,
      })),
    }),
    /falsely claims implemented integration/,
  );
});

test("schema account roles reject same-flag key substitutions", async () => {
  const { context } = await fixture();
  const registry = createBusinessFlowExecutionRegistry();
  const swapped = createBusinessFlowExecutionRegistry({
    builderOverrides: {
      "release-escrow-v1": async (ctx) => {
        const [instruction] = await buildStepInstructions(
          "release:release",
          ctx,
          registry,
        );
        const keys = [...instruction.keys];
        [keys[1], keys[5]] = [keys[5], keys[1]];
        return [{ ...instruction, keys }];
      },
    },
  });
  await assert.rejects(
    buildStepInstructions("release:release", context, swapped),
    /account role/,
  );

  const arbitrary = createBusinessFlowExecutionRegistry({
    builderOverrides: {
      "release-escrow-v1": async (ctx) => {
        const [instruction] = await buildStepInstructions(
          "release:release",
          ctx,
          registry,
        );
        const keys = [...instruction.keys];
        keys[1] = { ...keys[1], pubkey: Keypair.generate().publicKey };
        return [{ ...instruction, keys }];
      },
    },
  });
  await assert.rejects(
    buildStepInstructions("release:release", context, arbitrary),
    /account role "mint"/,
  );

  const businessSubstitution = createBusinessFlowExecutionRegistry({
    builderOverrides: {
      "release-escrow-v1": async (ctx) => {
        const [instruction] = await buildStepInstructions(
          "release:release",
          ctx,
          registry,
        );
        const keys = [...instruction.keys];
        keys[2] = { ...keys[2], pubkey: keys[3].pubkey };
        return [{ ...instruction, keys }];
      },
    },
  });
  await assert.rejects(
    buildStepInstructions("release:release", context, businessSubstitution),
    /account role "escrow"/,
  );
});
