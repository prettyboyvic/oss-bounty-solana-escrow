// Deterministic evidence-package generator for the completed canonical Solana
// devnet business-flow demonstration (execution exec-4c6cce10).
//
// Single source of truth: this module reads ONLY the immutable live receipt for
// receipt-derived facts (signatures, event states, mint, simulations) and embeds
// a fixed set of independently-verified on-chain observations (escrow/vault
// addresses, finalized statuses, per-transaction fees, slots) as declared
// constants with provenance. It performs NO network I/O and NO Date.now(), so
// its output is byte-deterministic. Every human-readable document is a pure
// projection of the machine-readable manifest, so the package cannot drift.
//
// It never reads, embeds, or emits secret key material. The full deterministic
// mint seed is intentionally withheld per the withholding policy; only the
// public mint address is published.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { canonicalJson } from "../../scripts/devnet/durable-json.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const RECEIPT_RELPATH =
  ".devnet/business-flow-receipts/exec-4c6cce10-2f17-4a51-896d-79a2569107d0.matrix.json";

// --- Immutable provenance (dual-SHA) --------------------------------------
const LIVE_EXECUTION_GIT_SHA = "e4547ea75a13ebd7ee96ef5c91bc7071017950d6";
const CURRENT_REVIEWED_GIT_SHA = "4544c3403b7acb0630d2aeb1c1388226f3187c51";
const TARGETED_REPAIR_COMMIT = "4544c3403b7acb0630d2aeb1c1388226f3187c51";
const PRIMARY_MAIN = "77d0994e1a101056fba75fecf1bc3ba0914d1c3d";
const HISTORICAL_MANIFEST_HASH =
  "8ee0247a0a4df05efe8a7bec73dc9025b0430d8f8ef10adec02ddebd17d13016";
const EXECUTION_SPEC_HASH =
  "6eef9c1959792ba6b111a0b1cd4259e70c6e2f72e74d68034e3d92cc4f3531ac";
const EXPECTED_RECEIPT_SHA256 =
  "f18b2daecd963cb3213693d11143d7e6c3e1c980e343058031fdb81dbf41fef1";

// --- On-chain identity (verified read-only at finalized commitment) --------
const CHAIN = Object.freeze({
  cluster: "devnet",
  genesis: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  programId: "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z",
  programDataAddress: "GSLxCPBrBFwAhyCTUpMGKGeqvUQWD1YkZG9ssXp1kPBs",
  upgradeAuthority: "Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk",
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
});

// Public participant identities (addresses only; never keypairs).
const PARTICIPANTS = Object.freeze({
  sponsor: "CY5KKnfh1TdSCmm3PuwCrCL5aGLEaqm8ZHiK8Q6AqDHq",
  maintainer: "7xBirdhUMsm7KEnfvx7mvUSrhVzZoJhoc4jnCurQo8S6",
  contributor: "DG2kRnmBhZVAusBUfG7eGqUHNXo2rQJ3Z1PCLrUURceT",
  mintAuthority: "7auk8apjydhbbDkwyjD3EJQopmckUMyaa1JTNp8e6fz7",
});

// Per-SEND on-chain observations verified by independent read-only RPC review at
// finalized commitment (fee in lamports, confirmation slot). Keyed by event ID.
const SEND_OBSERVATIONS = Object.freeze({
  "setup:create_mint": { feeLamports: 5000, slot: 479619466, numRequiredSignatures: 1 },
  "setup:sponsor_ata": { feeLamports: 5000, slot: 479619468, numRequiredSignatures: 1 },
  "setup:contributor_ata": { feeLamports: 5000, slot: 479619470, numRequiredSignatures: 1 },
  "setup:mint_tokens": { feeLamports: 10000, slot: 479619472, numRequiredSignatures: 2 },
  "release:initialize": { feeLamports: 5000, slot: 479619474, numRequiredSignatures: 1 },
  "release:fund": { feeLamports: 5000, slot: 479619499, numRequiredSignatures: 1 },
  "release:release": { feeLamports: 5000, slot: 479619502, numRequiredSignatures: 1 },
  "refund:initialize": { feeLamports: 5000, slot: 479619507, numRequiredSignatures: 1 },
  "refund:fund": { feeLamports: 5000, slot: 479619512, numRequiredSignatures: 1 },
  "refund:refund": { feeLamports: 5000, slot: 479619562, numRequiredSignatures: 1 },
  "cancel:initialize": { feeLamports: 5000, slot: 479619564, numRequiredSignatures: 1 },
  "cancel:cancel": { feeLamports: 5000, slot: 479619567, numRequiredSignatures: 1 },
});

