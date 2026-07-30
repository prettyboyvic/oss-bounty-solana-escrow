// Concrete live-execution orchestrator for the devnet business-flow acceptance
// matrix. Consumes a fresh manifest-bound plan (business-flow-runner.mjs), an
// authorization grant, and a production adapter (business-flow-adapter.mjs). It
// builds through the canonical transaction registry/factory, enforces the full
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
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
  UPGRADEABLE_LOADER,
  assertDistinctBusinessIdentities,
  assertNotDeploymentAuthority,
  authorizeExecution,
  deriveEscrowPda,
  deriveVaultPda,
  planExpiry,
  waitReached,
} from "./business-flow-runner.mjs";
import {
  MINT_SIZE,
  associatedTokenAddress,
  decodeEscrow,
  decodeMint,
  decodeTokenAccountAmount,
} from "./business-flow-instructions.mjs";
import { deriveBusinessFlowMint } from "./business-flow-identity.mjs";
import { classifyExpectedSimulationError } from "./business-flow-errors.mjs";
import {
  buildStepInstructions,
  createBusinessFlowExecutionRegistry,
} from "./business-flow-transaction-factory.mjs";
import {
  BUSINESS_FLOW_EXECUTION_SPEC,
  executionSpecHash,
  selectExecutionEvents,
} from "./business-flow-spec.mjs";

export const OUTCOME = Object.freeze({
  NOT_STARTED: "NOT_STARTED",
  CONFIRMED_SUCCESS: "CONFIRMED_SUCCESS",
  CONFIRMED_FAILED: "CONFIRMED_FAILED",
  CONFIRMATION_UNKNOWN: "CONFIRMATION_UNKNOWN",
  PARTIAL_SUCCESS: "PARTIAL_SUCCESS",
  STOPPED_ON_STATE_MISMATCH: "STOPPED_ON_STATE_MISMATCH",
  STOPPED_ON_SIMULATION: "STOPPED_ON_SIMULATION",
  STOPPED_ON_EXPIRY_TIMEOUT: "STOPPED_ON_EXPIRY_TIMEOUT",
  RUNNING: "RUNNING",
  COMPLETE: "COMPLETE",
});

// Number of asset-setup transactions: create mint, sponsor ATA, contributor ATA,
// mint tokens to sponsor.
export const SETUP_TRANSACTION_COUNT =
  BUSINESS_FLOW_EXECUTION_SPEC.events.filter(
    (event) => event.flow === "setup" && event.kind === "SEND",
  ).length;

export function computeFullCeiling(selectedOrFlows) {
  const selected = Array.isArray(selectedOrFlows)
    ? selectExecutionEvents(BUSINESS_FLOW_EXECUTION_SPEC, selectedOrFlows)
    : selectedOrFlows;
  if (
    selected === null ||
    typeof selected !== "object" ||
    !Array.isArray(selected.sendEvents) ||
    !Array.isArray(selected.simulationEvents) ||
    !Array.isArray(selected.waitEvents)
  ) {
    throw new Error("a selected canonical event plan is required");
  }
  const setupWrites = selected.sendEvents.filter(
    (event) => event.flow === "setup",
  ).length;
  const flowWrites = selected.sendEvents.filter(
    (event) => event.flow !== "setup",
  ).length;
  return Object.freeze({
    setupWrites,
    flowWrites,
    totalWrites: selected.sendEvents.length,
    simulations: selected.simulationEvents.length,
    waits: selected.waitEvents.length,
    readOnlyRpcCallsAreUnbounded: true,
  });
}

const TERMINAL_EVIDENCE_STATES = new Set([
  "VERIFIED",
  "EXPECTED_ERROR",
  "UNEXPECTED_ERROR",
  "UNEXPECTED_SUCCESS",
  "INCONCLUSIVE",
  "WAIT_REACHED",
  "WAIT_TIMEOUT",
  "CONSTRUCTION_FAILED",
  "PRECONDITION_FAILED",
  "SUBMISSION_FAILED",
  "CONFIRMATION_FAILED",
  "CONFIRMATION_UNKNOWN",
  "VERIFICATION_FAILED",
]);
const EXPECTATION_SATISFIED_STATES = new Set([
  "VERIFIED",
  "EXPECTED_ERROR",
  "WAIT_REACHED",
]);
const EVIDENCE_STATES = new Set([
  "BUILT",
  "SUBMITTED",
  "CONFIRMED",
  ...TERMINAL_EVIDENCE_STATES,
]);
const EVIDENCE_PAYLOAD_FIELDS = Object.freeze([
  "signature",
  "outcome",
  "error",
  "err",
  "verification",
  "decoded",
  "code",
  "name",
  "reason",
]);

