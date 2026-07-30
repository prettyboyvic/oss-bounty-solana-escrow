import { createHash } from "node:crypto";

import { canonicalJson } from "./durable-json.mjs";
import {
  RECOGNIZED_PROGRAM_ERROR_NAMES,
  effectiveExpectedErrorNames,
} from "./business-flow-errors.mjs";

export const BUSINESS_FLOW_EXECUTION_SPEC_DOMAIN =
  "R4_BUSINESS_FLOW_EXECUTION_SPEC_V1";

const LEGACY_NULL_EXPECTED_ERROR = Object.freeze({
  schema: BUSINESS_FLOW_EXECUTION_SPEC_DOMAIN,
  eventId: "unauthorized_release",
  values: Object.freeze([
    "InvalidContributorTokenOwner",
    "ConstraintHasOne",
    null,
  ]),
});

const PROGRAM_ROLES = new Set([
  "associatedTokenProgram",
  "classicTokenProgram",
  "escrowProgram",
  "systemProgram",
]);

const ACCOUNT_ROLES = new Set([
  "ata",
  "ataOwner",
  "classicTokenProgram",
  "contributorToken",
  "escrow",
  "feePayer",
  "feePayerBase",
  "maintainer",
  "mint",
  "mintAuthority",
  "sponsor",
  "sponsorToken",
  "systemProgram",
  "vault",
]);

const ENABLED_FLOWS = Object.freeze(["release", "refund", "cancel"]);
const EVENT_KINDS = new Set(["SEND", "SIMULATE", "WAIT"]);
const SIGNER_ROLES = new Set([
  "contributor",
  "maintainer",
  "mintAuthority",
  "sponsor",
]);
const CREATED_ACCOUNT_CLASSES = Object.freeze([
  "mint",
  "ata",
  "escrow",
  "vault",
]);

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

function account(role, isSigner, isWritable) {
  return { role, isSigner, isWritable };
}

const instructionSchemas = [
  {
    id: "system-create-account-with-seed-v1",
    programRole: "systemProgram",
    discriminator: "03000000",
    discriminatorLength: 4,
    dataLength: 124,
    accounts: [
      account("feePayerBase", true, true),
      account("mint", false, true),
    ],
    dynamicFields: [],
  },
  {
    id: "token-initialize-mint2-v1",
    programRole: "classicTokenProgram",
    discriminator: "14",
    discriminatorLength: 1,
    dataLength: 35,
    accounts: [account("mint", false, true)],
    dynamicFields: [],
  },
  {
    id: "associated-token-create-idempotence-not-required-v1",
    programRole: "associatedTokenProgram",
    discriminator: "",
    discriminatorLength: 0,
    dataLength: 0,
    accounts: [
      account("feePayer", true, true),
      account("ata", false, true),
      account("ataOwner", false, false),
      account("mint", false, false),
      account("systemProgram", false, false),
      account("classicTokenProgram", false, false),
    ],
    dynamicFields: [],
  },
  {
    id: "token-mint-to-v1",
    programRole: "classicTokenProgram",
    discriminator: "07",
    discriminatorLength: 1,
    dataLength: 9,
    accounts: [
      account("mint", false, true),
      account("sponsorToken", false, true),
      account("mintAuthority", true, false),
    ],
    dynamicFields: [],
  },
  {
    id: "escrow-initialize-v1",
    programRole: "escrowProgram",
    discriminator: "f3a04d990b5c30d1",
    discriminatorLength: 8,
    dataLength: 120,
    accounts: [
      account("sponsor", true, true),
      account("mint", false, false),
      account("escrow", false, true),
      account("vault", false, true),
      account("classicTokenProgram", false, false),
      account("systemProgram", false, false),
    ],
    dynamicFields: [
      {
        name: "expiry",
        type: "i64le",
        offset: 48,
        length: 8,
        policyRole: "expiryPolicyId",
      },
    ],
  },
  {
    id: "escrow-fund-v1",
    programRole: "escrowProgram",
    discriminator: "9b12da8db6d545c9",
    discriminatorLength: 8,
    dataLength: 8,
    accounts: [
      account("sponsor", true, true),
      account("mint", false, false),
      account("sponsorToken", false, true),
      account("escrow", false, true),
      account("vault", false, true),
      account("classicTokenProgram", false, false),
    ],
    dynamicFields: [],
  },
  {
    id: "escrow-release-v1",
    programRole: "escrowProgram",
    discriminator: "fdf90fce1c7fc1f1",
    discriminatorLength: 8,
    dataLength: 8,
    accounts: [
      account("maintainer", true, false),
      account("mint", false, false),
      account("escrow", false, true),
      account("vault", false, true),
      account("contributorToken", false, true),
      account("classicTokenProgram", false, false),
    ],
    dynamicFields: [],
  },
  {
    id: "escrow-refund-v1",
    programRole: "escrowProgram",
    discriminator: "0260b7fb3fd02e2e",
    discriminatorLength: 8,
    dataLength: 8,
    accounts: [
      account("sponsor", true, false),
      account("mint", false, false),
      account("escrow", false, true),
      account("vault", false, true),
      account("sponsorToken", false, true),
      account("classicTokenProgram", false, false),
    ],
    dynamicFields: [],
  },
  {
    id: "escrow-cancel-v1",
    programRole: "escrowProgram",
    discriminator: "e8dbdf29dbecdcbe",
    discriminatorLength: 8,
    dataLength: 8,
    accounts: [
      account("sponsor", true, false),
      account("escrow", false, true),
    ],
    dynamicFields: [],
  },
];

