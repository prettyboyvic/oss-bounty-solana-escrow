// Governed devnet business-flow runner.
//
// Strict separation of a READ-ONLY plan mode from the authorization contract used
// by the canonical executor. This module never signs or sends; executeFullMatrix
// in business-flow-execution.mjs is the sole public execution entry point.
//
// Deployment/business identity is always taken from authoritative program and
// account reads (injected rpc adapter), never from the stale `.devnet/state.json`
// upload label.

import { createHash } from "node:crypto";

import { PublicKey } from "@solana/web3.js";

import {
  CLASSIC_TOKEN_PROGRAM_ID,
  DEVNET_GENESIS_HASH,
  DEVNET_RPC_URL,
  assertClassicTokenProgram,
  assertDevnetGenesis,
  sanitizePublicOutput,
} from "./safety.mjs";
import { canonicalJson } from "./durable-json.mjs";
import { effectiveExpectedErrorNames } from "./business-flow-errors.mjs";
import {
  BUSINESS_FLOW_EXECUTION_SPEC,
  selectExecutionEvents,
} from "./business-flow-spec.mjs";

export const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
export const PROGRAMDATA_METADATA_OFFSET = 45; // tag(4)+slot(8)+option(1)+pubkey(32)
export const RUNNER_MANIFEST_SCHEMA = "R4_BUSINESS_FLOW_MANIFEST_V1";
export const RUNNER_MANIFEST_DOMAIN = "R4_BUSINESS_FLOW_MANIFEST_V1";

// Bounded acceptance-flow labels. Transaction and funding projections come from
// the selected canonical execution events below.
export const FLOW_DEFINITIONS = Object.freeze({
  release: Object.freeze({
    steps: Object.freeze(["initialize", "fund", "release"]),
    requiresExpiryWait: false,
  }),
  refund: Object.freeze({
    steps: Object.freeze(["initialize", "fund", "refund"]),
    requiresExpiryWait: true,
  }),
  cancel: Object.freeze({
    steps: Object.freeze(["initialize", "cancel"]),
    requiresExpiryWait: false,
  }),
});

export const FLOW_NAMES = Object.freeze(Object.keys(FLOW_DEFINITIONS));

// Negative checks are simulate-only by contract. The runner refuses to send them
// live; a later session runs them through read-only transaction simulation.
export const NEGATIVE_CHECKS = Object.freeze([
  ...BUSINESS_FLOW_EXECUTION_SPEC.events
    .filter((event) => event.kind === "SIMULATE")
    .map((event) =>
      Object.freeze({
        id: event.id,
        mode: "simulate",
        expectedErrors: effectiveExpectedErrorNames(event),
      }),
    ),
]);

// Anchor global-namespace instruction discriminator (matches tests/idl.ts).
export function instructionDiscriminator(name) {
  return [...createHash("sha256").update(`global:${name}`).digest().subarray(0, 8)];
}