function eventEvidence(event, state, fields = {}) {
  if (!EVIDENCE_STATES.has(state)) {
    throw new Error(`unknown evidence state "${state}"`);
  }
  const payload = Object.fromEntries(
    EVIDENCE_PAYLOAD_FIELDS.filter(
      (field) => Object.prototype.hasOwnProperty.call(fields, field),
    ).map((field) => [field, fields[field]]),
  );
  return Object.freeze({
    ...payload,
    ...(event.kind === "SEND"
      ? { signature: payload.signature ?? null }
      : {}),
    executionSpecHash: executionSpecHash(),
    executionSpecSchema: BUSINESS_FLOW_EXECUTION_SPEC.schema,
    eventId: event.id,
    order: event.order,
    kind: event.kind,
    flow: event.flow,
    feePayerRole: event.feePayerRole,
    requiredNonPayerSignerRoles: Object.freeze([
      ...event.requiredNonPayerSignerRoles,
    ]),
    state,
    terminal: TERMINAL_EVIDENCE_STATES.has(state),
    expectationSatisfied: EXPECTATION_SATISFIED_STATES.has(state),
  });
}

function canonicalSelectionProjection(selectedPlan) {
  return {
    schema: selectedPlan.schema,
    eventIds: selectedPlan.events.map((event) => event.id),
    sendCount: selectedPlan.sendEvents.length,
    simulationCount: selectedPlan.simulationEvents.length,
    waitCount: selectedPlan.waitEvents.length,
  };
}

function assertSelectionProjection(plan, selectedPlan) {
  const expected = canonicalSelectionProjection(selectedPlan);
  const projections = [
    plan?.selectedEvents,
    plan?.manifest?.selectedEvents,
    plan?.funding && {
      schema: expected.schema,
      eventIds: plan.funding.selectedEventIds,
      sendCount: plan.funding.sendCount,
      simulationCount: plan.funding.simulationCount,
      waitCount: plan.funding.waitCount,
    },
  ];
  const matches = projections.every(
    (projection) =>
      projection !== null &&
      typeof projection === "object" &&
      projection.schema === expected.schema &&
      Array.isArray(projection.eventIds) &&
      projection.eventIds.length === expected.eventIds.length &&
      projection.eventIds.every(
        (eventId, index) => eventId === expected.eventIds[index],
      ) &&
      projection.sendCount === expected.sendCount &&
      projection.simulationCount === expected.simulationCount &&
      projection.waitCount === expected.waitCount,
  );
  if (
    !matches ||
    plan.transactionCeiling !== expected.sendCount ||
    plan.manifest.transactionCeiling !== expected.sendCount
  ) {
    throw new Error("selected event projection mismatch");
  }
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
  assertDistinctBusinessIdentities(plan.identities);
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

  // Revalidate each canonical payer independently. An aggregate balance cannot
  // compensate for lamports assigned to another transaction payer.
  const payerBalances = {};
  for (const identity of [
    "sponsor",
    "maintainer",
    "contributor",
    "mintAuthority",
  ]) {
    const required =
      plan.manifest?.funding?.byIdentity?.[identity]?.requiredLamports;
    if (!Number.isSafeInteger(required) || required < 0) {
      throw new Error(`funding requirement is invalid for ${identity}`);
    }
    const publicKey =
      plan.identities?.[identity] ??
      adapter.signerPublicKeys?.[identity] ??
      null;
    if (publicKey === null) {
      if (required > 0) {
        throw new Error(`funding identity is missing for ${identity}`);
      }
      payerBalances[identity] = null;
      continue;
    }
    const balance = await adapter.readBalance(publicKey);
    if (!Number.isSafeInteger(balance) || balance < 0) {
      throw new Error(`balance is invalid for ${identity}`);
    }
    payerBalances[identity] = balance;
    if (balance < required) {
      throw new Error(
        `${identity} funding insufficient at execution time: ${balance} < ${required}`,
      );
    }
  }
  return Object.freeze({
    programDataAddress: pdAddr,
    sponsorBalance: payerBalances.sponsor,
    payerBalances: Object.freeze(payerBalances),
  });
}