function event({
  id,
  flow,
  kind,
  instructionBuilderId = null,
  postStateVerifierId = null,
  simulationDecoderId = null,
  waitPolicyId = null,
  feePayerRole = null,
  requiredNonPayerSignerRoles = [],
  instructionCount = 0,
  creates = [],
  rentPayerRole = null,
  expectedErrors = [],
  instructionSchemaIds = [],
  expiryPolicyRole = null,
}) {
  return {
    id,
    flow,
    kind,
    instructionBuilderId,
    postStateVerifierId,
    simulationDecoderId,
    waitPolicyId,
    feePayerRole,
    requiredNonPayerSignerRoles,
    instructionCount,
    creates,
    rentPayerRole,
    expectedErrors,
    instructionSchemaIds,
    expiryPolicyRole,
    sendContribution: kind === "SEND" ? 1 : 0,
    simulationContribution: kind === "SIMULATE" ? 1 : 0,
  };
}

const events = [
  event({
    id: "setup:create_mint",
    flow: "setup",
    kind: "SEND",
    instructionBuilderId: "create-mint-with-seed-v1",
    postStateVerifierId: "mint-initialized-v1",
    feePayerRole: "sponsor",
    instructionCount: 2,
    instructionSchemaIds: [
      "system-create-account-with-seed-v1",
      "token-initialize-mint2-v1",
    ],
    creates: ["mint"],
    rentPayerRole: "sponsor",
  }),
  event({
    id: "setup:sponsor_ata",
    flow: "setup",
    kind: "SEND",
    instructionBuilderId: "create-sponsor-ata-v1",
    postStateVerifierId: "sponsor-ata-v1",
    feePayerRole: "sponsor",
    instructionCount: 1,
    instructionSchemaIds: [
      "associated-token-create-idempotence-not-required-v1",
    ],
    creates: ["ata"],
    rentPayerRole: "sponsor",
  }),
  event({
    id: "setup:contributor_ata",
    flow: "setup",
    kind: "SEND",
    instructionBuilderId: "create-contributor-ata-v1",
    postStateVerifierId: "contributor-ata-v1",
    feePayerRole: "sponsor",
    instructionCount: 1,
    instructionSchemaIds: [
      "associated-token-create-idempotence-not-required-v1",
    ],
    creates: ["ata"],
    rentPayerRole: "sponsor",
  }),
  event({
    id: "setup:mint_tokens",
    flow: "setup",
    kind: "SEND",
    instructionBuilderId: "mint-test-tokens-v1",
    postStateVerifierId: "sponsor-token-balance-v1",
    feePayerRole: "sponsor",
    requiredNonPayerSignerRoles: ["mintAuthority"],
    instructionCount: 1,
    instructionSchemaIds: ["token-mint-to-v1"],
  }),
  event({
    id: "release:initialize",
    flow: "release",
    kind: "SEND",
    instructionBuilderId: "initialize-release-escrow-v1",
    postStateVerifierId: "release-initialized-v1",
    feePayerRole: "sponsor",
    instructionCount: 1,
    instructionSchemaIds: ["escrow-initialize-v1"],
    expiryPolicyRole: "release",
    creates: ["escrow", "vault"],
    rentPayerRole: "sponsor",
  }),
  event({
    id: "release:fund",
    flow: "release",
    kind: "SEND",
    instructionBuilderId: "fund-release-escrow-v1",
    postStateVerifierId: "release-funded-v1",
    feePayerRole: "sponsor",
    instructionCount: 1,
    instructionSchemaIds: ["escrow-fund-v1"],
  }),
  event({
    id: "unauthorized_release",
    flow: "release",
    kind: "SIMULATE",
    instructionBuilderId: "simulate-unauthorized-release-v1",
    simulationDecoderId: "anchor-error-v1",
    feePayerRole: "sponsor",
    requiredNonPayerSignerRoles: ["contributor"],
    instructionCount: 1,
    instructionSchemaIds: ["escrow-release-v1"],
    expectedErrors: ["InvalidContributorTokenOwner", "ConstraintHasOne", null],
  }),
  event({
    id: "release:release",
    flow: "release",
    kind: "SEND",
    instructionBuilderId: "release-escrow-v1",
    postStateVerifierId: "release-terminal-v1",
    feePayerRole: "maintainer",
    instructionCount: 1,
    instructionSchemaIds: ["escrow-release-v1"],
  }),
  event({
    id: "refund:initialize",
    flow: "refund",
    kind: "SEND",
    instructionBuilderId: "initialize-refund-escrow-v1",
    postStateVerifierId: "refund-initialized-v1",
    feePayerRole: "sponsor",
    instructionCount: 1,
    instructionSchemaIds: ["escrow-initialize-v1"],
    expiryPolicyRole: "refund",
    creates: ["escrow", "vault"],
    rentPayerRole: "sponsor",
  }),
  event({
    id: "refund:fund",
    flow: "refund",
    kind: "SEND",
    instructionBuilderId: "fund-refund-escrow-v1",
    postStateVerifierId: "refund-funded-v1",
    feePayerRole: "sponsor",
    instructionCount: 1,
    instructionSchemaIds: ["escrow-fund-v1"],
  }),
  event({
    id: "refund_before_expiry",
    flow: "refund",
    kind: "SIMULATE",
    instructionBuilderId: "simulate-refund-before-expiry-v1",
    simulationDecoderId: "anchor-error-v1",
    feePayerRole: "sponsor",
    instructionCount: 1,
    instructionSchemaIds: ["escrow-refund-v1"],
    expectedErrors: ["EscrowNotExpired"],
  }),
  event({
    id: "refund:wait_expiry",
    flow: "refund",
    kind: "WAIT",
    waitPolicyId: "refund-expiry-v1",
    instructionSchemaIds: [],
  }),
  event({
    id: "release_at_or_after_expiry",
    flow: "refund",
    kind: "SIMULATE",
    instructionBuilderId: "simulate-release-after-expiry-v1",
    simulationDecoderId: "anchor-error-v1",
    feePayerRole: "sponsor",
    requiredNonPayerSignerRoles: ["maintainer"],
    instructionCount: 1,
    instructionSchemaIds: ["escrow-release-v1"],
    expectedErrors: ["EscrowExpired"],
  }),
  event({
    id: "refund:refund",
    flow: "refund",
    kind: "SEND",
    instructionBuilderId: "refund-escrow-v1",
    postStateVerifierId: "refund-terminal-v1",
    feePayerRole: "sponsor",
    instructionCount: 1,
    instructionSchemaIds: ["escrow-refund-v1"],
  }),
  event({
    id: "cancel:initialize",
    flow: "cancel",
    kind: "SEND",
    instructionBuilderId: "initialize-cancel-escrow-v1",
    postStateVerifierId: "cancel-initialized-v1",
    feePayerRole: "sponsor",
    instructionCount: 1,
    instructionSchemaIds: ["escrow-initialize-v1"],
    expiryPolicyRole: "cancel",
    creates: ["escrow", "vault"],
    rentPayerRole: "sponsor",
  }),
  event({
    id: "cancel:cancel",
    flow: "cancel",
    kind: "SEND",
    instructionBuilderId: "cancel-escrow-v1",
    postStateVerifierId: "cancel-terminal-v1",
    feePayerRole: "sponsor",
    instructionCount: 1,
    instructionSchemaIds: ["escrow-cancel-v1"],
  }),
].map((entry, order) => ({ ...entry, order }));