function assertPublicKey(value, label) {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${label} must be a valid Solana public key`);
  }
}

// --- Deterministic PDA derivation, matching the on-chain program seeds. ---

export function deriveEscrowPda(programId, sponsor, externalRefHash) {
  const bytes = normalizeRefHash(externalRefHash);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), assertPublicKey(sponsor, "sponsor").toBuffer(), Buffer.from(bytes)],
    assertPublicKey(programId, "programId"),
  )[0];
}

export function deriveVaultPda(programId, escrow) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), assertPublicKey(escrow, "escrow").toBuffer()],
    assertPublicKey(programId, "programId"),
  )[0];
}

function normalizeRefHash(externalRefHash) {
  const bytes = Array.isArray(externalRefHash)
    ? Uint8Array.from(externalRefHash)
    : externalRefHash;
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
    throw new Error("external reference hash must be 32 bytes");
  }
  if (bytes.every((b) => b === 0)) {
    throw new Error("external reference hash must not be all zeros");
  }
  return bytes;
}

// Unique external reference per escrow instance. The uniqueness token guarantees
// distinct PDAs across runs, preventing "account already in use" collisions.
export function externalReference(flow, uniquenessToken) {
  if (!FLOW_NAMES.includes(flow)) throw new Error(`unknown flow "${flow}"`);
  if (typeof uniquenessToken !== "string" || uniquenessToken.length === 0) {
    throw new Error("a non-empty uniqueness token is required");
  }
  const label = `r4-business-flow:${flow}:${uniquenessToken}`;
  const hash = [...createHash("sha256").update(label).digest()];
  return { flow, label, externalRefHash: hash };
}

export function deriveFlowInstances(flows, uniquenessToken, { programId, sponsor }) {
  const seen = new Set();
  return flows.map((flow) => {
    const ref = externalReference(flow, `${uniquenessToken}:${flow}`);
    const key = ref.externalRefHash.join(",");
    if (seen.has(key)) throw new Error("external references must be unique per instance");
    seen.add(key);
    const escrow = deriveEscrowPda(programId, sponsor, ref.externalRefHash);
    const vault = deriveVaultPda(programId, escrow);
    return Object.freeze({
      flow,
      externalRefLabel: ref.label,
      externalRefHash: ref.externalRefHash,
      escrow: escrow.toBase58(),
      vault: vault.toBase58(),
    });
  });
}

// --- Expiry policy: bounded, derived from authoritative chain time. ---

export function planExpiry({
  chainTimeSeconds,
  initFundBufferSeconds = 45,
  refundExpiryLeadSeconds = 20,
  pollIntervalMs = 3000,
  waitTimeoutMs = 120000,
}) {
  if (!Number.isFinite(chainTimeSeconds) || chainTimeSeconds <= 0) {
    throw new Error("authoritative chain time is required");
  }
  for (const [k, v] of Object.entries({
    initFundBufferSeconds,
    refundExpiryLeadSeconds,
    pollIntervalMs,
    waitTimeoutMs,
  })) {
    if (!Number.isInteger(v) || v <= 0) throw new Error(`${k} must be a positive integer`);
  }
  // Release-path escrows expire far enough ahead that init+fund+release all land
  // strictly before expiry. Refund-path escrows use a short but non-fragile lead
  // so the bounded wait terminates quickly yet never relies on same-second timing.
  if (refundExpiryLeadSeconds < 10) throw new Error("refund expiry lead is too fragile");
  if (waitTimeoutMs <= refundExpiryLeadSeconds * 1000) {
    throw new Error("wait timeout must exceed the refund expiry lead");
  }
  const releaseExpiry = chainTimeSeconds + initFundBufferSeconds + 3600;
  const refundExpiry = chainTimeSeconds + refundExpiryLeadSeconds;
  return Object.freeze({
    chainTimeSeconds,
    releaseExpiry,
    refundExpiry,
    wait: Object.freeze({
      targetSeconds: refundExpiry,
      pollIntervalMs,
      timeoutMs: waitTimeoutMs,
      // A wait must STOP (not resend) if chain time has not reached the target
      // within the timeout; the caller then classifies UNCERTAIN.
      stopIfNotReached: true,
    }),
  });
}

// A pure bound checker for the wait loop, unit-testable without real time.
export function waitReached({ chainTimeSeconds, targetSeconds, elapsedMs, timeoutMs }) {
  if (chainTimeSeconds >= targetSeconds) return { done: true, reason: "REACHED" };
  if (elapsedMs >= timeoutMs) return { done: true, reason: "TIMEOUT_STOP" };
  return { done: false, reason: "WAITING" };
}

// --- Funding model. ---

const FUNDING_IDENTITIES = Object.freeze([
  "sponsor",
  "maintainer",
  "contributor",
  "mintAuthority",
]);
const CREATED_ACCOUNT_CLASSES = Object.freeze([
  "mint",
  "ata",
  "escrow",
  "vault",
]);

function assertNonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative integer`);
  }
  return value;
}

function validatePerIdentityLamports(values, label) {
  if (
    values === null ||
    typeof values !== "object" ||
    Array.isArray(values)
  ) {
    throw new Error(`${label} must be an object`);
  }
  for (const [identity, value] of Object.entries(values)) {
    if (!FUNDING_IDENTITIES.includes(identity)) {
      throw new Error(`unknown funding identity "${identity}"`);
    }
    assertNonnegativeInteger(value, `${label}.${identity}`);
  }
}

