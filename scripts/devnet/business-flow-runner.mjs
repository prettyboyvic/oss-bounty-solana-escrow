// Governed devnet business-flow runner.
//
// Strict separation of a READ-ONLY plan mode from an authorization-gated execute
// mode. Plan mode never signs or sends. Execute mode is fully implemented but is
// never invoked by this module or its CLI in the enablement phase; it delegates
// all signing/sending to injected dependencies so that no secret-key bytes and no
// live devnet dependency ever enter this module or CI.
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

export const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
export const PROGRAMDATA_METADATA_OFFSET = 45; // tag(4)+slot(8)+option(1)+pubkey(32)
export const RUNNER_MANIFEST_SCHEMA = "R4_BUSINESS_FLOW_MANIFEST_V1";
export const RUNNER_MANIFEST_DOMAIN = "R4_BUSINESS_FLOW_MANIFEST_V1";

// Bounded acceptance flows. Live-write transaction counts are conservative upper
// bounds for the escrow instructions themselves (setup transactions are counted
// separately in the funding model).
export const FLOW_DEFINITIONS = Object.freeze({
  release: Object.freeze({
    steps: Object.freeze(["initialize", "fund", "release"]),
    liveWrites: 3,
    requiresExpiryWait: false,
  }),
  refund: Object.freeze({
    steps: Object.freeze(["initialize", "fund", "refund"]),
    liveWrites: 3,
    requiresExpiryWait: true,
  }),
  cancel: Object.freeze({
    steps: Object.freeze(["initialize", "cancel"]),
    liveWrites: 2,
    requiresExpiryWait: false,
  }),
});

export const FLOW_NAMES = Object.freeze(Object.keys(FLOW_DEFINITIONS));

// Negative checks are simulate-only by contract. The runner refuses to send them
// live; a later session runs them through read-only transaction simulation.
export const NEGATIVE_CHECKS = Object.freeze([
  Object.freeze({ id: "unauthorized_release", mode: "simulate", expectedError: "ConstraintHasOne" }),
  Object.freeze({ id: "refund_before_expiry", mode: "simulate", expectedError: "EscrowNotExpired" }),
  Object.freeze({ id: "release_at_or_after_expiry", mode: "simulate", expectedError: "EscrowExpired" }),
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

export function computeFundingPlan({
  mintRent,
  tokenAccountRent,
  escrowRent,
  feePerTransaction,
  setupWrites,
  flowLiveWrites,
  tokenAccountCount,
  safetyReserveLamports,
}) {
  for (const [k, v] of Object.entries({
    mintRent,
    tokenAccountRent,
    escrowRent,
    feePerTransaction,
    setupWrites,
    flowLiveWrites,
    tokenAccountCount,
    safetyReserveLamports,
  })) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`${k} must be a nonnegative integer`);
  }
  // Rent is potentially recoverable (accounts may later be closed by a separately
  // authorized session); fees are permanent.
  const recoverableRent =
    mintRent + escrowRent + tokenAccountRent * tokenAccountCount;
  const totalWrites = setupWrites + flowLiveWrites;
  const permanentFees = totalWrites * feePerTransaction;
  const requiredLamports = recoverableRent + permanentFees + safetyReserveLamports;
  return Object.freeze({
    recoverableRent,
    permanentFees,
    totalWrites,
    safetyReserveLamports,
    requiredLamports,
  });
}

// --- Identity controls. ---