// Finalized escrow/vault addresses and terminal states verified read-only.
const INSTANCES = Object.freeze({
  release: {
    escrow: "eYZqDuBoDqkMirew1LPBnxynCGPENoZq6z5g7AkLHfc",
    vault: "D5Sd41n5MNJrBhv8m8e3ApyQmHWXQwWxUkSNrGESkSUQ",
    finalizedStatus: "Released",
    finalizedVaultAmount: "0",
  },
  refund: {
    escrow: "9CqmJ8Eb8nxPoPHfzXHuHimgcTLgrV2JvhGK7vjAJfVF",
    vault: "6BnGE1tLwAHyoah851poCF2y7BAhjuPR1WmjfLNDvzix",
    finalizedStatus: "Refunded",
    finalizedVaultAmount: "0",
  },
  cancel: {
    escrow: "Hn1nBPj2X91GDmquVWFeFZj9Spf8sx3KCuQhaHsEbMDb",
    vault: "9Dc2Eea1JGJFs35hs3ThTaJFoufZ2enJ9xBdE41kZWPu",
    finalizedStatus: "Cancelled",
    finalizedVaultAmount: "0",
  },
});

// Finalized token accounting verified read-only (base units, decimals 6).
const TOKEN_ACCOUNTING = Object.freeze({
  mintedToSponsor: "3000000",
  contributorAtaFinalized: "1000000",
  sponsorAtaFinalized: "2000000",
});

// Per-payer actual base fees paid (lamports), verified by summing meta.fee.
const FUNDING = Object.freeze({
  actualFeesLamports: { sponsor: 60000, maintainer: 5000 },
  totalFeesLamports: 65000,
  plannerDiscrepancy: {
    before: { sponsorFeeProjectionLamports: 55000, model: "one base fee per SEND transaction" },
    after: { sponsorFeeProjectionLamports: 60000, model: "base fee per required signature" },
    rootCause:
      "setup:mint_tokens requires two signatures (sponsor fee payer + mintAuthority); " +
      "the old planner charged one base fee per transaction and undercounted by 5000 lamports.",
    repairedInCommit: TARGETED_REPAIR_COMMIT,
    affectedSelections: ["release", "refund", "cancel", "release+refund+cancel"],
  },
  note:
    "Actual fees were paid by the live run at " + LIVE_EXECUTION_GIT_SHA + " and reconcile " +
    "exactly. The repair corrects only the pre-execution funding projection; it does not " +
    "change any transaction, signer set, or on-chain outcome.",
});

const LIMITATIONS = Object.freeze([
  "Solana devnet only; not deployed to mainnet and handles no real-value assets.",
  "One completed execution (exec-4c6cce10). No persistence, resume, or recovery machinery is claimed or exercised across host restarts.",
  "No formal security audit; not production-security hardened.",
  "The program is deployed upgradeable with a retained loader upgrade authority (governance choice); this is distinct from any in-program upgrade instruction (there is none).",
  "The client harness authorizes only the frozen canonical execution spec; it is not a generic arbitrary-spec signer.",
  "This package is submission-candidate evidence pending final independent review; screenshot/video assets are a pending operator capture step.",
  "The full deterministic mint seed is withheld by policy; only the public mint address is published.",
]);

const EXPLORER_TX = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const EXPLORER_ADDR = (addr) => `https://explorer.solana.com/address/${addr}?cluster=devnet`;

const CANONICAL_EVENT_IDS = [
  "setup:create_mint", "setup:sponsor_ata", "setup:contributor_ata", "setup:mint_tokens",
  "release:initialize", "release:fund", "unauthorized_release", "release:release",
  "refund:initialize", "refund:fund", "refund_before_expiry", "refund:wait_expiry",
  "release_at_or_after_expiry", "refund:refund", "cancel:initialize", "cancel:cancel",
];

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readReceipt(repoRoot) {
  const path = join(repoRoot, RECEIPT_RELPATH);
  const bytes = readFileSync(path);
  const sha = sha256Hex(bytes);
  if (sha !== EXPECTED_RECEIPT_SHA256) {
    throw new Error(
      `EVIDENCE_INTEGRITY_FAILURE: receipt sha ${sha} != expected ${EXPECTED_RECEIPT_SHA256}`,
    );
  }
  return { receipt: JSON.parse(bytes.toString("utf8")), sha256: sha };
}

function flowOf(eventId) {
  if (eventId.startsWith("setup:")) return "setup";
  if (eventId === "unauthorized_release") return "release";
  if (eventId === "refund_before_expiry" || eventId === "release_at_or_after_expiry") return "refund";
  return eventId.slice(0, eventId.indexOf(":"));
}