export const BUSINESS_FLOW_EXECUTION_SPEC = deepFreeze({
  schema: BUSINESS_FLOW_EXECUTION_SPEC_DOMAIN,
  enabledFlows: ["release", "refund", "cancel"],
  instructionSchemas,
  events,
  ceilings: { sends: 12, simulations: 3 },
  inventory: { mint: 1, ata: 2, escrow: 3, vault: 3 },
});

const SPEC_FIELDS = new Set([
  "schema",
  "enabledFlows",
  "instructionSchemas",
  "events",
  "ceilings",
  "inventory",
]);

const EVENT_FIELDS = new Set([
  "id",
  "flow",
  "kind",
  "instructionBuilderId",
  "postStateVerifierId",
  "simulationDecoderId",
  "waitPolicyId",
  "feePayerRole",
  "requiredNonPayerSignerRoles",
  "instructionCount",
  "creates",
  "rentPayerRole",
  "expectedErrors",
  "instructionSchemaIds",
  "expiryPolicyRole",
  "sendContribution",
  "simulationContribution",
  "order",
]);

function hasExactFields(value, fields) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.size &&
    Object.keys(value).every((field) => fields.has(field))
  );
}

function isStableId(value) {
  return typeof value === "string" && value.length > 0;
}

export function isCanonicalArray(value) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.at(-1) !== "length") {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (keys[index] !== String(index)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) {
      return false;
    }
  }
  return true;
}