// The runner's manifest stores instance labels; the concrete external-ref hash is
// recomputed deterministically from the same label the plan produced.
function referenceHashFor(plan, instance) {
  return [...createHash("sha256").update(instance.externalRefLabel).digest()];
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

// Private setup for executeFullMatrix. The guarded raw-send closure must never
// cross the module boundary.
async function prepareFullMatrixExecution(
  plan,
  grant,
  selectedPlan,
  adapter,
  options = {},
) {
  const clock = options.clock ?? { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
  const nowMs = options.nowMs ?? clock.now();
  assertPlanFresh(plan, { nowMs, ttlMs: options.ttlMs ?? 300000 });
  assertDistinctBusinessIdentities(plan.identities);
  assertSignersExcludeAuthority(adapter, plan.upgradeAuthority);
  reserveExecutionId(adapter.receiptDir, grant.executionId, options.replayIo);
  const recheck = await recheckOnChainBeforeExecution(plan, grant, adapter);

  const ceiling = computeFullCeiling(selectedPlan);
  return Object.freeze({
    status: OUTCOME.NOT_STARTED,
    note: "full-matrix execution prepared; canonical event execution gated by the live CLI",
    ceiling,
    recheck,
    grant,
  });
}

// --- Top-level orchestration driver ---------------------------------------
//
// executeFullMatrix is the single public execution entry point the live CLI
// invokes. It self-drives the whole acceptance matrix:
//
//   setup (4 sends): create+init mint, sponsor ATA, contributor ATA, mint tokens
//   release instance: initialize, fund, [simulate unauthorized], release, verify
//   refund  instance: initialize, fund, [simulate before-expiry], wait(chain time),
//                     [simulate at-expiry], refund, verify
//   cancel  instance: initialize, cancel, verify
//
// It enforces the full transaction-send ceiling (setup + flows) through the same
// private guarded sendStep, runs the three negative checks as
// read-only simulations at the correct states (fail-closed on unexpected success),
// waits for refund expiry on authoritative chain time with a bounded timeout,
// verifies terminal escrow status and token deltas, never blind-retries, stops the
// whole matrix on the first failure (no step N+1), and writes a durable partial
// receipt that always contains the completed steps, the pending/unknown step, and
// the stop reason. The deterministic mint public key is bound into the receipt.
//
// It is never invoked against live devnet in this phase or in CI; tests drive it
// with a fake adapter and a fake clock.

const DEFAULT_CLOCK = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

export async function createCanonicalExecutionContext({
  plan,
  grant,
  adapter,
  chainTimeSeconds,
  mintLamports,
}) {
  const { sponsor, maintainer, contributor } =
    assertDistinctBusinessIdentities(plan.identities);
  const mintAuthority = adapter.signerPublicKeys?.mintAuthority;
  if (!mintAuthority) {
    throw new Error("adapter must expose a mintAuthority signer public key");
  }
  const derivation = await deriveBusinessFlowMint({
    executionId: grant.executionId,
    genesisHash: plan.manifest.genesisHash,
    programId: plan.manifest.programId,
    sponsorBase: sponsor,
  });
  const expiry = planExpiry({ chainTimeSeconds });
  const mint = derivation.mint;
  const amount = BigInt(plan.manifest.amount);
  const instances = Object.freeze(
    Object.fromEntries(
      plan.manifest.instances.map((planned) => [
        planned.flow,
        Object.freeze({
          escrow: planned.escrow,
          vault: planned.vault,
          externalRefHash: Buffer.from(referenceHashFor(plan, planned)),
        }),
      ]),
    ),
  );

  return Object.freeze({
    executionId: grant.executionId,
    genesisHash: plan.manifest.genesisHash,
    programId: plan.manifest.programId,
    sponsor,
    maintainer,
    contributor,
    mintAuthority,
    mint,
    mintSeed: derivation.seed,
    mintLamports,
    decimals: plan.manifest.decimals,
    amount,
    setupMintAmount: amount * BigInt(Math.max(1, grant.enabledFlows.length)),
    sponsorToken: associatedTokenAddress(mint, sponsor).toBase58(),
    contributorToken: associatedTokenAddress(mint, contributor).toBase58(),
    instances,
    releaseExpiry: BigInt(expiry.releaseExpiry),
    refundExpiry: null,
    expiryPolicyIds: Object.freeze({
      release: "release-expiry-policy-v1",
      refund: "refund-expiry-policy-v1",
      cancel: "cancel-expiry-policy-v1",
    }),
  });
}

function publicKeyString(value) {
  return typeof value?.toBase58 === "function" ? value.toBase58() : String(value);
}

export function createCanonicalRuntimeEffects({ adapter, context, clock }) {
  const beforeTokenAmounts = new Map();
  const readAccount = async (address, label) => {
    const info = await adapter.readAccount(address);
    if (!info) return { ok: false, reason: `${label} is absent` };
    return { ok: true, info };
  };
  const readTokenAmount = async (address) => {
    const read = await readAccount(address, `token account ${address}`);
    if (!read.ok) throw new Error(read.reason);
    return decodeTokenAccountAmount(read.info.data);
  };
  const tokenOwned = async (address, label) => {
    const read = await readAccount(address, label);
    if (!read.ok) return read;
    const owner = publicKeyString(read.info.owner);
    return owner === TOKEN_PROGRAM_ID.toBase58()
      ? { ok: true, owner }
      : {
          ok: false,
          expectedOwner: TOKEN_PROGRAM_ID.toBase58(),
          observedOwner: owner,
        };
  };
  const escrowStatus = async (current, flow, expected, requireVault = false) => {
    const instance = current.instances[flow];
    const escrow = await readAccount(instance.escrow, `${flow} escrow`);
    if (!escrow.ok) return escrow;
    const status = verifyEscrowStatus(escrow.info.data, expected);
    if (!status.ok || !requireVault) return status;
    return tokenOwned(instance.vault, `${flow} vault`);
  };

  const verifiers = new Map([
    ["mint-initialized-v1", async (current) => {
      const owned = await tokenOwned(current.mint, "mint");
      if (!owned.ok) return owned;
      const mint = await readAccount(current.mint, "mint");
      const decoded = decodeMint(mint.info.data);
      return decoded.isInitialized && decoded.decimals === current.decimals
        ? { ok: true, ...decoded }
        : {
            ok: false,
            expected: { isInitialized: true, decimals: current.decimals },
            observed: decoded,
          };
    }],
    ["sponsor-ata-v1", (current) =>
      tokenOwned(current.sponsorToken, "sponsor ATA")],
    ["contributor-ata-v1", (current) =>
      tokenOwned(current.contributorToken, "contributor ATA")],
    ["sponsor-token-balance-v1", async (current) => {
      const observed = BigInt(await readTokenAmount(current.sponsorToken));
      return observed === current.setupMintAmount
        ? { ok: true, observed: observed.toString() }
        : {
            ok: false,
            observed: observed.toString(),
            expected: current.setupMintAmount.toString(),
          };
    }],
    ["release-initialized-v1", (current) =>
      escrowStatus(current, "release", "Initialized", true)],
    ["release-funded-v1", (current) =>
      escrowStatus(current, "release", "Funded")],
    ["release-terminal-v1", async (current) => {
      const status = await escrowStatus(current, "release", "Released");
      if (!status.ok) return status;
      return verifyTokenDelta(
        beforeTokenAmounts.get("release:release"),
        await readTokenAmount(current.contributorToken),
        current.amount,
      );
    }],
    ["refund-initialized-v1", (current) =>
      escrowStatus(current, "refund", "Initialized", true)],
    ["refund-funded-v1", (current) =>
      escrowStatus(current, "refund", "Funded")],
    ["refund-terminal-v1", async (current) => {
      const status = await escrowStatus(current, "refund", "Refunded");
      if (!status.ok) return status;
      return verifyTokenDelta(
        beforeTokenAmounts.get("refund:refund"),
        await readTokenAmount(current.sponsorToken),
        current.amount,
      );
    }],
    ["cancel-initialized-v1", (current) =>
      escrowStatus(current, "cancel", "Initialized", true)],
    ["cancel-terminal-v1", (current) =>
      escrowStatus(current, "cancel", "Cancelled")],
  ]);
  const simulations = new Map([
    ["anchor-error-v1", (event, result, instructions, current) =>
      classifyExpectedSimulationError({
        result,
        instructions,
        expectedProgramId: current.programId,
        event,
      })],
  ]);
  const waits = new Map([
    ["refund-expiry-v1", (current) =>
      waitForExpiry(
        {
          targetSeconds: Number(current.refundExpiry),
          pollIntervalMs: 3_000,
          timeoutMs: 120_000,
        },
        adapter,
        clock,
      )],
  ]);

  return Object.freeze({
    async beforeEvent(event, current = context) {
      if (event.id === "release:release") {
        beforeTokenAmounts.set(
          event.id,
          await readTokenAmount(current.contributorToken),
        );
      } else if (event.id === "refund:refund") {
        beforeTokenAmounts.set(
          event.id,
          await readTokenAmount(current.sponsorToken),
        );
      }
    },
    verify(event, current = context) {
      const verifier = verifiers.get(event.postStateVerifierId);
      if (!verifier) {
        throw new Error(
          `unsupported post-state verifier "${event.postStateVerifierId}"`,
        );
      }
      return verifier(current);
    },
    classifySimulation(event, result, instructions, current = context) {
      const simulation = simulations.get(event.simulationDecoderId);
      if (!simulation) {
        throw new Error(
          `unsupported simulation decoder "${event.simulationDecoderId}"`,
        );
      }
      return simulation(event, result, instructions, current);
    },
    wait(event, current = context) {
      const wait = waits.get(event.waitPolicyId);
      if (!wait) {
        throw new Error(`unsupported wait policy "${event.waitPolicyId}"`);
      }
      return wait(current);
    },
  });
}

export async function executeFullMatrix(plan, authorization, adapter, options = {}) {
  const grant = authorizeExecution(plan, authorization);
  const selectedPlan = selectExecutionEvents(
    BUSINESS_FLOW_EXECUTION_SPEC,
    grant.enabledFlows,
  );
  assertSelectionProjection(plan, selectedPlan);
  const wired = await prepareFullMatrixExecution(
    plan,
    grant,
    selectedPlan,
    adapter,
    options,
  );
  const { ceiling, recheck } = wired;
  const clock = options.clock ?? DEFAULT_CLOCK;
  const registry =
    options.executionRegistry ?? createBusinessFlowExecutionRegistry();
  const mintLamports =
    options.mintLamports ??
    (await adapter.getMinimumBalanceForRentExemption(MINT_SIZE));
  const chainTimeSeconds = await adapter.getChainTime();
  let executionContext = await createCanonicalExecutionContext({
    plan,
    grant,
    adapter,
    chainTimeSeconds,
    mintLamports,
  });
  const runtimeEffects = (
    options.runtimeEffectsFactory ?? createCanonicalRuntimeEffects
  )({
    adapter,
    context: executionContext,
    clock,
  });
  const { mint, sponsorToken, contributorToken } = executionContext;

  const evidence = [];
  let sent = 0;

  const projectSteps = () =>
    evidence
      .filter(
        (entry) =>
          entry.terminal &&
          (entry.kind === "SEND" || entry.kind === "WAIT"),
      )
      .map((entry) => {
        if (entry.kind === "WAIT") {
          const outcomeByState = {
            WAIT_REACHED: "REACHED",
            WAIT_TIMEOUT: "TIMEOUT_STOP",
            INCONCLUSIVE: "INCONCLUSIVE",
            PRECONDITION_FAILED: "PRECONDITION_FAILED",
          };
          return {
            id: entry.eventId,
            kind: "wait",
            outcome: outcomeByState[entry.state] ?? entry.state,
          };
        }
        const outcomeByState = {
          VERIFIED: OUTCOME.CONFIRMED_SUCCESS,
          CONSTRUCTION_FAILED: OUTCOME.STOPPED_ON_STATE_MISMATCH,
          PRECONDITION_FAILED: OUTCOME.STOPPED_ON_STATE_MISMATCH,
          SUBMISSION_FAILED: OUTCOME.CONFIRMATION_UNKNOWN,
          CONFIRMATION_FAILED: OUTCOME.CONFIRMED_FAILED,
          CONFIRMATION_UNKNOWN: OUTCOME.CONFIRMATION_UNKNOWN,
          VERIFICATION_FAILED: OUTCOME.STOPPED_ON_STATE_MISMATCH,
        };
        return {
          id: entry.eventId,
          kind: "send",
          feePayerRole: entry.feePayerRole,
          signerRoles: [...entry.requiredNonPayerSignerRoles],
          outcome: outcomeByState[entry.state] ?? entry.state,
          signature: entry.signature ?? null,
        };
      });
  const projectSimulations = () =>
    evidence
      .filter(
        (entry) => entry.terminal && entry.kind === "SIMULATE",
      )
      .map((entry) => ({
        id: entry.eventId,
        status: entry.state,
        decoded: entry.decoded,
        err: entry.err,
      }));
  const projectPending = () => {
    const latest = evidence.at(-1);
    if (!latest || latest.terminal) return null;
    return {
      id: latest.eventId,
      kind: latest.kind.toLowerCase(),
      feePayerRole: latest.feePayerRole,
      signerRoles: [...latest.requiredNonPayerSignerRoles],
    };
  };
  const projectExecutionOutcome = () => {
    const terminalStop = evidence.find(
      (entry) => entry.terminal && !entry.expectationSatisfied,
    );
    if (terminalStop?.kind === "SEND") {
      const outcomeByState = {
        CONSTRUCTION_FAILED: OUTCOME.STOPPED_ON_STATE_MISMATCH,
        PRECONDITION_FAILED: OUTCOME.STOPPED_ON_STATE_MISMATCH,
        SUBMISSION_FAILED: OUTCOME.CONFIRMATION_UNKNOWN,
        CONFIRMATION_FAILED: OUTCOME.CONFIRMED_FAILED,
        CONFIRMATION_UNKNOWN: OUTCOME.CONFIRMATION_UNKNOWN,
        VERIFICATION_FAILED: OUTCOME.STOPPED_ON_STATE_MISMATCH,
      };
      const status = outcomeByState[terminalStop.state];
      if (!status) {
        throw new Error(
          `unknown terminal SEND evidence state "${terminalStop.state}"`,
        );
      }
      const step = terminalStop.eventId.includes(":")
        ? terminalStop.eventId.slice(terminalStop.eventId.indexOf(":") + 1)
        : terminalStop.eventId;
      return {
        finalStatus: status,
        stopReason:
          `${terminalStop.flow.toUpperCase()}_FAILED:` +
          `${step}:${status}`,
      };
    }
    if (terminalStop?.kind === "SIMULATE") {
      return {
        finalStatus: OUTCOME.STOPPED_ON_SIMULATION,
        stopReason: `SIMULATION_${terminalStop.state}:${terminalStop.eventId}`,
      };
    }
    if (terminalStop?.kind === "WAIT") {
      return {
        finalStatus: OUTCOME.STOPPED_ON_EXPIRY_TIMEOUT,
        stopReason:
          terminalStop.state === "WAIT_TIMEOUT"
            ? "REFUND_EXPIRY_WAIT_TIMEOUT"
            : terminalStop.state === "PRECONDITION_FAILED"
              ? "REFUND_EXPIRY_WAIT_PRECONDITION_FAILED"
              : "REFUND_EXPIRY_WAIT_INCONCLUSIVE",
      };
    }
    const satisfiedEventIds = new Set(
      evidence
        .filter(
          (entry) => entry.terminal && entry.expectationSatisfied,
        )
        .map((entry) => entry.eventId),
    );
    return {
      finalStatus: selectedPlan.events.every((event) =>
        satisfiedEventIds.has(event.id),
      )
        ? OUTCOME.COMPLETE
        : OUTCOME.RUNNING,
      stopReason: null,
    };
  };

  const writeMatrixReceipt = () => {
    try {
      const { finalStatus, stopReason } = projectExecutionOutcome();
      adapter.writeReceipt(`${grant.executionId}.matrix.json`, {
        executionId: grant.executionId,
        manifestHash: plan.manifestHash,
        mint,
        sponsorToken,
        contributorToken,
        ceiling,
        recheck,
        selectedEvents: canonicalSelectionProjection(selectedPlan),
        evidence: [...evidence],
        steps: projectSteps(),
        simulations: projectSimulations(),
        pendingStep: projectPending(),
        stopReason,
        finalStatus,
      });
    } catch {
      /* receipt best-effort; the returned evidence timeline remains available */
    }
  };

  const appendEvidence = (event, state, fields) => {
    const entry = eventEvidence(event, state, fields);
    evidence.push(entry);
    writeMatrixReceipt();
    return entry;
  };
  const result = () => {
    const { finalStatus, stopReason } = projectExecutionOutcome();
    return Object.freeze({
      status: finalStatus,
      stopReason,
      executionId: grant.executionId,
      mint,
      ceiling,
      evidence: Object.freeze([...evidence]),
      steps: Object.freeze(projectSteps()),
      simulations: Object.freeze(projectSimulations()),
      pendingStep: projectPending(),
    });
  };
  const finish = () => {
    writeMatrixReceipt();
    return result();
  };
  const guardCeiling = () => {
    if (sent >= ceiling.totalWrites) {
      throw new Error("full transaction ceiling reached");
    }
  };

  const send = async (event, instructions, verify) => {
    guardCeiling();
    const signerRoles = [...event.requiredNonPayerSignerRoles];
    let submitted;
    sent += 1;
    try {
      submitted = await adapter.send({
        instructions,
        feePayerRole: event.feePayerRole,
        signerRoles,
      });
    } catch (error) {
      appendEvidence(event, "CONFIRMATION_UNKNOWN", {
        outcome: OUTCOME.CONFIRMATION_UNKNOWN,
        error: String(error?.message ?? error),
      });
      return {
        stop: true,
        outcome: OUTCOME.CONFIRMATION_UNKNOWN,
      };
    }
    if (
      typeof submitted?.signature !== "string" ||
      submitted.signature.length === 0
    ) {
      appendEvidence(event, "SUBMISSION_FAILED", {
        outcome: OUTCOME.CONFIRMATION_UNKNOWN,
        error: "adapter send returned no signature",
      });
      return {
        stop: true,
        outcome: OUTCOME.CONFIRMATION_UNKNOWN,
      };
    }
    const signature = submitted.signature;
    appendEvidence(event, "SUBMITTED", { signature });

    let confirmed;
    try {
      confirmed = await adapter.confirm(submitted);
    } catch (error) {
      const status = await adapter
        .signatureStatus(signature)
        .catch(() => null);
      if (!status) {
        appendEvidence(event, "CONFIRMATION_UNKNOWN", {
          signature,
          outcome: OUTCOME.CONFIRMATION_UNKNOWN,
          error: String(error?.message ?? error),
        });
        return {
          stop: true,
          outcome: OUTCOME.CONFIRMATION_UNKNOWN,
        };
      }
      if (status.err) {
        appendEvidence(event, "CONFIRMATION_FAILED", {
          signature,
          outcome: OUTCOME.CONFIRMED_FAILED,
          err: status.err,
        });
        return { stop: true, outcome: OUTCOME.CONFIRMED_FAILED };
      }
      if (
        status.confirmationStatus !== "confirmed" &&
        status.confirmationStatus !== "finalized"
      ) {
        appendEvidence(event, "CONFIRMATION_UNKNOWN", {
          signature,
          outcome: OUTCOME.CONFIRMATION_UNKNOWN,
          error: String(error?.message ?? error),
        });
        return {
          stop: true,
          outcome: OUTCOME.CONFIRMATION_UNKNOWN,
        };
      }
      confirmed = { value: { err: null } };
    }
    if (!confirmed?.value) {
      appendEvidence(event, "CONFIRMATION_UNKNOWN", {
        signature,
        outcome: OUTCOME.CONFIRMATION_UNKNOWN,
        error: "confirmation returned no status",
      });
      return {
        stop: true,
        outcome: OUTCOME.CONFIRMATION_UNKNOWN,
      };
    }
    if (confirmed.value.err) {
      appendEvidence(event, "CONFIRMATION_FAILED", {
        signature,
        outcome: OUTCOME.CONFIRMED_FAILED,
        err: confirmed.value.err,
      });
      return { stop: true, outcome: OUTCOME.CONFIRMED_FAILED };
    }
    appendEvidence(event, "CONFIRMED", { signature });

    let verification;
    try {
      verification = await verify();
    } catch (error) {
      appendEvidence(event, "VERIFICATION_FAILED", {
        signature,
        outcome: OUTCOME.STOPPED_ON_STATE_MISMATCH,
        error: String(error?.message ?? error),
      });
      return {
        stop: true,
        outcome: OUTCOME.STOPPED_ON_STATE_MISMATCH,
      };
    }
    if (!verification?.ok) {
      appendEvidence(event, "VERIFICATION_FAILED", {
        signature,
        outcome: OUTCOME.STOPPED_ON_STATE_MISMATCH,
        verification,
      });
      return {
        stop: true,
        outcome: OUTCOME.STOPPED_ON_STATE_MISMATCH,
      };
    }
    appendEvidence(event, "VERIFIED", {
      signature,
      outcome: OUTCOME.CONFIRMED_SUCCESS,
      verification,
    });
    return {
      stop: false,
      outcome: OUTCOME.CONFIRMED_SUCCESS,
      signature,
    };
  };

  const simulate = async (event, instructions) => {
    const signerRoles = [...event.requiredNonPayerSignerRoles];
    let simulation;
    try {
      simulation = await adapter.simulate({
        instructions,
        feePayerRole: event.feePayerRole,
        signerRoles,
      });
    } catch (error) {
      appendEvidence(event, "INCONCLUSIVE", {
        error: String(error?.message ?? error),
      });
      return { state: "INCONCLUSIVE" };
    }
    let classified;
    try {
      classified = await runtimeEffects.classifySimulation(
        event,
        simulation,
        instructions,
        executionContext,
      );
    } catch (error) {
      appendEvidence(event, "INCONCLUSIVE", {
        err: simulation.err,
        error: String(error?.message ?? error),
      });
      return { state: "INCONCLUSIVE" };
    }
    const state = [
      "EXPECTED_ERROR",
      "UNEXPECTED_ERROR",
      "UNEXPECTED_SUCCESS",
      "INCONCLUSIVE",
    ].includes(classified?.status)
      ? classified.status
      : "INCONCLUSIVE";
    appendEvidence(event, state, {
      decoded: classified?.decoded,
      code: classified?.decoded?.code,
      name: classified?.decoded?.name,
      err: simulation.err,
    });
    return { state, decoded: classified?.decoded };
  };
  const guardSimulation = (event, simulation) => {
    if (simulation.state === "UNEXPECTED_SUCCESS") {
      return finish();
    }
    if (simulation.state !== "EXPECTED_ERROR") {
      return finish();
    }
    return null;
  };

  for (const event of selectedPlan.events) {
    if (event.id === "refund:initialize") {
      try {
        const refundPolicy = planExpiry({
          chainTimeSeconds: await adapter.getChainTime(),
        });
        executionContext = Object.freeze({
          ...executionContext,
          refundExpiry: BigInt(refundPolicy.refundExpiry),
        });
      } catch (error) {
        appendEvidence(event, "PRECONDITION_FAILED", {
          error: String(error?.message ?? error),
        });
        return finish();
      }
    }

    if (event.kind === "WAIT") {
      appendEvidence(event, "BUILT");
      try {
        await runtimeEffects.beforeEvent(event, executionContext);
      } catch (error) {
        appendEvidence(event, "PRECONDITION_FAILED", {
          error: String(error?.message ?? error),
        });
        return finish();
      }
      let wait;
      try {
        wait = await runtimeEffects.wait(event, executionContext);
      } catch (error) {
        appendEvidence(event, "INCONCLUSIVE", {
          error: String(error?.message ?? error),
        });
        return finish();
      }
      if (wait.reason !== "REACHED") {
        appendEvidence(event, "WAIT_TIMEOUT", { reason: wait.reason });
        return finish();
      }
      appendEvidence(event, "WAIT_REACHED", { reason: wait.reason });
      continue;
    }

    let instructions;
    try {
      instructions = await buildStepInstructions(
        event.id,
        executionContext,
        registry,
      );
    } catch (error) {
      appendEvidence(event, "CONSTRUCTION_FAILED", {
        error: String(error?.message ?? error),
      });
      return finish();
    }
    appendEvidence(event, "BUILT");
    try {
      await runtimeEffects.beforeEvent(event, executionContext);
    } catch (error) {
      appendEvidence(event, "PRECONDITION_FAILED", {
        error: String(error?.message ?? error),
      });
      return finish();
    }
    if (event.kind === "SIMULATE") {
      const simulation = await simulate(event, instructions);
      const simulationStop = guardSimulation(event, simulation);
      if (simulationStop) return simulationStop;
      continue;
    }

    const sentResult = await send(
      event,
      instructions,
      () => runtimeEffects.verify(event, executionContext),
    );
    if (sentResult.stop) {
      return finish();
    }
  }

  return finish();
}