export function buildManifest(repoRoot = REPO_ROOT) {
  const { receipt, sha256: originalReceiptSha256 } = readReceipt(repoRoot);

  // Receipt-derived indexes.
  const terminalByEvent = new Map(
    receipt.evidence.filter((e) => e.terminal).map((e) => [e.eventId, e]),
  );
  const sendStepById = new Map(
    receipt.steps.filter((s) => s.kind === "send").map((s) => [s.id, s]),
  );
  const simById = new Map(receipt.simulations.map((s) => [s.id, s]));
  const waitStep = receipt.steps.find((s) => s.kind === "wait") ?? null;

  if (JSON.stringify(receipt.selectedEvents.eventIds) !== JSON.stringify(CANONICAL_EVENT_IDS)) {
    throw new Error("receipt selected events differ from the canonical order");
  }

  const events = CANONICAL_EVENT_IDS.map((id, order) => {
    const terminal = terminalByEvent.get(id);
    if (!terminal) throw new Error(`receipt missing terminal evidence for ${id}`);
    const base = {
      order,
      id,
      flow: flowOf(id),
      kind: terminal.kind,
      terminalState: terminal.state,
      expectationSatisfied: terminal.expectationSatisfied,
    };
    if (terminal.kind === "SEND") {
      const step = sendStepById.get(id);
      const obs = SEND_OBSERVATIONS[id];
      return {
        ...base,
        signature: step.signature,
        feePayerRole: step.feePayerRole,
        feeLamports: obs.feeLamports,
        numRequiredSignatures: obs.numRequiredSignatures,
        slot: obs.slot,
        explorer: EXPLORER_TX(step.signature),
      };
    }
    if (terminal.kind === "SIMULATE") {
      const sim = simById.get(id);
      return {
        ...base,
        simulation: {
          code: sim.decoded.code,
          name: sim.decoded.name,
          instructionIndex: sim.decoded.instructionIndex,
        },
      };
    }
    return { ...base, waitOutcome: waitStep?.outcome ?? null };
  });

  const transactions = events
    .filter((e) => e.kind === "SEND")
    .map((e) => ({
      event: e.id,
      signature: e.signature,
      feePayerRole: e.feePayerRole,
      feeLamports: e.feeLamports,
      numRequiredSignatures: e.numRequiredSignatures,
      slot: e.slot,
      explorer: e.explorer,
    }));

  const simulations = events
    .filter((e) => e.kind === "SIMULATE")
    .map((e) => ({ event: e.id, ...e.simulation, terminalState: e.terminalState }));

  const manifest = {
    schema: "R4_BUSINESS_FLOW_LIVE_EVIDENCE_V1",
    generatedFrom: {
      originalReceiptRelpath: RECEIPT_RELPATH,
      originalReceiptSha256,
      note:
        "Original receipt is immutable and kept out of this package (gitignored .devnet). " +
        "This manifest is a deterministic sanitized projection; the receipt SHA proves linkage.",
    },
    provenance: {
      liveExecutionGitSha: LIVE_EXECUTION_GIT_SHA,
      currentReviewedGitSha: CURRENT_REVIEWED_GIT_SHA,
      targetedRepairCommit: TARGETED_REPAIR_COMMIT,
      primaryMain: PRIMARY_MAIN,
      liveReviewVerdict: "LIVE_EVIDENCE_ACCEPTED_WITH_TARGETED_FIX_REQUIRED",
      fundingRepairVerdict: "TARGETED_FUNDING_REPAIR_ACCEPTED",
      secondLiveExecutionRequired: false,
      notes: [
        "The 12 live transactions were produced by the live execution SHA " + LIVE_EXECUTION_GIT_SHA + ".",
        "Independent review accepted the business-flow evidence and found a planner fee undercount (per-transaction instead of per-signature).",
        "Repair " + TARGETED_REPAIR_COMMIT + " changes only the funding projection; it does not change transaction bytes, signer sets, event ordering, the executor, or receipt semantics.",
        "An independent reviewer confirmed no second live execution is required.",
        "The historical manifest hash " + HISTORICAL_MANIFEST_HASH + " is immutable execution evidence at " + LIVE_EXECUTION_GIT_SHA + " and is not reproduced by current code.",
      ],
    },
    execution: {
      executionId: receipt.executionId,
      historicalManifestHash: HISTORICAL_MANIFEST_HASH,
      receiptManifestHash: receipt.manifestHash,
      executionSpecHash: EXECUTION_SPEC_HASH,
      finalStatus: receipt.finalStatus,
      stopReason: receipt.stopReason,
      cluster: CHAIN.cluster,
      counts: {
        sends: receipt.selectedEvents.sendCount,
        simulations: receipt.selectedEvents.simulationCount,
        waits: receipt.selectedEvents.waitCount,
      },
    },
    chain: CHAIN,
    participants: PARTICIPANTS,
    mint: {
      address: receipt.mint,
      decimals: 6,
      seedScheme: "SOLANA_CREATE_WITH_SEED_SHA256_V1 / R4_BUSINESS_FLOW_MINT_V2",
      seedDisclosure: "withheld-by-policy",
    },
    tokenAccounts: {
      sponsorAta: receipt.sponsorToken,
      contributorAta: receipt.contributorToken,
    },
    amountBaseUnits: "1000000",
    events,
    transactions,
    simulations,
    wait: { event: "refund:wait_expiry", outcome: waitStep?.outcome ?? null },
    instances: INSTANCES,
    finalizedState: {
      escrows: {
        release: { status: INSTANCES.release.finalizedStatus, vault: INSTANCES.release.vault, vaultAmount: INSTANCES.release.finalizedVaultAmount },
        refund: { status: INSTANCES.refund.finalizedStatus, vault: INSTANCES.refund.vault, vaultAmount: INSTANCES.refund.finalizedVaultAmount },
        cancel: { status: INSTANCES.cancel.finalizedStatus, vault: INSTANCES.cancel.vault, vaultAmount: INSTANCES.cancel.finalizedVaultAmount },
      },
      tokenAccounting: TOKEN_ACCOUNTING,
    },
    funding: FUNDING,
    onChainObservationProvenance:
      "escrow/vault addresses, finalized statuses, token balances, per-transaction fees, and slots " +
      "were verified by independent read-only RPC at finalized commitment; this deterministic build " +
      "embeds them as fixed constants and performs no network I/O.",
    limitations: LIMITATIONS,
  };
  return { manifest, originalReceiptSha256 };
}