export function deriveSelectedFunding({
  selectedPlan,
  rentByClass,
  // Solana charges the base fee PER required signature, not per transaction.
  feePerSignature,
  retryReserveByIdentity = {},
  safetyMarginByIdentity = {},
}) {
  if (
    selectedPlan === null ||
    typeof selectedPlan !== "object" ||
    !Array.isArray(selectedPlan.events) ||
    !Array.isArray(selectedPlan.sendEvents) ||
    !Array.isArray(selectedPlan.simulationEvents) ||
    !Array.isArray(selectedPlan.waitEvents)
  ) {
    throw new Error("selectedPlan must contain canonical event projections");
  }
  if (
    rentByClass === null ||
    typeof rentByClass !== "object" ||
    Array.isArray(rentByClass)
  ) {
    throw new Error("rentByClass must be an object");
  }
  assertNonnegativeInteger(feePerSignature, "feePerSignature");
  validatePerIdentityLamports(
    retryReserveByIdentity,
    "retryReserveByIdentity",
  );
  validatePerIdentityLamports(
    safetyMarginByIdentity,
    "safetyMarginByIdentity",
  );

  const byIdentity = Object.fromEntries(
    FUNDING_IDENTITIES.map((identity) => [
      identity,
      {
        // feeCount is the number of transactions this identity pays for;
        // signatureCount is the total required signatures across them. Solana
        // fees are per signature, so feeLamports tracks signatureCount.
        feeCount: 0,
        signatureCount: 0,
        feeLamports: 0,
        rentLamports: 0,
        retryReserveLamports: retryReserveByIdentity[identity] ?? 0,
        safetyMarginLamports: safetyMarginByIdentity[identity] ?? 0,
        requiredLamports: 0,
      },
    ]),
  );
  const createdAccountsByClass = Object.fromEntries(
    CREATED_ACCOUNT_CLASSES.map((accountClass) => [accountClass, 0]),
  );

  for (const event of selectedPlan.sendEvents) {
    if (!FUNDING_IDENTITIES.includes(event?.feePayerRole)) {
      throw new Error(`unknown fee payer "${event?.feePayerRole}"`);
    }
    // Required signatures = fee payer + distinct non-payer signer roles. This
    // equals the compiled legacy message's numRequiredSignatures for the frozen
    // canonical singleton, proven by the compiled-message equality oracle in
    // tests. The preconditions below (canonical dense array, no duplicate role,
    // no non-payer role aliasing the fee payer) are what make role count an
    // exact — never undercounting — representation; distinct signer identities
    // are enforced separately by assertDistinctBusinessIdentities. If two roles
    // ever aliased the same pubkey, the compiled message would dedup them, so
    // role count is a safe upper bound (over-funds) rather than an undercount.
    const signerRoles = event.requiredNonPayerSignerRoles;
    if (!Array.isArray(signerRoles)) {
      throw new Error(`event "${event.id}" required signer roles are invalid`);
    }
    if (new Set(signerRoles).size !== signerRoles.length) {
      throw new Error(`event "${event.id}" has duplicate required signer roles`);
    }
    if (signerRoles.includes(event.feePayerRole)) {
      throw new Error(
        `event "${event.id}" non-payer signer role must not equal the fee payer`,
      );
    }
    const requiredSignatures = 1 + signerRoles.length;
    const feePayer = byIdentity[event.feePayerRole];
    feePayer.feeCount += 1;
    feePayer.signatureCount += requiredSignatures;
    feePayer.feeLamports += requiredSignatures * feePerSignature;

    if (!Array.isArray(event.creates)) {
      throw new Error(`event "${event.id}" created account classes are invalid`);
    }
    for (const accountClass of event.creates) {
      if (!CREATED_ACCOUNT_CLASSES.includes(accountClass)) {
        throw new Error(`unknown created account class "${accountClass}"`);
      }
      if (!FUNDING_IDENTITIES.includes(event.rentPayerRole)) {
        throw new Error(`unknown rent payer "${event.rentPayerRole}"`);
      }
      if (event.rentPayerRole !== event.feePayerRole) {
        throw new Error(
          `event "${event.id}" rent payer must equal its fee payer`,
        );
      }
      assertNonnegativeInteger(
        rentByClass[accountClass],
        `rentByClass.${accountClass}`,
      );
      createdAccountsByClass[accountClass] += 1;
      byIdentity[event.rentPayerRole].rentLamports +=
        rentByClass[accountClass];
    }
  }

  for (const funding of Object.values(byIdentity)) {
    funding.requiredLamports =
      funding.feeLamports +
      funding.rentLamports +
      funding.retryReserveLamports +
      funding.safetyMarginLamports;
    assertNonnegativeInteger(
      funding.requiredLamports,
      "derived identity funding",
    );
    Object.freeze(funding);
  }
  const recoverableRentLamports = Object.values(byIdentity).reduce(
    (sum, funding) => sum + funding.rentLamports,
    0,
  );
  const transactionFeeLamports = Object.values(byIdentity).reduce(
    (sum, funding) => sum + funding.feeLamports,
    0,
  );
  const requiredBalanceLamports = Object.values(byIdentity).reduce(
    (sum, funding) => sum + funding.requiredLamports,
    0,
  );
  const safetyReserveLamports = Object.values(byIdentity).reduce(
    (sum, funding) => sum + funding.safetyMarginLamports,
    0,
  );

  return Object.freeze({
    selectedEventIds: Object.freeze(
      selectedPlan.events.map((event) => event.id),
    ),
    sendCount: selectedPlan.sendEvents.length,
    simulationCount: selectedPlan.simulationEvents.length,
    waitCount: selectedPlan.waitEvents.length,
    createdAccountsByClass: Object.freeze(createdAccountsByClass),
    recoverableRentLamports,
    transactionFeeLamports,
    requiredBalanceLamports,
    byIdentity: Object.freeze(byIdentity),
    // Compatibility aliases derived from the canonical per-payer projection.
    recoverableRent: recoverableRentLamports,
    permanentFees: transactionFeeLamports,
    totalWrites: selectedPlan.sendEvents.length,
    safetyReserveLamports,
    requiredLamports: requiredBalanceLamports,
  });
}

