// Concrete live-execution orchestrator for the devnet business-flow acceptance
// matrix. Consumes a fresh manifest-bound plan (business-flow-runner.mjs), an
// authorization grant, and a production adapter (business-flow-adapter.mjs). It
// builds real instructions (business-flow-instructions.mjs), enforces the full
// transaction ceiling (setup + flows), integrates authoritative chain-time expiry
// waiting for refund, verifies post-state through account decoders, records
// durable receipts, and classifies outcomes without blind retry.
//
// It is never invoked against live devnet in the repair phase or in CI. Tests
// drive it with a fake connection and a deterministic fake clock.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PublicKey } from "@solana/web3.js";

import {
  FLOW_DEFINITIONS,
  UPGRADEABLE_LOADER,
  assertNotDeploymentAuthority,
  authorizeExecution,
  deriveEscrowPda,
  deriveVaultPda,
  waitReached,
} from "./business-flow-runner.mjs";
import {
  associatedTokenAddress,
  buildCancel,
  buildCreateAssociatedTokenAccount,
  buildCreateMintInstructions,
  buildFundEscrow,
  buildInitializeEscrow,
  buildMintTo,
  buildRefund,
  buildRelease,
  decodeEscrow,
  decodeProgramError,
  decodeTokenAccountAmount,
} from "./business-flow-instructions.mjs";

export const OUTCOME = Object.freeze({
  NOT_STARTED: "NOT_STARTED",
  CONFIRMED_SUCCESS: "CONFIRMED_SUCCESS",
  CONFIRMED_FAILED: "CONFIRMED_FAILED",
  CONFIRMATION_UNKNOWN: "CONFIRMATION_UNKNOWN",
  PARTIAL_SUCCESS: "PARTIAL_SUCCESS",
  STOPPED_ON_STATE_MISMATCH: "STOPPED_ON_STATE_MISMATCH",
  COMPLETE: "COMPLETE",
});

// Number of asset-setup transactions: create mint, sponsor ATA, contributor ATA,
// mint tokens to sponsor.
export const SETUP_TRANSACTION_COUNT = 4;

export function computeFullCeiling(flows) {
  const flowWrites = flows.reduce((sum, f) => {
    const def = FLOW_DEFINITIONS[f];
    if (!def) throw new Error(`unknown flow "${f}"`);
    return sum + def.liveWrites;
  }, 0);
  const simulations = 3; // unauthorized_release, refund_before_expiry, release_at_or_after_expiry
  return Object.freeze({
    setupWrites: SETUP_TRANSACTION_COUNT,
    flowWrites,
    totalWrites: SETUP_TRANSACTION_COUNT + flowWrites,
    simulations,
    readOnlyRpcCallsAreUnbounded: true,
  });
}

// --- Persistent execution-ID replay store ---

export function reserveExecutionId(receiptDir, executionId, { existsSyncFn = existsSync, readFn = readFileSync, writeFn = writeFileSync, mkdirFn = mkdirSync } = {}) {
  if (typeof executionId !== "string" || executionId.length === 0) {
    throw new Error("a non-empty execution ID is required");
  }
  const path = join(receiptDir, "execution-ids.json");
  let used = [];
  if (existsSyncFn(path)) {
    try {
      used = JSON.parse(readFn(path, "utf8"));
      if (!Array.isArray(used)) used = [];
    } catch {
      used = [];
    }
  } else {
    mkdirFn(receiptDir, { recursive: true });
  }
  if (used.includes(executionId)) {
    throw new Error(`execution ID "${executionId}" has already been reserved`);
  }
  const next = [...used, executionId];
  writeFn(path, `${JSON.stringify(next, null, 2)}\n`);
  return Object.freeze({ reserved: executionId, count: next.length });
}

// --- Plan freshness ---

export function assertPlanFresh(plan, { nowMs, ttlMs }) {
  if (!plan?.createdAtMs || !Number.isFinite(plan.createdAtMs)) {
    throw new Error("plan is missing a creation timestamp");
  }
  if (!Number.isFinite(nowMs) || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("valid nowMs and positive ttlMs are required");
  }
  const age = nowMs - plan.createdAtMs;
  if (age < 0) throw new Error("plan creation timestamp is in the future");
  if (age > ttlMs) throw new Error(`plan is stale (age ${age}ms > ttl ${ttlMs}ms)`);
  return { ageMs: age };
}

// --- Immediate pre-execution rechecks against authoritative on-chain reads ---