// --- Markdown projections --------------------------------------------------

function provenanceHeader(m) {
  return [
    `> Live execution code SHA: \`${m.provenance.liveExecutionGitSha}\``,
    `> Current reviewed code SHA: \`${m.provenance.currentReviewedGitSha}\``,
    `> Historical manifest hash: \`${m.execution.historicalManifestHash}\``,
    `> Execution-spec hash: \`${m.execution.executionSpecHash}\``,
    `> Execution ID: \`${m.execution.executionId}\``,
    `> Cluster: devnet (\`${m.chain.genesis}\`)`,
  ].join("\n");
}

function renderReport(m, manifestSha) {
  const L = [];
  L.push("# Live Verification Report — Canonical Business-Flow Demonstration");
  L.push("");
  L.push(provenanceHeader(m));
  L.push("");
  L.push("## Dual-SHA provenance");
  L.push("");
  L.push(`- **Live matrix executed at** \`${m.provenance.liveExecutionGitSha}\`. The 12 on-chain transactions below were produced by that code.`);
  L.push(`- Independent review verdict: **${m.provenance.liveReviewVerdict}**.`);
  L.push(`- Review found a planner fee undercount (per-transaction instead of per-signature).`);
  L.push(`- Targeted repair \`${m.provenance.targetedRepairCommit}\` changes only the funding projection — not transaction bytes, signer sets, event ordering, the executor, or receipt semantics.`);
  L.push(`- Funding-repair verdict: **${m.provenance.fundingRepairVerdict}**; second live execution required: **${m.provenance.secondLiveExecutionRequired ? "yes" : "no"}**.`);
  L.push(`- The historical manifest hash \`${m.execution.historicalManifestHash}\` is immutable evidence at the live SHA and is **not** reproduced by current code.`);
  L.push("");
  L.push("## Result");
  L.push("");
  L.push(`Final status: **${m.execution.finalStatus}** (${m.execution.counts.sends} SEND / ${m.execution.counts.simulations} SIMULATE / ${m.execution.counts.waits} WAIT). All 16 canonical events terminal and expectation-satisfied.`);
  L.push("");
  L.push("## Canonical events");
  L.push("");
  L.push("| # | Event | Kind | Terminal state | Signature / detail |");
  L.push("|---|-------|------|----------------|--------------------|");
  for (const e of m.events) {
    let detail = "—";
    if (e.kind === "SEND") detail = `\`${e.signature}\``;
    else if (e.kind === "SIMULATE") detail = `${e.simulation.name} (Custom ${e.simulation.code}, ix ${e.simulation.instructionIndex})`;
    else if (e.kind === "WAIT") detail = e.waitOutcome;
    L.push(`| ${e.order} | ${e.id} | ${e.kind} | ${e.terminalState} | ${detail} |`);
  }
  L.push("");
  L.push("## Negative simulations (attributed, escrow-originated)");
  L.push("");
  L.push("| Event | Code | Name | Instruction index |");
  L.push("|-------|------|------|-------------------|");
  for (const s of m.simulations) L.push(`| ${s.event} | ${s.code} | ${s.name} | ${s.instructionIndex} |`);
  L.push("");
  L.push("## Finalized on-chain state");
  L.push("");
  L.push("| Flow | Escrow | Status | Vault | Vault amount |");
  L.push("|------|--------|--------|-------|--------------|");
  for (const flow of ["release", "refund", "cancel"]) {
    const i = m.instances[flow];
    L.push(`| ${flow} | \`${i.escrow}\` | ${i.finalizedStatus} | \`${i.vault}\` | ${i.finalizedVaultAmount} |`);
  }
  L.push("");
  L.push(`Deterministic mint \`${m.mint.address}\` (decimals ${m.mint.decimals}, initialized, owned by the token program). Token accounting: minted ${m.finalizedState.tokenAccounting.mintedToSponsor} → contributor ATA ${m.finalizedState.tokenAccounting.contributorAtaFinalized} + sponsor ATA ${m.finalizedState.tokenAccounting.sponsorAtaFinalized}.`);
  L.push("");
  L.push("## Funding reconciliation");
  L.push("");
  L.push(`Actual base fees: sponsor ${m.funding.actualFeesLamports.sponsor} lamports, maintainer ${m.funding.actualFeesLamports.maintainer} (total ${m.funding.totalFeesLamports}).`);
  L.push(`The pre-execution planner projected sponsor fees at ${m.funding.plannerDiscrepancy.before.sponsorFeeProjectionLamports} (${m.funding.plannerDiscrepancy.before.model}); corrected to ${m.funding.plannerDiscrepancy.after.sponsorFeeProjectionLamports} (${m.funding.plannerDiscrepancy.after.model}) in \`${m.funding.plannerDiscrepancy.repairedInCommit}\`. Root cause: ${m.funding.plannerDiscrepancy.rootCause}`);
  L.push("");
  L.push("## Integrity / hash inventory");
  L.push("");
  L.push(`- Original receipt (\`${m.generatedFrom.originalReceiptRelpath}\`, immutable, gitignored): SHA-256 \`${m.generatedFrom.originalReceiptSha256}\``);
  L.push(`- Evidence manifest (\`evidence-manifest.json\`): SHA-256 \`${manifestSha}\``);
  L.push("");
  L.push("## Limitations");
  L.push("");
  for (const lim of m.limitations) L.push(`- ${lim}`);
  L.push("");
  return L.join("\n");
}