function fundingManifestProjection(funding) {
  if (
    funding === null ||
    typeof funding !== "object" ||
    !Array.isArray(funding.selectedEventIds)
  ) {
    throw new Error("funding projection is invalid");
  }
  const selectedEventIds = funding.selectedEventIds.map((eventId) => {
    if (typeof eventId !== "string" || eventId.length === 0) {
      throw new Error("funding selected event ID is invalid");
    }
    return eventId;
  });
  const createdAccountsByClass = Object.fromEntries(
    CREATED_ACCOUNT_CLASSES.map((accountClass) => [
      accountClass,
      assertNonnegativeInteger(
        funding.createdAccountsByClass?.[accountClass],
        `funding.createdAccountsByClass.${accountClass}`,
      ),
    ]),
  );
  const byIdentity = Object.fromEntries(
    FUNDING_IDENTITIES.map((identity) => {
      const allocation = funding.byIdentity?.[identity];
      return [
        identity,
        Object.fromEntries(
          [
            "feeCount",
            "signatureCount",
            "feeLamports",
            "rentLamports",
            "retryReserveLamports",
            "safetyMarginLamports",
            "requiredLamports",
          ].map((field) => [
            field,
            assertNonnegativeInteger(
              allocation?.[field],
              `funding.byIdentity.${identity}.${field}`,
            ),
          ]),
        ),
      ];
    }),
  );
  return {
    selectedEventIds,
    sendCount: assertNonnegativeInteger(
      funding.sendCount,
      "funding.sendCount",
    ),
    simulationCount: assertNonnegativeInteger(
      funding.simulationCount,
      "funding.simulationCount",
    ),
    waitCount: assertNonnegativeInteger(
      funding.waitCount,
      "funding.waitCount",
    ),
    createdAccountsByClass,
    recoverableRentLamports: assertNonnegativeInteger(
      funding.recoverableRentLamports,
      "funding.recoverableRentLamports",
    ),
    transactionFeeLamports: assertNonnegativeInteger(
      funding.transactionFeeLamports,
      "funding.transactionFeeLamports",
    ),
    requiredBalanceLamports: assertNonnegativeInteger(
      funding.requiredBalanceLamports,
      "funding.requiredBalanceLamports",
    ),
    byIdentity,
  };
}

