import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";

import {
  Message,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  associatedTokenAddress,
  buildCancel,
  buildCreateAssociatedTokenAccount,
  buildCreateMintWithSeedInstructions,
  buildFundEscrow,
  buildInitializeEscrow,
  buildMintTo,
  buildRefund,
  buildRelease,
} from "./business-flow-instructions.mjs";
import {
  BUSINESS_FLOW_EXECUTION_SPEC,
  executionSpecHash,
  isCanonicalArray,
  validateExecutionRegistry,
} from "./business-flow-spec.mjs";
import { canonicalJson } from "./durable-json.mjs";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function key(value, label) {
  try {
    return value instanceof PublicKey ? value : new PublicKey(value);
  } catch {
    throw new Error(`${label} must be a valid public key`);
  }
}

function instance(context, flow) {
  const value = context.instances?.[flow];
  if (!value) throw new Error(`missing ${flow} instance context`);
  return value;
}

function initialize(context, flow, expiry) {
  const current = instance(context, flow);
  return [
    buildInitializeEscrow({
      programId: context.programId,
      sponsor: context.sponsor,
      mint: context.mint,
      escrow: current.escrow,
      vault: current.vault,
      externalRefHash: current.externalRefHash,
      amount: context.amount,
      expiry,
      maintainer: context.maintainer,
      contributor: context.contributor,
    }),
  ];
}

function fund(context, flow) {
  const current = instance(context, flow);
  return [
    buildFundEscrow({
      programId: context.programId,
      sponsor: context.sponsor,
      mint: context.mint,
      sponsorToken: context.sponsorToken,
      escrow: current.escrow,
      vault: current.vault,
    }),
  ];
}

function release(context, flow, maintainer = context.maintainer) {
  const current = instance(context, flow);
  return [
    buildRelease({
      programId: context.programId,
      maintainer,
      mint: context.mint,
      escrow: current.escrow,
      vault: current.vault,
      contributorToken: context.contributorToken,
    }),
  ];
}

function refund(context) {
  const current = instance(context, "refund");
  return [
    buildRefund({
      programId: context.programId,
      sponsor: context.sponsor,
      mint: context.mint,
      escrow: current.escrow,
      vault: current.vault,
      sponsorToken: context.sponsorToken,
    }),
  ];
}

const DEFAULT_BUILDERS = Object.freeze({
  "create-mint-with-seed-v1": async (context) => {
    const result = await buildCreateMintWithSeedInstructions({
      executionId: context.executionId,
      genesisHash: context.genesisHash,
      programId: context.programId,
      sponsorBase: context.sponsor,
      tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
      payer: context.sponsor,
      base: context.sponsor,
      owner: TOKEN_PROGRAM_ID.toBase58(),
      mint: context.mint,
      seed: context.mintSeed,
      mintAuthority: context.mintAuthority,
      decimals: context.decimals,
      lamports: context.mintLamports,
    });
    return result.instructions;
  },
  "create-sponsor-ata-v1": (context) => [
    buildCreateAssociatedTokenAccount({
      payer: context.sponsor,
      owner: context.sponsor,
      mint: context.mint,
    }).instruction,
  ],
  "create-contributor-ata-v1": (context) => [
    buildCreateAssociatedTokenAccount({
      payer: context.sponsor,
      owner: context.contributor,
      mint: context.mint,
    }).instruction,
  ],
  "mint-test-tokens-v1": (context) => [
    buildMintTo({
      mint: context.mint,
      destination: context.sponsorToken,
      mintAuthority: context.mintAuthority,
      amount: context.setupMintAmount,
    }),
  ],
  "initialize-release-escrow-v1": (context) =>
    initialize(context, "release", context.releaseExpiry),
  "fund-release-escrow-v1": (context) => fund(context, "release"),
  "simulate-unauthorized-release-v1": (context) =>
    release(context, "release", context.contributor),
  "release-escrow-v1": (context) => release(context, "release"),
  "initialize-refund-escrow-v1": (context) =>
    initialize(context, "refund", context.refundExpiry),
  "fund-refund-escrow-v1": (context) => fund(context, "refund"),
  "simulate-refund-before-expiry-v1": (context) => refund(context),
  "simulate-release-after-expiry-v1": (context) => release(context, "refund"),
  "refund-escrow-v1": (context) => refund(context),
  "initialize-cancel-escrow-v1": (context) =>
    initialize(context, "cancel", context.releaseExpiry),
  "cancel-escrow-v1": (context) => [
    buildCancel({
      programId: context.programId,
      sponsor: context.sponsor,
      escrow: instance(context, "cancel").escrow,
    }),
  ],
});