function renderExplorer(m) {
  const L = [];
  L.push("# Explorer Transaction Index (devnet)");
  L.push("");
  L.push(provenanceHeader(m));
  L.push("");
  L.push("All 12 SEND transactions of the canonical matrix, in canonical order. Every link targets `cluster=devnet`.");
  L.push("");
  L.push("| # | Event | Fee payer | Fee (lamports) | Slot | Explorer |");
  L.push("|---|-------|-----------|----------------|------|----------|");
  m.transactions.forEach((t, i) => {
    L.push(`| ${i + 1} | ${t.event} | ${t.feePayerRole} | ${t.feeLamports} | ${t.slot} | [tx](${t.explorer}) |`);
  });
  L.push("");
  L.push("## Key accounts");
  L.push("");
  L.push(`- Program: [${m.chain.programId}](${EXPLORER_ADDR(m.chain.programId)})`);
  L.push(`- ProgramData: [${m.chain.programDataAddress}](${EXPLORER_ADDR(m.chain.programDataAddress)})`);
  L.push(`- Mint: [${m.mint.address}](${EXPLORER_ADDR(m.mint.address)})`);
  for (const flow of ["release", "refund", "cancel"]) {
    const i = m.instances[flow];
    L.push(`- ${flow} escrow (${i.finalizedStatus}): [${i.escrow}](${EXPLORER_ADDR(i.escrow)})`);
  }
  L.push("");
  return L.join("\n");
}

function renderSubmission(m) {
  const L = [];
  L.push("# Submission Narrative");
  L.push("");
  L.push(provenanceHeader(m));
  L.push("");
  L.push("## Short (form-ready)");
  L.push("");
  L.push(`A neutral pre-funded OSS-bounty escrow prototype on Solana devnet. One canonical business-flow demonstration (execution \`${m.execution.executionId}\`) completed end-to-end: deterministic mint setup, release payout to the contributor, refund to the sponsor after on-chain expiry, and cancel before funding — plus three attributed negative simulations (unauthorized release, refund-before-expiry, release-after-expiry). All 16 events reached their expected terminal state (${m.execution.finalStatus}); 12 transactions are finalized on devnet. Evidence is bound to an immutable receipt (SHA-256 \`${m.generatedFrom.originalReceiptSha256}\`). Devnet only; no mainnet, no real-value assets, no formal audit.`);
  L.push("");
  L.push("## Detailed (for reviewer)");
  L.push("");
  L.push("### What the prototype does");
  L.push("");
  L.push("- Locks an exact classic SPL-token amount in a per-escrow vault.");
  L.push("- **Release**: the configured maintainer pays out the amount to the contributor before expiry.");
  L.push("- **Refund**: the sponsor recovers the amount at or after on-chain expiry.");
  L.push("- **Cancel**: the sponsor cancels an initialized-but-unfunded escrow.");
  L.push("");
  L.push("### Canonical trust path");
  L.push("");
  L.push("- A frozen execution spec (hash `" + m.execution.executionSpecHash + "`) defines 16 ordered events; the client authorizes only this spec, not arbitrary transactions.");
  L.push("- Instructions are built solely through the canonical registry/factory and validated against per-event schemas before signing.");
  L.push("- A deterministic mint (`" + m.mint.address + "`) is derived by seed, avoiding an ephemeral mint signer.");
  L.push("- Per-payer funding: the sponsor funds setup and both escrows; the maintainer pays only the release transaction; the contributor and mint authority are non-payer signers only.");
  L.push("- An append-only receipt timeline binds each event to the spec hash and records BUILT→SUBMITTED→CONFIRMED→VERIFIED for sends.");
  L.push("");
  L.push("### Negative simulations (read-only, attributed)");
  L.push("");
  for (const s of m.simulations) L.push(`- \`${s.event}\` → ${s.name} (Custom ${s.code}), escrow-originated at instruction index ${s.instructionIndex}.`);
  L.push("");
  L.push("### Provenance and the funding repair");
  L.push("");
  L.push("- The live matrix ran at `" + m.provenance.liveExecutionGitSha + "`. Independent review accepted the business-flow evidence and flagged a planner fee undercount (per-transaction rather than per-signature).");
  L.push("- Repair `" + m.provenance.targetedRepairCommit + "` corrects only the funding projection. It does not change transaction bytes, signer sets, event ordering, the executor, or receipt semantics, so the existing live evidence remains valid and no second live run is required.");
  L.push("");
  L.push("### Evidence links");
  L.push("");
  L.push("- Machine-readable manifest: `docs/evidence/evidence-manifest.json`");
  L.push("- Live verification report: `docs/evidence/LIVE_VERIFICATION_REPORT.md`");
  L.push("- Explorer transaction index: `docs/evidence/EXPLORER_INDEX.md`");
  L.push("- Capture checklist (screenshots/video, operator step): `docs/evidence/CAPTURE_CHECKLIST.md`");
  L.push("");
  L.push("### Limitations");
  L.push("");
  for (const lim of m.limitations) L.push(`- ${lim}`);
  L.push("");
  return L.join("\n");
}