function hasUniqueAllowedStrings(values, allowed) {
  return (
    isCanonicalArray(values) &&
    values.every((value) => isStableId(value) && allowed.has(value)) &&
    new Set(values).size === values.length
  );
}

function nullableStableId(value) {
  return value === null || isStableId(value);
}

export function validateExecutionSpec(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error("execution spec must be an object");
  }
  for (const field of Object.keys(spec)) {
    if (!SPEC_FIELDS.has(field)) {
      throw new Error(`execution spec contains unknown top-level field "${field}"`);
    }
  }
  if (Object.keys(spec).length !== SPEC_FIELDS.size) {
    throw new Error("execution spec top-level fields are incomplete");
  }
  if (spec.schema !== BUSINESS_FLOW_EXECUTION_SPEC_DOMAIN) {
    throw new Error("execution spec schema is invalid");
  }
  if (!isCanonicalArray(spec.instructionSchemas)) {
    throw new Error("execution spec instruction schemas must be a canonical array");
  }
  if (!isCanonicalArray(spec.events)) {
    throw new Error("execution spec events must be a canonical array");
  }
  if (
    !isCanonicalArray(spec.enabledFlows) ||
    spec.enabledFlows.length !== ENABLED_FLOWS.length ||
    spec.enabledFlows.some((flow, index) => flow !== ENABLED_FLOWS[index])
  ) {
    throw new Error("execution spec enabled flows must be a canonical array");
  }
  const schemas = new Map();
  for (const schema of spec.instructionSchemas) {
    if (!schema || typeof schema.id !== "string") {
      throw new Error("instruction schema is malformed");
    }
    if (schemas.has(schema.id)) {
      throw new Error(`duplicate instruction schema "${schema.id}"`);
    }
    const schemaFields = new Set([
      "id", "programRole", "discriminator", "discriminatorLength",
      "dataLength", "accounts", "dynamicFields",
    ]);
    if (
      Number.isInteger(schema.discriminatorLength) &&
      Number.isInteger(schema.dataLength) &&
      schema.discriminatorLength > schema.dataLength
    ) {
      throw new Error(
        `instruction schema "${schema.id}" discriminator length exceeds data length`,
      );
    }
    if (
      !isCanonicalArray(schema.accounts) ||
      !isCanonicalArray(schema.dynamicFields)
    ) {
      throw new Error(
        `instruction schema "${schema.id}" accounts and dynamic fields must be a canonical array`,
      );
    }
    if (
      Object.keys(schema).some((field) => !schemaFields.has(field)) ||
      !PROGRAM_ROLES.has(schema.programRole) ||
      typeof schema.discriminator !== "string" ||
      !Number.isInteger(schema.discriminatorLength) ||
      schema.discriminatorLength < 0 ||
      !/^[0-9a-f]*$/.test(schema.discriminator) ||
      schema.discriminator.length !== schema.discriminatorLength * 2 ||
      !Number.isInteger(schema.dataLength) ||
      schema.dataLength < 0
    ) {
      throw new Error(`instruction schema "${schema.id}" is malformed`);
    }
    const accountRoles = new Set();
    for (const descriptor of schema.accounts) {
      if (
        !descriptor ||
        Object.keys(descriptor).some(
          (field) => !["role", "isSigner", "isWritable"].includes(field),
        ) ||
        typeof descriptor.role !== "string" ||
        descriptor.role.length === 0 ||
        !ACCOUNT_ROLES.has(descriptor.role) ||
        typeof descriptor.isSigner !== "boolean" ||
        typeof descriptor.isWritable !== "boolean" ||
        accountRoles.has(descriptor.role)
      ) {
        throw new Error(`instruction schema "${schema.id}" account role is malformed`);
      }
      accountRoles.add(descriptor.role);
    }
    const names = new Set();
    let rangeEnd = 0;
    for (const field of schema.dynamicFields) {
      if (
        !field ||
        Object.keys(field).some(
          (key) => !["name", "type", "offset", "length", "policyRole"].includes(key),
        ) ||
        typeof field.name !== "string" ||
        field.name.length === 0 ||
        names.has(field.name) ||
        field.type !== "i64le" ||
        field.length !== 8 ||
        field.policyRole !== "expiryPolicyId" ||
        !Number.isInteger(field.offset) ||
        !Number.isInteger(field.length) ||
        field.offset < schema.discriminatorLength ||
        field.length <= 0 ||
        field.offset < rangeEnd ||
        field.offset + field.length > schema.dataLength
      ) {
        throw new Error(`instruction schema "${schema.id}" dynamic field is malformed`);
      }
      names.add(field.name);
      rangeEnd = field.offset + field.length;
    }
    schemas.set(schema.id, schema);
  }
  const reached = new Set();
  const eventIds = new Set();
  const reachedFlows = new Set();
  const derivedCeilings = { sends: 0, simulations: 0 };
  const derivedInventory = Object.fromEntries(
    CREATED_ACCOUNT_CLASSES.map((accountClass) => [accountClass, 0]),
  );
  for (const [index, event] of spec.events.entries()) {
    for (const [label, array] of [
      ["required signer roles", event?.requiredNonPayerSignerRoles],
      ["created accounts", event?.creates],
      ["expected errors", event?.expectedErrors],
      ["instruction schema references", event?.instructionSchemaIds],
    ]) {
      if (!isCanonicalArray(array)) {
        throw new Error(
          `execution spec event at order ${index} ${label} must be a canonical array`,
        );
      }
    }
    if (
      !hasExactFields(event, EVENT_FIELDS) ||
      !isStableId(event.id) ||
      eventIds.has(event.id) ||
      event.order !== index ||
      !isStableId(event.flow) ||
      (event.flow !== "setup" && !ENABLED_FLOWS.includes(event.flow)) ||
      !EVENT_KINDS.has(event.kind) ||
      !nullableStableId(event.instructionBuilderId) ||
      !nullableStableId(event.postStateVerifierId) ||
      !nullableStableId(event.simulationDecoderId) ||
      !nullableStableId(event.waitPolicyId) ||
      (event.feePayerRole !== null && !SIGNER_ROLES.has(event.feePayerRole)) ||
      !hasUniqueAllowedStrings(
        event.requiredNonPayerSignerRoles,
        SIGNER_ROLES,
      ) ||
      event.requiredNonPayerSignerRoles.includes(event.feePayerRole) ||
      !Number.isInteger(event.instructionCount) ||
      event.instructionCount < 0 ||
      !hasUniqueAllowedStrings(event.creates, new Set(CREATED_ACCOUNT_CLASSES)) ||
      (event.rentPayerRole !== null && !SIGNER_ROLES.has(event.rentPayerRole)) ||
      event.expectedErrors.some(
        (error) => error !== null && !isStableId(error),
      ) ||
      event.instructionSchemaIds.some((id) => !isStableId(id)) ||
      new Set(event.instructionSchemaIds).size !==
        event.instructionSchemaIds.length ||
      (event.expiryPolicyRole !== null &&
        !ENABLED_FLOWS.includes(event.expiryPolicyRole)) ||
      event.sendContribution !== (event.kind === "SEND" ? 1 : 0) ||
      event.simulationContribution !== (event.kind === "SIMULATE" ? 1 : 0)
    ) {
      throw new Error(`execution spec event at order ${index} is malformed`);
    }
    const createsAccounts = event.creates.length > 0;
    const sends = event.kind === "SEND";
    const simulates = event.kind === "SIMULATE";
    const waits = event.kind === "WAIT";
    const hasNull = event.expectedErrors.includes(null);
    const legacyNullIsExact =
      !hasNull ||
      (spec.schema === LEGACY_NULL_EXPECTED_ERROR.schema &&
        event.id === LEGACY_NULL_EXPECTED_ERROR.eventId &&
        event.expectedErrors.length ===
          LEGACY_NULL_EXPECTED_ERROR.values.length &&
        event.expectedErrors.every(
          (value, expectedIndex) =>
            value === LEGACY_NULL_EXPECTED_ERROR.values[expectedIndex],
        ));
    const recognizedExpectedErrors = effectiveExpectedErrorNames(event);
    if (
      recognizedExpectedErrors.some(
        (name) => !RECOGNIZED_PROGRAM_ERROR_NAMES.includes(name),
      ) ||
      (simulates && recognizedExpectedErrors.length === 0)
    ) {
      throw new Error(
        `execution spec event "${event.id}" requires a recognized expected error`,
      );
    }
    if (!legacyNullIsExact) {
      throw new Error(
        `execution spec event "${event.id}" contains an invalid legacy expected-error token`,
      );
    }
    if (new Set(event.expectedErrors).size !== event.expectedErrors.length) {
      throw new Error(`execution spec event at order ${index} is malformed`);
    }
    if (
      (sends &&
        (!isStableId(event.instructionBuilderId) ||
          !isStableId(event.postStateVerifierId) ||
          event.simulationDecoderId !== null ||
          event.waitPolicyId !== null ||
          event.feePayerRole === null ||
          event.instructionCount <= 0 ||
          event.expectedErrors.length !== 0)) ||
      (simulates &&
        (!isStableId(event.instructionBuilderId) ||
          event.postStateVerifierId !== null ||
          !isStableId(event.simulationDecoderId) ||
          event.waitPolicyId !== null ||
          event.feePayerRole === null ||
          event.instructionCount <= 0 ||
          createsAccounts ||
          event.rentPayerRole !== null ||
          event.expectedErrors.length === 0)) ||
      (waits &&
        (event.instructionBuilderId !== null ||
          event.postStateVerifierId !== null ||
          event.simulationDecoderId !== null ||
          !isStableId(event.waitPolicyId) ||
          event.feePayerRole !== null ||
          event.requiredNonPayerSignerRoles.length !== 0 ||
          event.instructionCount !== 0 ||
          createsAccounts ||
          event.rentPayerRole !== null ||
          event.expectedErrors.length !== 0 ||
          event.instructionSchemaIds.length !== 0 ||
          event.expiryPolicyRole !== null)) ||
      (createsAccounts && event.rentPayerRole === null) ||
      (createsAccounts && event.rentPayerRole !== event.feePayerRole) ||
      (!createsAccounts && event.rentPayerRole !== null)
    ) {
      throw new Error(`execution spec event "${event.id}" kind contract is invalid`);
    }
    if (
      event.instructionSchemaIds.length !== event.instructionCount
    ) {
      throw new Error(`event "${event.id}" instruction schema count is invalid`);
    }
    let hasDynamicFields = false;
    for (const id of event.instructionSchemaIds) {
      if (!schemas.has(id)) {
        throw new Error(`event "${event.id}" references unknown instruction schema "${id}"`);
      }
      reached.add(id);
      hasDynamicFields ||= schemas.get(id).dynamicFields.length > 0;
    }
    if (
      hasDynamicFields !== (event.expiryPolicyRole !== null) ||
      (hasDynamicFields && event.expiryPolicyRole !== event.flow)
    ) {
      throw new Error(
        `execution spec event "${event.id}" dynamic policy contract is invalid`,
      );
    }
    eventIds.add(event.id);
    if (event.flow !== "setup") reachedFlows.add(event.flow);
    derivedCeilings.sends += event.sendContribution;
    derivedCeilings.simulations += event.simulationContribution;
    for (const accountClass of event.creates) {
      derivedInventory[accountClass] += 1;
    }
  }
  if (
    reachedFlows.size !== ENABLED_FLOWS.length ||
    ENABLED_FLOWS.some((flow) => !reachedFlows.has(flow))
  ) {
    throw new Error("execution spec enabled flows are not represented by events");
  }
  if (
    !hasExactFields(spec.ceilings, new Set(["sends", "simulations"])) ||
    spec.ceilings.sends !== derivedCeilings.sends ||
    spec.ceilings.simulations !== derivedCeilings.simulations
  ) {
    throw new Error("execution spec ceilings do not match event contributions");
  }
  if (
    !hasExactFields(spec.inventory, new Set(CREATED_ACCOUNT_CLASSES)) ||
    CREATED_ACCOUNT_CLASSES.some(
      (accountClass) =>
        spec.inventory[accountClass] !== derivedInventory[accountClass],
    )
  ) {
    throw new Error("execution spec inventory does not match event creations");
  }
  for (const id of schemas.keys()) {
    if (!reached.has(id)) {
      throw new Error(`unreachable instruction schema "${id}"`);
    }
  }
  return spec;
}