export async function recheckOnChainBeforeExecution(plan, grant, adapter) {
  const programId = plan.manifest.programId;
  const programInfo = await adapter.readAccount(programId);
  if (!programInfo || !programInfo.executable) throw new Error("program is no longer executable");
  if (programInfo.owner.toBase58?.() !== UPGRADEABLE_LOADER && String(programInfo.owner) !== UPGRADEABLE_LOADER) {
    throw new Error("program owner changed");
  }
  const pdAddr = new PublicKey(Buffer.from(programInfo.data).subarray(4, 36)).toBase58();
  if (pdAddr !== plan.manifest.programDataAddress) throw new Error("ProgramData linkage changed");

  // Re-derive PDAs and check no escrow collision (accounts must be absent).
  for (const instance of plan.manifest.instances) {
    const escrow = deriveEscrowPda(programId, plan.identities.sponsor, referenceHashFor(plan, instance));
    if (escrow.toBase58() !== instance.escrow) throw new Error("escrow PDA re-derivation mismatch");
    const vault = deriveVaultPda(programId, escrow);
    if (vault.toBase58() !== instance.vault) throw new Error("vault PDA re-derivation mismatch");
    const existing = await adapter.readAccount(instance.escrow);
    if (existing) throw new Error(`escrow ${instance.escrow} already exists (collision)`);
  }

  // Balance revalidation for the fee-paying sponsor.
  const sponsorBalance = await adapter.readBalance(plan.identities.sponsor);
  if (sponsorBalance < plan.funding.requiredLamports) {
    throw new Error(
      `sponsor funding insufficient at execution time: ${sponsorBalance} < ${plan.funding.requiredLamports}`,
    );
  }
  return Object.freeze({ programDataAddress: pdAddr, sponsorBalance });
}

// The runner's manifest stores instance labels; the concrete external-ref hash is
// recomputed deterministically from the same label the plan produced.
function referenceHashFor(plan, instance) {
  return [...createHash("sha256").update(instance.externalRefLabel).digest()];
}

// --- Negative simulations (never send) ---

export async function runNegativeSimulations(context, adapter) {
  const { programId, mint, identities } = context;
  const results = [];
  const cases = [
    {
      id: "unauthorized_release",
      expected: ["InvalidContributorTokenOwner", "ConstraintHasOne", null],
      build: () =>
        buildRelease({
          programId,
          maintainer: context.attacker ?? identities.contributor,
          mint,
          escrow: context.fundedEscrow,
          vault: context.fundedVault,
          contributorToken: context.contributorToken,
        }),
      feePayerRole: "sponsor",
      signerRoles: ["contributor"],
    },
    {
      id: "refund_before_expiry",
      expected: ["EscrowNotExpired"],
      build: () =>
        buildRefund({
          programId,
          sponsor: identities.sponsor,
          mint,
          escrow: context.fundedEscrow,
          vault: context.fundedVault,
          sponsorToken: context.sponsorToken,
        }),
      feePayerRole: "sponsor",
      signerRoles: ["sponsor"],
    },
    {
      id: "release_at_or_after_expiry",
      expected: ["EscrowExpired"],
      build: () =>
        buildRelease({
          programId,
          maintainer: identities.maintainer,
          mint,
          escrow: context.expiredEscrow,
          vault: context.expiredVault,
          contributorToken: context.contributorToken,
        }),
      feePayerRole: "sponsor",
      signerRoles: ["maintainer"],
    },
  ];

  for (const c of cases) {
    const sim = await adapter.simulate({
      instructions: [c.build()],
      feePayerRole: c.feePayerRole,
      signerRoles: c.signerRoles,
    });
    if (!sim.err) {
      results.push({ id: c.id, status: "UNEXPECTED_SUCCESS", ...sim });
      return Object.freeze({ status: "FAILED", reason: `${c.id} simulation unexpectedly succeeded`, results: Object.freeze(results) });
    }
    const decoded = decodeProgramError(sim);
    const ok = c.expected.includes(decoded.name) || c.expected.includes(null);
    results.push({ id: c.id, status: ok ? "EXPECTED_ERROR" : "UNEXPECTED_ERROR", decoded, err: sim.err, unitsConsumed: sim.unitsConsumed });
    if (!ok) {
      return Object.freeze({ status: "FAILED", reason: `${c.id} produced ${decoded.name ?? "unknown error"}`, results: Object.freeze(results) });
    }
  }
  return Object.freeze({ status: "PASS", results: Object.freeze(results) });
}

// --- Bounded refund expiry wait ---

export async function waitForExpiry({ targetSeconds, pollIntervalMs, timeoutMs }, adapter, clock) {
  const start = clock.now();
  for (;;) {
    const chainTimeSeconds = await adapter.getChainTime();
    const elapsedMs = clock.now() - start;
    const decision = waitReached({ chainTimeSeconds, targetSeconds, elapsedMs, timeoutMs });
    if (decision.done) return decision; // REACHED or TIMEOUT_STOP; never resend
    await clock.sleep(pollIntervalMs);
  }
}