// --- Shared screenshot specification (single source for checklist + inventory) ---
//
// Each entry names the exact deterministic filename an operator must drop into
// docs/evidence/assets/screenshots/, what it maps to, and where to capture it.
// No screenshot is fabricated here; the inventory records status "pending" until
// an operator captures the real image and records its SHA-256.

const SCREENSHOTS_RELDIR = "docs/evidence/assets/screenshots";

function screenshotSpec(m) {
  const tx = (event) => m.transactions.find((t) => t.event === event);
  return [
    {
      id: "01-program-account",
      title: "Program account",
      kind: "direct-explorer",
      mapping: { account: m.chain.programId, role: "program" },
      sourceUrl: EXPLORER_ADDR(m.chain.programId),
      whatToShow: "Executable, owned by the upgradeable loader; Devnet cluster visible.",
    },
    {
      id: "02-programdata",
      title: "ProgramData account",
      kind: "direct-explorer",
      mapping: { account: m.chain.programDataAddress, role: "programData" },
      sourceUrl: EXPLORER_ADDR(m.chain.programDataAddress),
      whatToShow: "ProgramData with retained upgrade authority; Devnet cluster visible.",
    },
    {
      id: "03-deterministic-mint",
      title: "Deterministic mint account",
      kind: "direct-explorer",
      mapping: { account: m.mint.address, role: "mint" },
      sourceUrl: EXPLORER_ADDR(m.mint.address),
      whatToShow: `Mint initialized, decimals ${m.mint.decimals}; Devnet cluster visible.`,
    },
    {
      id: "04-release-transaction",
      title: "Release transaction",
      kind: "direct-explorer",
      mapping: { event: "release:release", signature: tx("release:release").signature },
      sourceUrl: tx("release:release").explorer,
      whatToShow: "Success; fee payer maintainer; Devnet cluster visible.",
    },
    {
      id: "05-release-escrow-released",
      title: "Release escrow (Released)",
      kind: "direct-explorer",
      mapping: { account: m.instances.release.escrow, role: "release-escrow", status: "Released" },
      sourceUrl: EXPLORER_ADDR(m.instances.release.escrow),
      whatToShow: "Escrow account in Released state; vault drained.",
    },
    {
      id: "06-refund-transaction",
      title: "Refund transaction",
      kind: "direct-explorer",
      mapping: { event: "refund:refund", signature: tx("refund:refund").signature },
      sourceUrl: tx("refund:refund").explorer,
      whatToShow: "Success; fee payer sponsor; Devnet cluster visible.",
    },
    {
      id: "07-refund-escrow-refunded",
      title: "Refund escrow (Refunded)",
      kind: "direct-explorer",
      mapping: { account: m.instances.refund.escrow, role: "refund-escrow", status: "Refunded" },
      sourceUrl: EXPLORER_ADDR(m.instances.refund.escrow),
      whatToShow: "Escrow account in Refunded state; vault drained.",
    },
    {
      id: "08-cancel-transaction",
      title: "Cancel transaction",
      kind: "direct-explorer",
      mapping: { event: "cancel:cancel", signature: tx("cancel:cancel").signature },
      sourceUrl: tx("cancel:cancel").explorer,
      whatToShow: "Success; fee payer sponsor; Devnet cluster visible.",
    },
    {
      id: "09-cancel-escrow-cancelled",
      title: "Cancel escrow (Cancelled)",
      kind: "direct-explorer",
      mapping: { account: m.instances.cancel.escrow, role: "cancel-escrow", status: "Cancelled" },
      sourceUrl: EXPLORER_ADDR(m.instances.cancel.escrow),
      whatToShow: "Escrow account in Cancelled state.",
    },
    {
      id: "10-contributor-ata",
      title: "Contributor ATA balance",
      kind: "direct-explorer",
      mapping: { account: m.tokenAccounts.contributorAta, role: "contributor-ata", amount: m.finalizedState.tokenAccounting.contributorAtaFinalized },
      sourceUrl: EXPLORER_ADDR(m.tokenAccounts.contributorAta),
      whatToShow: `Token balance ${m.finalizedState.tokenAccounting.contributorAtaFinalized} base units (from release payout).`,
    },
    {
      id: "11-sponsor-ata",
      title: "Sponsor ATA balance",
      kind: "direct-explorer",
      mapping: { account: m.tokenAccounts.sponsorAta, role: "sponsor-ata", amount: m.finalizedState.tokenAccounting.sponsorAtaFinalized },
      sourceUrl: EXPLORER_ADDR(m.tokenAccounts.sponsorAta),
      whatToShow: `Token balance ${m.finalizedState.tokenAccounting.sponsorAtaFinalized} base units (minted minus release, plus refund).`,
    },
    {
      id: "12-negative-simulations",
      title: "Three negative simulation proofs",
      kind: "receipt-projection",
      mapping: {
        events: m.simulations.map((s) => s.event),
        codes: m.simulations.map((s) => `${s.name}(${s.code})`),
      },
      sourceUrl: null,
      whatToShow:
        "From docs/evidence/LIVE_VERIFICATION_REPORT.md: the three EXPECTED_ERROR simulations — " +
        m.simulations.map((s) => `${s.name} (Custom ${s.code})`).join(", ") + ".",
    },
    {
      id: "13-integrity-provenance",
      title: "Evidence integrity & dual-SHA provenance",
      kind: "explanatory",
      mapping: {
        originalReceiptSha256: m.generatedFrom.originalReceiptSha256,
        liveExecutionGitSha: m.provenance.liveExecutionGitSha,
        currentReviewedGitSha: m.provenance.currentReviewedGitSha,
      },
      sourceUrl: null,
      whatToShow:
        "Terminal: `sha256sum` of the receipt equals the inventory hash, plus `git log` showing " +
        "the live execution SHA and the funding-repair commit (dual-SHA provenance).",
    },
  ];
}

