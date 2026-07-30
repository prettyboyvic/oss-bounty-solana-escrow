import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import {
  buildArtifacts,
  buildManifest,
} from "../../docs/evidence/build-evidence.mjs";

function readInventory() {
  const { files } = buildArtifacts(REPO_ROOT);
  return JSON.parse(files["docs/evidence/assets/ASSET_INVENTORY.json"]);
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const LIVE_SHA = "e4547ea75a13ebd7ee96ef5c91bc7071017950d6";
const CURRENT_SHA = "4544c3403b7acb0630d2aeb1c1388226f3187c51";
const RECEIPT_SHA = "f18b2daecd963cb3213693d11143d7e6c3e1c980e343058031fdb81dbf41fef1";
const SPEC_HASH = "6eef9c1959792ba6b111a0b1cd4259e70c6e2f72e74d68034e3d92cc4f3531ac";

test("committed evidence files are byte-identical to the deterministic generator", () => {
  const { files } = buildArtifacts(REPO_ROOT);
  for (const [rel, content] of Object.entries(files)) {
    const onDisk = readFileSync(join(REPO_ROOT, rel), "utf8");
    assert.equal(onDisk, content, `${rel} drifted from the generator; re-run build-evidence.mjs`);
  }
});

test("manifest links to the immutable receipt SHA (generator fails closed on mismatch)", () => {
  const { manifest } = buildManifest(REPO_ROOT);
  assert.equal(manifest.generatedFrom.originalReceiptSha256, RECEIPT_SHA);
});

test("manifest carries exactly 16 canonical events with correct terminal states", () => {
  const { manifest } = buildManifest(REPO_ROOT);
  assert.equal(manifest.events.length, 16);
  const satisfied = manifest.events.every((e) => e.expectationSatisfied === true);
  assert.ok(satisfied, "every event must be expectation-satisfied");
  assert.equal(manifest.execution.finalStatus, "COMPLETE");
  const kinds = manifest.events.reduce((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(kinds, { SEND: 12, SIMULATE: 3, WAIT: 1 });
});

test("exactly 12 transactions, no duplicate signature, exact event mapping", () => {
  const { manifest } = buildManifest(REPO_ROOT);
  assert.equal(manifest.transactions.length, 12);
  const sigs = manifest.transactions.map((t) => t.signature);
  assert.equal(new Set(sigs).size, 12, "signatures must be unique");
  for (const t of manifest.transactions) {
    const event = manifest.events.find((e) => e.id === t.event);
    assert.equal(event.signature, t.signature, `mapping mismatch for ${t.event}`);
    assert.equal(t.feeLamports, t.numRequiredSignatures * 5000);
  }
});

test("three expected simulations and one WAIT_REACHED", () => {
  const { manifest } = buildManifest(REPO_ROOT);
  const sims = Object.fromEntries(manifest.simulations.map((s) => [s.event, s]));
  assert.equal(sims["unauthorized_release"].code, 2001);
  assert.equal(sims["unauthorized_release"].name, "ConstraintHasOne");
  assert.equal(sims["refund_before_expiry"].code, 6008);
  assert.equal(sims["refund_before_expiry"].name, "EscrowNotExpired");
  assert.equal(sims["release_at_or_after_expiry"].code, 6007);
  assert.equal(sims["release_at_or_after_expiry"].name, "EscrowExpired");
  for (const s of manifest.simulations) assert.equal(s.terminalState, "EXPECTED_ERROR");
  assert.equal(manifest.wait.outcome, "REACHED");
});

test("finalized terminal escrow states with drained vaults", () => {
  const { manifest } = buildManifest(REPO_ROOT);
  const e = manifest.finalizedState.escrows;
  assert.equal(e.release.status, "Released");
  assert.equal(e.refund.status, "Refunded");
  assert.equal(e.cancel.status, "Cancelled");
  for (const flow of ["release", "refund", "cancel"]) {
    assert.equal(e[flow].vaultAmount, "0");
  }
  const t = manifest.finalizedState.tokenAccounting;
  assert.equal(t.mintedToSponsor, "3000000");
  assert.equal(t.contributorAtaFinalized, "1000000");
  assert.equal(t.sponsorAtaFinalized, "2000000");
  assert.equal(
    BigInt(t.contributorAtaFinalized) + BigInt(t.sponsorAtaFinalized),
    BigInt(t.mintedToSponsor),
  );
});

test("fee totals reconcile: sponsor 60000, maintainer 5000, total 65000", () => {
  const { manifest } = buildManifest(REPO_ROOT);
  assert.equal(manifest.funding.actualFeesLamports.sponsor, 60000);
  assert.equal(manifest.funding.actualFeesLamports.maintainer, 5000);
  assert.equal(manifest.funding.totalFeesLamports, 65000);
  const sumFromTx = manifest.transactions.reduce((acc, t) => {
    acc[t.feePayerRole] = (acc[t.feePayerRole] ?? 0) + t.feeLamports;
    return acc;
  }, {});
  assert.equal(sumFromTx.sponsor, 60000);
  assert.equal(sumFromTx.maintainer, 5000);
});

test("dual-SHA provenance is present and the two SHAs are distinct", () => {
  const { manifest } = buildManifest(REPO_ROOT);
  assert.equal(manifest.provenance.liveExecutionGitSha, LIVE_SHA);
  assert.equal(manifest.provenance.currentReviewedGitSha, CURRENT_SHA);
  assert.notEqual(
    manifest.provenance.liveExecutionGitSha,
    manifest.provenance.currentReviewedGitSha,
  );
  assert.equal(manifest.execution.executionSpecHash, SPEC_HASH);
  assert.equal(manifest.provenance.fundingRepairVerdict, "TARGETED_FUNDING_REPAIR_ACCEPTED");
  assert.equal(manifest.provenance.secondLiveExecutionRequired, false);
});

test("no prohibited secret fields, keypair references, or absolute local paths", () => {
  const { files } = buildArtifacts(REPO_ROOT);
  const forbidden = [
    /secretKey/i,
    // Actual keypair-file token, not the word "keypair" in anti-leak guidance.
    /\.devnet-keypair/i,
    /-----BEGIN/,
    /[A-Za-z]:\\\\/, // Windows absolute path (escaped backslash in JSON)
    /[A-Za-z]:[\\/]Users[\\/]/i, // Windows user path
    /\/home\//,
    /\bLOCAL_USERNAME_CANARY\b/i, // synthetic OS-username canary
    /bfm2-[0-9a-f]{27}/, // withheld deterministic seed
    /\[\s*\d{1,3}\s*,\s*\d{1,3}\s*,/, // raw byte-array (secret key material)
  ];
  for (const [rel, content] of Object.entries(files)) {
    for (const pattern of forbidden) {
      assert.ok(
        !pattern.test(content),
        `${rel} contains forbidden pattern ${pattern}`,
      );
    }
  }
});

test("asset inventory: pending screenshots bound to devnet with null hashes", () => {
  const inv = readInventory();
  assert.equal(inv.schema, "R4_BUSINESS_FLOW_SUBMISSION_ASSETS_V1");
  assert.equal(inv.boundTo.originalReceiptSha256, RECEIPT_SHA);
  assert.equal(inv.boundTo.liveExecutionGitSha, LIVE_SHA);
  assert.equal(inv.boundTo.currentReviewedGitSha, CURRENT_SHA);
  assert.ok(inv.screenshots.length >= 12, "expected at least 12 screenshot entries");
  const ids = new Set();
  for (const s of inv.screenshots) {
    assert.equal(s.cluster, "devnet");
    assert.equal(s.status, "pending-operator-capture", `${s.id} must be pending until captured`);
    assert.equal(s.sha256, null, `${s.id} hash must be null until captured`);
    assert.equal(s.file, `docs/evidence/assets/screenshots/${s.id}.png`, `${s.id} filename mismatch`);
    assert.ok(!ids.has(s.id), `duplicate screenshot id ${s.id}`);
    ids.add(s.id);
    if (s.kind === "direct-explorer") {
      assert.ok(s.sourceUrl && s.sourceUrl.includes("cluster=devnet"), `${s.id} needs a devnet Explorer sourceUrl`);
    }
  }
  assert.equal(inv.video.status, "script-ready-pending-recording");
  assert.equal(inv.video.renderedAsset, null);
  assert.equal(inv.video.sha256, null);
});

test("checklist filenames match the asset inventory (single source)", () => {
  const inv = readInventory();
  const { files } = buildArtifacts(REPO_ROOT);
  const checklist = files["docs/evidence/CAPTURE_CHECKLIST.md"];
  const readme = files["docs/evidence/assets/screenshots/README.md"];
  for (const s of inv.screenshots) {
    assert.ok(checklist.includes(`${s.id}.png`), `checklist missing ${s.id}.png`);
    assert.ok(readme.includes(`${s.id}.png`), `screenshots README missing ${s.id}.png`);
  }
});

test("no captured screenshot binary contradicts its declared pending status", () => {
  const inv = readInventory();
  for (const s of inv.screenshots) {
    // Until an operator captures it, the PNG must not exist while status is pending.
    if (s.status === "pending-operator-capture") {
      assert.ok(!existsSync(join(REPO_ROOT, s.file)), `${s.file} exists but inventory says pending; update inventory sha256/status`);
    }
  }
});

test("every Explorer URL targets devnet", () => {
  const { files } = buildArtifacts(REPO_ROOT);
  for (const [rel, content] of Object.entries(files)) {
    const urls = content.match(/https:\/\/explorer\.solana\.com\/[^\s)"]+/g) ?? [];
    for (const url of urls) {
      assert.ok(url.includes("cluster=devnet"), `${rel} has non-devnet Explorer URL: ${url}`);
    }
  }
});