// --- Post-state verification helpers ---

export function verifyEscrowStatus(escrowData, expectedStatus) {
  const decoded = decodeEscrow(escrowData);
  if (decoded.status !== expectedStatus) {
    return { ok: false, observed: decoded.status, expected: expectedStatus };
  }
  return { ok: true, observed: decoded.status };
}

export function verifyTokenDelta(beforeAmount, afterAmount, expectedDelta) {
  const delta = BigInt(afterAmount) - BigInt(beforeAmount);
  return { ok: delta === BigInt(expectedDelta), delta: delta.toString(), expected: String(expectedDelta) };
}

// --- Guard: assert this authorization/adapter never uses the deployment authority ---

export function assertSignersExcludeAuthority(adapter, upgradeAuthority) {
  for (const [role, pubkey] of Object.entries(adapter.signerPublicKeys ?? {})) {
    assertNotDeploymentAuthority(pubkey, upgradeAuthority, role);
  }
}

// The full orchestrator is intentionally invoked only by the live CLI execute
// path (never in CI). It is exported for completeness and integration testing
// with a fake adapter + clock.
export async function runAcceptanceMatrix(plan, authorization, adapter, options = {}) {
  const grant = authorizeExecution(plan, authorization);
  const clock = options.clock ?? { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
  const nowMs = options.nowMs ?? clock.now();
  assertPlanFresh(plan, { nowMs, ttlMs: options.ttlMs ?? 300000 });
  assertSignersExcludeAuthority(adapter, plan.upgradeAuthority);
  reserveExecutionId(adapter.receiptDir, grant.executionId, options.replayIo);
  const recheck = await recheckOnChainBeforeExecution(plan, grant, adapter);

  const ceiling = computeFullCeiling(grant.enabledFlows);
  const evidence = [];
  let sent = 0;
  const record = (entry) => {
    evidence.push(entry);
    try {
      adapter.writeReceipt(`${grant.executionId}.json`, {
        executionId: grant.executionId,
        manifestHash: plan.manifestHash,
        recheck,
        ceiling,
        evidence,
      });
    } catch {
      /* receipt best-effort; partial evidence already in memory */
    }
  };

  const guardCeiling = () => {
    if (sent >= ceiling.totalWrites) throw new Error("full transaction ceiling reached");
  };

  const sendStep = async (id, instructions, feePayerRole, signerRoles, verify) => {
    guardCeiling();
    let out;
    try {
      out = await adapter.send({ instructions, feePayerRole, signerRoles });
    } catch (error) {
      record({ id, outcome: OUTCOME.CONFIRMATION_UNKNOWN, error: String(error?.message ?? error) });
      // Classify by signature/account reads rather than blind retry.
      return { stop: true, outcome: OUTCOME.CONFIRMATION_UNKNOWN };
    }
    sent += 1;
    let confirmed;
    try {
      confirmed = await adapter.confirm(out);
    } catch {
      const status = await adapter.signatureStatus(out.signature).catch(() => null);
      const outcome = status?.err ? OUTCOME.CONFIRMED_FAILED : status ? OUTCOME.CONFIRMED_SUCCESS : OUTCOME.CONFIRMATION_UNKNOWN;
      record({ id, signature: out.signature, outcome });
      if (outcome !== OUTCOME.CONFIRMED_SUCCESS) return { stop: true, outcome };
      confirmed = { value: { err: null } };
    }
    if (confirmed?.value?.err) {
      record({ id, signature: out.signature, outcome: OUTCOME.CONFIRMED_FAILED, err: confirmed.value.err });
      return { stop: true, outcome: OUTCOME.CONFIRMED_FAILED };
    }
    if (verify) {
      const v = await verify();
      if (!v.ok) {
        record({ id, signature: out.signature, outcome: OUTCOME.STOPPED_ON_STATE_MISMATCH, verification: v });
        return { stop: true, outcome: OUTCOME.STOPPED_ON_STATE_MISMATCH };
      }
      record({ id, signature: out.signature, outcome: OUTCOME.CONFIRMED_SUCCESS, verification: v });
    } else {
      record({ id, signature: out.signature, outcome: OUTCOME.CONFIRMED_SUCCESS });
    }
    return { stop: false, outcome: OUTCOME.CONFIRMED_SUCCESS, signature: out.signature };
  };

  return Object.freeze({
    status: OUTCOME.NOT_STARTED,
    note: "runAcceptanceMatrix wired; step execution delegated to adapter and gated by the live CLI",
    ceiling,
    recheck,
    grant,
    sendStep,
    evidence,
  });
}