function renderChecklist(m) {
  const shots = screenshotSpec(m);
  const L = [];
  L.push("# Screenshot & Video Capture Checklist (operator step)");
  L.push("");
  L.push(provenanceHeader(m));
  L.push("");
  L.push("These assets are **not yet captured**. Capture from historical finalized Explorer evidence and the sanitized receipt; do **not** re-run the matrix. Sanitize before sharing: no keypairs, no local absolute paths, no OS username, no unrelated desktop content.");
  L.push("");
  L.push(`Save each PNG under \`${SCREENSHOTS_RELDIR}/\` using the exact filename below, then record its SHA-256 in \`docs/evidence/assets/ASSET_INVENTORY.json\` (regenerate is not automatic for binaries — update the inventory's per-asset \`sha256\` and \`status\`).`);
  L.push("");
  L.push("## Screenshots");
  L.push("");
  L.push("| # | Filename | Target | Source | What to show |");
  L.push("|---|----------|--------|--------|--------------|");
  shots.forEach((s, i) => {
    const src = s.sourceUrl ? s.sourceUrl : (s.kind === "receipt-projection" ? "sanitized report" : "terminal");
    L.push(`| ${i + 1} | \`${s.id}.png\` | ${s.title} | ${src} | ${s.whatToShow} |`);
  });
  L.push("");
  L.push("Cropping, annotation, and redaction are permitted only for clarity/privacy and must not change evidence meaning. Do not alter screenshots to fabricate data.");
  L.push("");
  L.push("## Video (see docs/evidence/VIDEO_SCRIPT.md for the full script)");
  L.push("");
  L.push("Record ~2–4 minutes from the same historical finalized evidence; do not re-run the matrix. Narration must not claim mainnet readiness, persistence/recovery, production security, a formal audit, or that current HEAD produced the live transactions.");
  L.push("");
  return L.join("\n");
}

function renderVideoScript(m) {
  const tx = (event) => m.transactions.find((t) => t.event === event);
  const L = [];
  L.push("# Video Script — Canonical Business-Flow Demonstration (devnet)");
  L.push("");
  L.push(provenanceHeader(m));
  L.push("");
  L.push("Production-ready script for a manual operator recording. Suggested length ~3 minutes. Use historical finalized Explorer evidence and the sanitized package only — **do not re-run the matrix**. The recording is a walkthrough of existing evidence, not a new live execution.");
  L.push("");
  L.push("## Shot list & narration");
  L.push("");
  const rows = [
    ["0:00–0:20", "Title card / README", "Purpose: a neutral pre-funded OSS-bounty escrow prototype on Solana devnet. Devnet only, no real-value assets. This is a walkthrough of a completed demonstration."],
    ["0:20–0:40", `Program on Explorer (${m.chain.programId})`, `Program deployed on devnet, executable, upgradeable loader; ProgramData ${m.chain.programDataAddress}. Canonical execution-spec hash ${m.execution.executionSpecHash}.`],
    ["0:40–0:55", `Deterministic mint (${m.mint.address})`, `Mint derived by seed (no ephemeral mint signer), decimals ${m.mint.decimals}, initialized.`],
    ["0:55–1:20", `Release tx ${tx("release:release").signature.slice(0, 12)}… + release escrow`, "Maintainer releases the locked amount before expiry; escrow becomes Released; contributor ATA receives the payout."],
    ["1:20–1:35", "Unauthorized-release negative proof", `Read-only simulation rejected with ${m.simulations.find((s) => s.event === "unauthorized_release").name} (Custom ${m.simulations.find((s) => s.event === "unauthorized_release").code}).`],
    ["1:35–2:05", `Refund flow (before-expiry proof, WAIT, refund tx ${tx("refund:refund").signature.slice(0, 12)}…)`, `Before expiry, refund is rejected with EscrowNotExpired (6008). The run WAITs on authoritative chain time (${m.wait.outcome}); after expiry, release is rejected with EscrowExpired (6007) and the sponsor refund succeeds; escrow becomes Refunded.`],
    ["2:05–2:20", `Cancel flow (cancel tx ${tx("cancel:cancel").signature.slice(0, 12)}…)`, "Sponsor cancels an initialized-but-unfunded escrow; escrow becomes Cancelled."],
    ["2:20–2:40", "Final accounting", `Token accounting: minted ${m.finalizedState.tokenAccounting.mintedToSponsor} = contributor ${m.finalizedState.tokenAccounting.contributorAtaFinalized} + sponsor ${m.finalizedState.tokenAccounting.sponsorAtaFinalized}; all vaults drained to 0.`],
    ["2:40–2:55", "Integrity & provenance", `Immutable receipt SHA-256 ${m.generatedFrom.originalReceiptSha256}. Live matrix ran at ${m.provenance.liveExecutionGitSha}; the funding repair ${m.provenance.targetedRepairCommit} changed only the fee projection (per-transaction → per-signature), so the live evidence stays valid and no second live run was required.`],
    ["2:55–3:00", "Limitations", "Devnet only; no mainnet, no persistence/recovery, no formal audit, no production-security claim."],
  ];
  L.push("| Time | Shot | Narration |");
  L.push("|------|------|-----------|");
  for (const [t, shot, narration] of rows) L.push(`| ${t} | ${shot} | ${narration} |`);
  L.push("");
  L.push("## Narration guardrails");
  L.push("");
  L.push("Do NOT claim: mainnet readiness; a formal audit; persistence/recovery; production security; a live transaction at the post-repair SHA; or that the video is itself a new live execution.");
  L.push("");
  return L.join("\n");
}