export function assertNotDeploymentAuthority(pubkey, upgradeAuthority, role) {
  if (String(pubkey) === String(upgradeAuthority)) {
    throw new Error(
      `${role} must not be the deployment/upgrade authority (${upgradeAuthority})`,
    );
  }
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
  return flows.reduce((sum, flow) => {
    const def = FLOW_DEFINITIONS[flow];
    if (!def) throw new Error(`unknown flow "${flow}"`);
    return sum + def.liveWrites;
  }, 0);
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
    transactionCeiling: fields.transactionCeiling,
    negativeChecks: NEGATIVE_CHECKS.map((n) => ({ id: n.id, mode: n.mode })),
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
    feePerTransaction = 5000,
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

  // Business identities must be distinct from the deployment/upgrade authority.
  for (const role of ["sponsor", "maintainer", "contributor"]) {
    const pk = assertPublicKey(identities[role], role).toBase58();
    assertNotDeploymentAuthority(pk, upgradeAuthority, role);
  }

  const sponsor = new PublicKey(identities.sponsor).toBase58();
  const instances = deriveFlowInstances(flows, uniquenessToken, { programId, sponsor });

  const balances = {};
  for (const role of ["sponsor", "maintainer", "contributor"]) {
    balances[role] = await rpc.getBalance(new PublicKey(identities[role]));
  }

  const transactionCeiling = computeTransactionCeiling(flows);
  // Setup writes bounded conservatively: 1 mint + 3 token accounts + 3 mintTo.
  const funding = computeFundingPlan({
    mintRent: rentReads.mintRent,
    tokenAccountRent: rentReads.tokenAccountRent,
    escrowRent: rentReads.escrowRent,
    feePerTransaction,
    setupWrites: 7,
    flowLiveWrites: transactionCeiling,
    tokenAccountCount: 3, // sponsor, contributor, vault
    safetyReserveLamports,
  });

  const fundingSufficient = balances.sponsor >= funding.requiredLamports;

  const manifest = buildManifest({
    cluster: "devnet",
    genesisHash: genesis,
    programId,
    programDataAddress,
    upgradeAuthority,
    flows,
    uniquenessToken,
    instances,
    transactionCeiling,
    amount,
    decimals,
  });

  const sanitizedTransactionPlan = flows.flatMap((flow) =>
    FLOW_DEFINITIONS[flow].steps.map((step) => ({
      flow,
      instruction: step,
      discriminator: instructionDiscriminator(step),
      kind: "live-write",
    })),
  );

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
      maintainer: new PublicKey(identities.maintainer).toBase58(),
      contributor: new PublicKey(identities.contributor).toBase58(),
    },
    balances,
    funding,
    fundingSufficient,
    transactionCeiling,
    negativeChecks: NEGATIVE_CHECKS,
    sanitizedTransactionPlan,
    notes: fundingSufficient
      ? []
      : ["BLOCKED_FUNDING: sponsor balance is below the required lamports; do not airdrop automatically"],
  });
}

// --- Execute authorization contract (implemented; not invoked this phase). ---

export function authorizeExecution(plan, authorization) {
  if (!plan || plan.mode !== "PLAN") throw new Error("a fresh plan is required");
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

// Execute path. Requires authorization and injected signer/sender/reader. NEVER
// invoked by this module or the CLI in the enablement phase. It performs no
// blind retry and preserves partial-success evidence on any failure.
export async function executeBusinessFlows(plan, authorization, deps) {
  const grant = authorizeExecution(plan, authorization);
  if (!deps || typeof deps.signAndSend !== "function" || typeof deps.readAccount !== "function") {
    throw new Error("execute requires injected signAndSend and readAccount dependencies");
  }
  assertClassicTokenProgram(plan.manifest.tokenProgram);

  const steps = [];
  for (const flow of grant.enabledFlows) {
    for (const step of FLOW_DEFINITIONS[flow].steps) {
      steps.push({ flow, instruction: step });
    }
  }
  if (steps.length > grant.transactionCeiling * 2) {
    // Defensive: total sub-steps must never exceed a sane bound of the ceiling.
    throw new Error("planned steps exceed the authorized ceiling");
  }

  const evidence = [];
  let sent = 0;
  for (const step of steps) {
    if (sent >= grant.transactionCeiling) {
      throw new Error("transaction ceiling reached");
    }
    let outcome;
    try {
      outcome = await deps.signAndSend(step);
    } catch (error) {
      // Preserve partial-success evidence; do not retry.
      evidence.push({ ...step, status: "FAILED", error: String(error?.message ?? error) });
      return Object.freeze({
        status: "STOPPED",
        reason: "STEP_FAILED",
        sent,
        evidence: Object.freeze(evidence),
      });
    }
    sent += 1;
    const post = await deps.readAccount(step);
    if (post?.expectedStatus && post.observedStatus !== post.expectedStatus) {
      evidence.push({ ...step, status: "UNEXPECTED_STATE", ...sanitizePublicOutput(post) });
      return Object.freeze({
        status: "STOPPED",
        reason: "UNEXPECTED_STATE",
        sent,
        evidence: Object.freeze(evidence),
      });
    }
    evidence.push({ ...step, status: "CONFIRMED", ...sanitizePublicOutput(outcome), ...sanitizePublicOutput(post) });
  }
  return Object.freeze({ status: "COMPLETE", sent, evidence: Object.freeze(evidence) });
}