function deferredEntries(field) {
  return [
    ...new Set(
      BUSINESS_FLOW_EXECUTION_SPEC.events
        .map((entry) => entry[field])
        .filter(Boolean),
    ),
  ].map((id) => Object.freeze({ id, status: "deferred" }));
}

export function createBusinessFlowExecutionRegistry({ builderOverrides = {} } = {}) {
  return {
    builders: Object.entries({ ...DEFAULT_BUILDERS, ...builderOverrides }),
    verifiers: deferredEntries("postStateVerifierId"),
    simulations: deferredEntries("simulationDecoderId"),
    waits: deferredEntries("waitPolicyId"),
  };
}

function supportedEvent(stepId) {
  const event = BUSINESS_FLOW_EXECUTION_SPEC.events.find(
    (candidate) => candidate.id === stepId,
  );
  if (!event) throw new Error(`unsupported business-flow step "${stepId}"`);
  return event;
}

export async function buildStepInstructions(stepId, context, registry) {
  const event = supportedEvent(stepId);
  if (event.kind === "WAIT") {
    throw new Error(`business-flow step "${stepId}" does not produce a transaction`);
  }
  const validated = validateExecutionRegistry(registry);
  const instructions = await validated.builders.get(event.instructionBuilderId)(
    context,
  );
  if (
    !isCanonicalArray(instructions) ||
    instructions.length !== event.instructionCount
  ) {
    throw new Error(
      `builder for "${stepId}" returned a noncanonical instruction array`,
    );
  }
  for (let index = 0; index < instructions.length; index += 1) {
    validateInstructionSchema(
      instructions[index],
      schemaFor(event.instructionSchemaIds[index]),
      context,
      event,
    );
  }
  return instructions;
}

function schemaFor(id) {
  const schema = BUSINESS_FLOW_EXECUTION_SPEC.instructionSchemas.find(
    (candidate) => candidate.id === id,
  );
  if (!schema) throw new Error(`unknown instruction schema "${id}"`);
  return schema;
}

function expectedProgram(schema, context) {
  const programs = {
    systemProgram: SystemProgram.programId,
    classicTokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    escrowProgram: context.programId,
  };
  return key(programs[schema.programRole], schema.programRole);
}

function expectedAccount(role, event, context) {
  if (role === "systemProgram") return SystemProgram.programId;
  if (role === "classicTokenProgram") return TOKEN_PROGRAM_ID;
  if (role === "feePayerBase") return key(context.sponsor, "sponsor");
  if (role === "feePayer") return key(context[event.feePayerRole], event.feePayerRole);
  if (role === "escrow" || role === "vault") {
    return key(instance(context, event.flow)[role], role);
  }
  if (role === "ataOwner") {
    return key(
      context[event.id === "setup:sponsor_ata" ? "sponsor" : "contributor"],
      "ataOwner",
    );
  }
  if (role === "ata") {
    return associatedTokenAddress(context.mint, expectedAccount("ataOwner", event, context));
  }
  if (role === "maintainer" && event.id === "unauthorized_release") {
    return key(context.contributor, "contributor");
  }
  if (context[role] !== undefined) return key(context[role], role);
  throw new Error(`instruction schema has unresolved account role "${role}"`);
}