export function selectExecutionEvents(spec, requestedFlows) {
  validateExecutionSpec(spec);
  if (
    !isCanonicalArray(requestedFlows) ||
    requestedFlows.length === 0 ||
    new Set(requestedFlows).size !== requestedFlows.length ||
    requestedFlows.some((flow) => !spec.enabledFlows.includes(flow))
  ) {
    throw new Error("requested execution flows are invalid");
  }

  let setupCount = 0;
  while (
    setupCount < spec.events.length &&
    spec.events[setupCount].flow === "setup"
  ) {
    setupCount += 1;
  }
  if (
    setupCount === 0 ||
    spec.events
      .slice(setupCount)
      .some((event) => event.flow === "setup")
  ) {
    throw new Error(
      "execution spec must contain one contiguous setup prefix with no later setup event",
    );
  }
  for (let index = 1; index < spec.events.length; index += 1) {
    if (spec.events[index - 1].order >= spec.events[index].order) {
      throw new Error("execution spec events must remain in strict canonical order");
    }
  }

  const requested = new Set(requestedFlows);
  const events = spec.events.filter(
    (event) => event.flow === "setup" || requested.has(event.flow),
  );
  if (
    requestedFlows.some(
      (flow) => !events.some((event) => event.flow === flow),
    ) ||
    events.slice(0, setupCount).some((event) => event.flow !== "setup") ||
    events.slice(setupCount).some((event) => event.flow === "setup")
  ) {
    throw new Error("requested execution flow has incomplete canonical coverage");
  }

  const dependencies = Object.freeze(
    Object.fromEntries(
      events.map((event) => [
        event.id,
        Object.freeze(
          events
            .filter(
              (candidate) =>
                candidate.order < event.order &&
                (candidate.flow === "setup" || candidate.flow === event.flow),
            )
            .map((candidate) => candidate.id),
        ),
      ]),
    ),
  );
  return Object.freeze({
    schema: "R4_SELECTED_BUSINESS_FLOW_EVENTS_V1",
    flows: Object.freeze([...requestedFlows]),
    events: Object.freeze([...events]),
    sendEvents: Object.freeze(
      events.filter((event) => event.kind === "SEND"),
    ),
    simulationEvents: Object.freeze(
      events.filter((event) => event.kind === "SIMULATE"),
    ),
    waitEvents: Object.freeze(
      events.filter((event) => event.kind === "WAIT"),
    ),
    dependencies,
  });
}