// --- Identity controls. ---

export function assertNotDeploymentAuthority(pubkey, upgradeAuthority, role) {
  if (String(pubkey) === String(upgradeAuthority)) {
    throw new Error(
      `${role} must not be the deployment/upgrade authority (${upgradeAuthority})`,
    );
  }
}

export function assertDistinctBusinessIdentities(identities) {
  const normalized = Object.fromEntries(
    ["sponsor", "maintainer", "contributor"].map((role) => [
      role,
      assertPublicKey(identities?.[role], role).toBase58(),
    ]),
  );
  if (new Set(Object.values(normalized)).size !== 3) {
    throw new Error(
      "sponsor, maintainer, and contributor must be mutually distinct",
    );
  }
  return Object.freeze(normalized);
}

function parseUpgradeAuthorityFromProgramData(data) {
  const buf = Buffer.from(data);
  if (buf.length < PROGRAMDATA_METADATA_OFFSET) {
    throw new Error("program data account is too small to be ProgramData");
  }
  const tag = buf.readUInt32LE(0);
  if (tag !== 3) throw new Error("account is not a ProgramData account");
  const hasAuthority = buf.readUInt8(12);
  return hasAuthority ? new PublicKey(buf.subarray(13, 45)).toBase58() : null;
}

// --- Transaction ceiling. ---

export function computeTransactionCeiling(flows) {
  return selectExecutionEvents(
    BUSINESS_FLOW_EXECUTION_SPEC,
    flows,
  ).sendEvents.length;
}

// --- Manifest. ---

export function buildManifest(fields) {
  const manifest = {
    schema: RUNNER_MANIFEST_SCHEMA,
    cluster: fields.cluster,
    genesisHash: fields.genesisHash,
    programId: fields.programId,
    programDataAddress: fields.programDataAddress,
    upgradeAuthority: fields.upgradeAuthority,
    tokenProgram: CLASSIC_TOKEN_PROGRAM_ID,
    flows: [...fields.flows],
    uniquenessToken: fields.uniquenessToken,
    instances: fields.instances.map((i) => ({
      flow: i.flow,
      externalRefLabel: i.externalRefLabel,
      escrow: i.escrow,
      vault: i.vault,
    })),
    selectedEvents: {
      schema: fields.selectedEvents.schema,
      eventIds: [...fields.selectedEvents.eventIds],
      sendCount: fields.selectedEvents.sendCount,
      simulationCount: fields.selectedEvents.simulationCount,
      waitCount: fields.selectedEvents.waitCount,
    },
    funding: fundingManifestProjection(fields.funding),
    transactionCeiling: fields.transactionCeiling,
    negativeChecks: fields.negativeChecks.map((n) => ({
      id: n.id,
      mode: n.mode,
    })),
    amount: fields.amount,
    decimals: fields.decimals,
  };
  return Object.freeze(manifest);
}

export function manifestHash(manifest) {
  return createHash("sha256")
    .update(`${RUNNER_MANIFEST_DOMAIN}\0${canonicalJson(manifest)}`)
    .digest("hex");
}

// --- Read-only plan mode. ---

// The rpc adapter must expose only read methods. buildPlan asserts this and never
// calls a signing/sending method.
const FORBIDDEN_RPC_METHODS = Object.freeze([
  "sendTransaction",
  "sendRawTransaction",
  "signTransaction",
  "requestAirdrop",
  "confirmTransaction",
]);