function validateInstructionSchema(instruction, schema, context, event) {
  if (!instruction || !isCanonicalArray(instruction.keys)) {
    throw new Error(
      `instruction schema "${schema.id}" has noncanonical instruction keys`,
    );
  }
  const data = Buffer.from(instruction.data);
  const discriminator = data
    .subarray(0, schema.discriminatorLength)
    .toString("hex");
  const valid =
    instruction.programId.equals(expectedProgram(schema, context)) &&
    data.length === schema.dataLength &&
    discriminator === schema.discriminator &&
    instruction.keys.length === schema.accounts.length;
  if (!valid) {
    throw new Error(`instruction schema "${schema.id}" does not match built instruction`);
  }
  for (let index = 0; index < instruction.keys.length; index += 1) {
    const account = instruction.keys[index];
    if (
      account.isSigner !== schema.accounts[index].isSigner ||
      account.isWritable !== schema.accounts[index].isWritable
    ) {
      throw new Error(
        `instruction schema "${schema.id}" does not match built instruction`,
      );
    }
    const role = schema.accounts[index].role;
    if (!account.pubkey.equals(expectedAccount(role, event, context))) {
      throw new Error(
        `instruction schema "${schema.id}" account role "${role}" does not match built instruction`,
      );
    }
  }
  for (const field of schema.dynamicFields) {
    if (
      !Number.isInteger(field.offset) ||
      !Number.isInteger(field.length) ||
      field.offset < schema.discriminatorLength ||
      field.length <= 0 ||
      field.offset + field.length > data.length
    ) {
      throw new Error(`instruction schema "${schema.id}" has malformed dynamic field`);
    }
  }
  return data;
}

function instructionIdentity(instruction, schema, context, normalized = false, event = null) {
  const data = validateInstructionSchema(instruction, schema, context, event);
  const dynamicFields = normalized ? schema.dynamicFields.map((field) => {
    const policyId = context.expiryPolicyIds?.[event?.expiryPolicyRole];
    if (typeof policyId !== "string" || policyId.length === 0) {
      throw new Error(`instruction schema "${schema.id}" requires expiry policy identity`);
    }
    return {
      name: field.name,
      type: field.type,
      offset: field.offset,
      length: field.length,
      policyId,
    };
  }) : [];
  const fixedSegments = [];
  let offset = 0;
  for (const field of schema.dynamicFields) {
    if (field.offset > offset) {
      fixedSegments.push({
        offset,
        length: field.offset - offset,
        hash: hash(data.subarray(offset, field.offset)),
      });
    }
    offset = field.offset + field.length;
  }
  if (offset < data.length) {
    fixedSegments.push({
      offset,
      length: data.length - offset,
      hash: hash(data.subarray(offset)),
    });
  }
  return {
    schemaId: schema.id,
    programId: instruction.programId.toBase58(),
    accounts: instruction.keys.map(({ pubkey, isSigner, isWritable }) => ({
      publicKey: pubkey.toBase58(),
      isSigner,
      isWritable,
    })),
    discriminator: schema.discriminator,
    dataLength: data.length,
    ...(normalized && dynamicFields.length > 0
      ? { fixedSegments, dynamicFields }
      : { dataHash: hash(data) }),
  };
}

export function hashNormalizedMessageTemplate(template) {
  return hash(
    Buffer.from(
      `R4_BUSINESS_FLOW_NORMALIZED_MESSAGE_TEMPLATE_V1\0${canonicalJson(template)}`,
      "utf8",
    ),
  );
}

export async function normalizedMessageTemplate(stepId, context, registry) {
  const event = supportedEvent(stepId);
  const instructions = await buildStepInstructions(stepId, context, registry);
  const signerRoles = [
    event.feePayerRole,
    ...event.requiredNonPayerSignerRoles,
  ].filter((role, index, roles) => roles.indexOf(role) === index);
  return Object.freeze({
    schema: "R4_BUSINESS_FLOW_NORMALIZED_MESSAGE_TEMPLATE_V1",
    executionSpecHash: executionSpecHash(),
    stepId,
    order: event.order,
    kind: event.kind,
    feePayer: key(context[event.feePayerRole], event.feePayerRole).toBase58(),
    requiredSignerPublicKeys: signerRoles.map((role) =>
      key(context[role], role).toBase58(),
    ),
    expiryPolicyId:
      event.expiryPolicyRole === null
        ? null
        : context.expiryPolicyIds?.[event.expiryPolicyRole],
    instructions: instructions.map((instruction, index) =>
      instructionIdentity(
        instruction,
        schemaFor(event.instructionSchemaIds[index]),
        context,
        true,
        event,
      ),
    ),
  });
}