export function executionSpecHash(spec = BUSINESS_FLOW_EXECUTION_SPEC) {
  validateExecutionSpec(spec);
  return createHash("sha256")
    .update(
      `${BUSINESS_FLOW_EXECUTION_SPEC_DOMAIN}\0` +
        canonicalJson(spec),
    )
    .digest("hex");
}

function referencedIds(field) {
  return new Set(
    BUSINESS_FLOW_EXECUTION_SPEC.events
      .map((entry) => entry[field])
      .filter(Boolean),
  );
}

function validateRegistrySection(entries, expected, label, allowDeferred = false) {
  if (!isCanonicalArray(entries)) {
    throw new Error(`${label} registry must be a canonical entry array`);
  }
  const map = new Map();
  for (const entry of entries) {
    if (
      allowDeferred &&
      entry &&
      !Array.isArray(entry) &&
      typeof entry === "object"
    ) {
      if (
        typeof entry.id !== "string" ||
        entry.status !== "deferred" ||
        Object.keys(entry).some((field) => !["id", "status"].includes(field))
      ) {
        throw new Error(
          `${label} registry falsely claims implemented integration`,
        );
      }
      if (map.has(entry.id)) {
        throw new Error(`${label} registry contains duplicate ID "${entry.id}"`);
      }
      if (!expected.has(entry.id)) {
        throw new Error(`${label} registry contains unreferenced ID "${entry.id}"`);
      }
      map.set(entry.id, null);
      continue;
    }
    if (allowDeferred) {
      throw new Error(`${label} registry falsely claims implemented integration`);
    }
    if (!isCanonicalArray(entry)) {
      throw new Error(`${label} registry entry must be a canonical tuple array`);
    }
    if (
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      typeof entry[1] !== "function" ||
      entry[1].disabled === true
    ) {
      throw new Error(`${label} registry entry is malformed`);
    }
    if (map.has(entry[0])) {
      throw new Error(`${label} registry contains duplicate ID "${entry[0]}"`);
    }
    if (!expected.has(entry[0])) {
      throw new Error(`${label} registry contains unreferenced ID "${entry[0]}"`);
    }
    map.set(entry[0], entry[1]);
  }
  for (const id of expected) {
    if (!map.has(id)) {
      throw new Error(`${label} registry is missing required ID "${id}"`);
    }
  }
  return map;
}

export function validateExecutionRegistry(registry) {
  if (!registry || typeof registry !== "object") {
    throw new Error("execution registry is required");
  }
  const fields = new Set(["builders", "verifiers", "simulations", "waits"]);
  const keys = Reflect.ownKeys(registry);
  if (
    keys.length !== fields.size ||
    keys.some((field) => typeof field !== "string" || !fields.has(field))
  ) {
    throw new Error(
      "execution registry must contain exactly builders, verifiers, simulations, and waits",
    );
  }
  return Object.freeze({
    builders: validateRegistrySection(
      registry.builders,
      referencedIds("instructionBuilderId"),
      "builder",
    ),
    verifiers: validateRegistrySection(
      registry.verifiers,
      referencedIds("postStateVerifierId"),
      "verifier",
      true,
    ),
    simulations: validateRegistrySection(
      registry.simulations,
      referencedIds("simulationDecoderId"),
      "simulation",
      true,
    ),
    waits: validateRegistrySection(
      registry.waits,
      referencedIds("waitPolicyId"),
      "wait",
      true,
    ),
  });
}