function renderScreenshotsReadme(m) {
  const shots = screenshotSpec(m);
  const L = [];
  L.push("# Screenshots (operator drop-in)");
  L.push("");
  L.push("This directory holds operator-captured PNG screenshots for the submission. They are **not** committed by the generator; capture them per `docs/evidence/CAPTURE_CHECKLIST.md` and record each file's SHA-256 and `status` in `docs/evidence/assets/ASSET_INVENTORY.json`.");
  L.push("");
  L.push("Expected filenames (exact):");
  L.push("");
  for (const s of shots) L.push(`- \`${s.id}.png\` — ${s.title}`);
  L.push("");
  L.push("Sanitize before adding: no keypairs, no local absolute paths, no OS username, no unrelated desktop content. Every Explorer screenshot must clearly show the Devnet cluster.");
  L.push("");
  return L.join("\n");
}

function buildAssetInventory(m) {
  const shots = screenshotSpec(m);
  return {
    schema: "R4_BUSINESS_FLOW_SUBMISSION_ASSETS_V1",
    boundTo: {
      evidenceManifest: "docs/evidence/evidence-manifest.json",
      originalReceiptSha256: m.generatedFrom.originalReceiptSha256,
      liveExecutionGitSha: m.provenance.liveExecutionGitSha,
      currentReviewedGitSha: m.provenance.currentReviewedGitSha,
      cluster: m.chain.cluster,
    },
    screenshots: shots.map((s) => ({
      id: s.id,
      file: `${SCREENSHOTS_RELDIR}/${s.id}.png`,
      title: s.title,
      kind: s.kind,
      cluster: m.chain.cluster,
      mapping: s.mapping,
      sourceUrl: s.sourceUrl,
      redactions: "none-yet",
      status: "pending-operator-capture",
      sha256: null,
    })),
    video: {
      file: "docs/evidence/VIDEO_SCRIPT.md",
      renderedAsset: null,
      kind: "script",
      status: "script-ready-pending-recording",
      hostedUrl: null,
      sha256: null,
      note: "Record from historical finalized evidence; do not re-run the matrix.",
    },
    limitations: m.limitations,
  };
}

export function buildArtifacts(repoRoot = REPO_ROOT) {
  const { manifest } = buildManifest(repoRoot);
  const manifestJson = canonicalJson(manifest) + "\n";
  const manifestSha256 = sha256Hex(Buffer.from(manifestJson, "utf8"));
  const inventory = buildAssetInventory(manifest);
  const files = {
    "docs/evidence/evidence-manifest.json": manifestJson,
    "docs/evidence/LIVE_VERIFICATION_REPORT.md": renderReport(manifest, manifestSha256) + "",
    "docs/evidence/EXPLORER_INDEX.md": renderExplorer(manifest) + "",
    "docs/evidence/SUBMISSION.md": renderSubmission(manifest) + "",
    "docs/evidence/CAPTURE_CHECKLIST.md": renderChecklist(manifest) + "",
    "docs/evidence/VIDEO_SCRIPT.md": renderVideoScript(manifest) + "",
    "docs/evidence/assets/ASSET_INVENTORY.json": canonicalJson(inventory) + "\n",
    "docs/evidence/assets/screenshots/README.md": renderScreenshotsReadme(manifest) + "",
  };
  return { manifest, manifestJson, manifestSha256, inventory, files };
}

function main() {
  const { files, manifestSha256 } = buildArtifacts(REPO_ROOT);
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(REPO_ROOT, rel), content);
  }
  process.stdout.write(`evidence-manifest.json SHA-256: ${manifestSha256}\n`);
  process.stdout.write(`wrote ${Object.keys(files).length} files under docs/evidence/\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