function signerForRole(role, context, signers) {
  const signer = signers?.[role];
  if (!signer?.publicKey || !signer.secretKey) {
    throw new Error(`missing in-memory signer for role "${role}"`);
  }
  const expected = key(context[role], role);
  if (!signer.publicKey.equals(expected)) {
    throw new Error(`signer "${role}" does not match context`);
  }
  return signer;
}

function exactTransaction(stepId, context, instructions) {
  if (
    typeof context.recentBlockhash !== "string" ||
    !Number.isSafeInteger(context.lastValidBlockHeight)
  ) {
    throw new Error("exact legacy transaction requires blockhash and last-valid height");
  }
  const event = supportedEvent(stepId);
  const transaction = new Transaction({
    feePayer: key(context[event.feePayerRole], event.feePayerRole),
    blockhash: context.recentBlockhash,
    lastValidBlockHeight: context.lastValidBlockHeight,
  });
  transaction.add(...instructions);
  return { event, transaction };
}

export async function reconstructExactLegacyMessage(stepId, context, registry) {
  const instructions = await buildStepInstructions(stepId, context, registry);
  const { transaction } = exactTransaction(stepId, context, instructions);
  const bytes = transaction.serializeMessage();
  Message.from(bytes);
  return bytes;
}

export async function prepareExactLegacyTransaction(
  stepId,
  context,
  signers,
  registry = createBusinessFlowExecutionRegistry(),
) {
  const instructions = await buildStepInstructions(stepId, context, registry);
  const { event, transaction } = exactTransaction(stepId, context, instructions);
  const roles = [event.feePayerRole, ...event.requiredNonPayerSignerRoles].filter(
    (role, index, all) => all.indexOf(role) === index,
  );
  const requiredSigners = roles.map((role) => signerForRole(role, context, signers));
  transaction.sign(...requiredSigners);
  const messageBytes = transaction.serializeMessage();
  Message.from(messageBytes);
  const wireBytes = transaction.serialize();
  const publicSigners = roles.map((role, index) => {
    const publicKey = requiredSigners[index].publicKey;
    const signature = transaction.signatures.find(({ publicKey: candidate }) =>
      candidate.equals(publicKey),
    )?.signature;
    if (!signature) throw new Error(`transaction lacks signature for role "${role}"`);
    return Object.freeze({
      role,
      publicKey: publicKey.toBase58(),
      signature: Buffer.from(signature).toString("base64"),
    });
  });
  return Object.freeze({
    schema: "R4_BUSINESS_FLOW_PREPARED_LEGACY_TRANSACTION_V1",
    stepId,
    feePayer: transaction.feePayer.toBase58(),
    recentBlockhash: context.recentBlockhash,
    lastValidBlockHeight: context.lastValidBlockHeight,
    messageHash: hash(messageBytes),
    instructions: instructions.map((instruction, index) =>
      instructionIdentity(
        instruction,
        schemaFor(event.instructionSchemaIds[index]),
        context,
        false,
        event,
      ),
    ),
    signers: Object.freeze(publicSigners),
    transaction,
    messageBytes,
    wireBytes,
  });
}

export function verifyPreparedSignature(messageBytes, publicSignature) {
  try {
    const publicKeyBytes = key(
      publicSignature.publicKey,
      "signature public key",
    ).toBuffer();
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyBytes]),
      format: "der",
      type: "spki",
    });
    return verifySignature(
      null,
      Buffer.from(messageBytes),
      publicKey,
      Buffer.from(publicSignature.signature, "base64"),
    );
  } catch {
    return false;
  }
}