export async function buildPlan(request, rpc) {
  const {
    rpcUrl,
    expectedProgramId,
    identities, // { sponsor, maintainer, contributor } public keys
    flows = FLOW_NAMES,
    uniquenessToken,
    amount = 1_000_000,
    decimals = 6,
    rentReads, // { mintRent, tokenAccountRent, escrowRent }
    feePerSignature = 5000,
    safetyReserveLamports = 20_000_000,
  } = request;

  if (rpcUrl !== DEVNET_RPC_URL) throw new Error("plan requires the exact devnet RPC URL");
  for (const m of FORBIDDEN_RPC_METHODS) {
    if (typeof rpc?.[m] === "function") {
      throw new Error(`plan-mode rpc adapter must not expose ${m}`);
    }
  }
  for (const flow of flows) {
    if (!FLOW_NAMES.includes(flow)) throw new Error(`unknown flow "${flow}"`);
  }
  if (typeof uniquenessToken !== "string" || uniquenessToken.length === 0) {
    throw new Error("a uniqueness token is required");
  }
  const selectedPlan = selectExecutionEvents(
    BUSINESS_FLOW_EXECUTION_SPEC,
    flows,
  );
  const selectedEvents = Object.freeze({
    schema: selectedPlan.schema,
    eventIds: Object.freeze(
      selectedPlan.events.map((event) => event.id),
    ),
    sendCount: selectedPlan.sendEvents.length,
    simulationCount: selectedPlan.simulationEvents.length,
    waitCount: selectedPlan.waitEvents.length,
  });

  const genesis = await rpc.getGenesisHash();
  assertDevnetGenesis(genesis);

  const programId = assertPublicKey(expectedProgramId, "expectedProgramId").toBase58();
  const programInfo = await rpc.getAccountInfo(new PublicKey(programId));
  if (!programInfo) throw new Error("deployed program account is absent");
  if (programInfo.owner.toBase58() !== UPGRADEABLE_LOADER) {
    throw new Error("program account is not owned by the upgradeable loader");
  }
  if (!programInfo.executable) throw new Error("program account is not executable");
  const programDataAddress = new PublicKey(
    Buffer.from(programInfo.data).subarray(4, 36),
  ).toBase58();
  const [derivedPd] = PublicKey.findProgramAddressSync(
    [new PublicKey(programId).toBuffer()],
    new PublicKey(UPGRADEABLE_LOADER),
  );
  if (derivedPd.toBase58() !== programDataAddress) {
    throw new Error("program does not link to the expected ProgramData PDA");
  }
  const pdInfo = await rpc.getAccountInfo(new PublicKey(programDataAddress));
  if (!pdInfo) throw new Error("ProgramData account is absent");
  const upgradeAuthority = parseUpgradeAuthorityFromProgramData(pdInfo.data);
  if (!upgradeAuthority) throw new Error("program is immutable; expected a retained authority");

  const normalizedIdentities = assertDistinctBusinessIdentities(identities);
  // Business identities must be distinct from the deployment/upgrade authority.
  for (const role of ["sponsor", "maintainer", "contributor"]) {
    assertNotDeploymentAuthority(
      normalizedIdentities[role],
      upgradeAuthority,
      role,
    );
  }

  const sponsor = normalizedIdentities.sponsor;
  const instances = deriveFlowInstances(flows, uniquenessToken, { programId, sponsor });

  const balances = {};
  for (const role of ["sponsor", "maintainer", "contributor"]) {
    balances[role] = await rpc.getBalance(new PublicKey(identities[role]));
  }

  const transactionCeiling = selectedPlan.sendEvents.length;
  const funding = deriveSelectedFunding({
    selectedPlan,
    rentByClass: {
      mint: rentReads?.mintRent,
      ata: rentReads?.tokenAccountRent,
      escrow: rentReads?.escrowRent,
      vault: rentReads?.tokenAccountRent,
    },
    feePerSignature,
    safetyMarginByIdentity: {
      sponsor: safetyReserveLamports,
    },
  });

  const fundingSufficientByIdentity = Object.freeze(
    Object.fromEntries(
      FUNDING_IDENTITIES.map((identity) => {
        const required = funding.byIdentity[identity].requiredLamports;
        const balance = balances[identity];
        return [
          identity,
          required === 0 ||
            (Number.isSafeInteger(balance) && balance >= required),
        ];
      }),
    ),
  );
  const fundingSufficient = Object.values(
    fundingSufficientByIdentity,
  ).every(Boolean);
  const selectedNegativeChecks = selectedPlan.simulationEvents.map((event) =>
    NEGATIVE_CHECKS.find((check) => check.id === event.id),
  );

  const manifest = buildManifest({
    cluster: "devnet",
    genesisHash: genesis,
    programId,
    programDataAddress,
    upgradeAuthority,
    flows,
    uniquenessToken,
    instances,
    selectedEvents,
    funding,
    transactionCeiling,
    negativeChecks: selectedNegativeChecks,
    amount,
    decimals,
  });

  const sanitizedTransactionPlan = selectedPlan.sendEvents.map((event) => {
    const instruction = event.id.includes(":")
      ? event.id.slice(event.id.indexOf(":") + 1)
      : event.id;
    return {
      eventId: event.id,
      flow: event.flow,
      instruction,
      discriminator: instructionDiscriminator(instruction),
      kind: "live-write",
    };
  });

  return sanitizePublicOutput({
    mode: "PLAN",
    stateMutation: false,
    liveWriteExecuted: false,
    createdAtMs: typeof request.nowMs === "number" ? request.nowMs : Date.now(),
    manifest,
    manifestHash: manifestHash(manifest),
    tokenProgram: CLASSIC_TOKEN_PROGRAM_ID,
    upgradeAuthority,
    identities: {
      sponsor,
      maintainer: normalizedIdentities.maintainer,
      contributor: normalizedIdentities.contributor,
    },
    balances,
    funding,
    fundingSufficientByIdentity,
    fundingSufficient,
    selectedEvents,
    transactionCeiling,
    negativeChecks: selectedNegativeChecks,
    sanitizedTransactionPlan,
    notes: fundingSufficient
      ? []
      : [
          `BLOCKED_FUNDING: ${FUNDING_IDENTITIES.filter(
            (identity) => !fundingSufficientByIdentity[identity],
          ).join(", ")} balance is below the required lamports; do not airdrop automatically`,
        ],
  });
}

// --- Execute authorization contract (implemented; not invoked this phase). ---

export function authorizeExecution(plan, authorization) {
  if (!plan || plan.mode !== "PLAN") throw new Error("a fresh plan is required");
  if (manifestHash(plan.manifest) !== plan.manifestHash) {
    throw new Error("plan manifest hash does not match manifest content");
  }
  if (
    canonicalJson(fundingManifestProjection(plan.funding)) !==
    canonicalJson(plan.manifest.funding)
  ) {
    throw new Error("plan funding projection does not match the manifest");
  }
  const required = [
    "manifestHash",
    "expectedGenesisHash",
    "expectedProgramId",
    "executionId",
    "transactionCeiling",
    "enabledFlows",
    "identityAssertions",
    "acknowledgeDevnet",
  ];
  for (const key of required) {
    if (authorization?.[key] === undefined || authorization?.[key] === null || authorization?.[key] === "") {
      throw new Error(`execute authorization is missing "${key}"`);
    }
  }
  if (authorization.acknowledgeDevnet !== "R4_DEVNET_BUSINESS_FLOW") {
    throw new Error("explicit devnet acknowledgement is required");
  }
  if (authorization.manifestHash !== plan.manifestHash) {
    throw new Error("stale or mismatched manifest hash");
  }
  if (authorization.expectedGenesisHash !== plan.manifest.genesisHash) {
    throw new Error("cluster/genesis hash mismatch");
  }
  if (authorization.expectedGenesisHash !== DEVNET_GENESIS_HASH) {
    throw new Error("execute authorization must target devnet genesis");
  }
  if (authorization.expectedProgramId !== plan.manifest.programId) {
    throw new Error("program ID mismatch");
  }
  if (authorization.transactionCeiling !== plan.transactionCeiling) {
    throw new Error("transaction ceiling mismatch");
  }
  const enabled = [...authorization.enabledFlows];
  for (const flow of enabled) {
    if (!plan.manifest.flows.includes(flow)) throw new Error(`flow "${flow}" is not in the plan`);
  }
  // Identity assertions must match the plan and exclude the upgrade authority.
  for (const role of ["sponsor", "maintainer", "contributor"]) {
    const asserted = authorization.identityAssertions[role];
    if (asserted !== plan.identities[role]) {
      throw new Error(`identity assertion mismatch for ${role}`);
    }
    assertNotDeploymentAuthority(asserted, plan.upgradeAuthority, role);
  }
  return Object.freeze({
    authorized: true,
    executionId: authorization.executionId,
    enabledFlows: Object.freeze(enabled),
    transactionCeiling: authorization.transactionCeiling,
  });
}
