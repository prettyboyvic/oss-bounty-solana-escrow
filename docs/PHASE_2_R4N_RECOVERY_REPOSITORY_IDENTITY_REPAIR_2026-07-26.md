# Phase 2 R4N Recovery Repository-Identity Repair

Status: `R4_RECOVERY_REPOSITORY_IDENTITY_REPAIR_PUBLISHED` (code/test/docs only).

This repair does **not** recover the stale lease, does not run any
reconciliation, recovery, uploader, supervisor or outer host, and does not
touch the retained incident evidence, lease, telemetry, state or finalized
buffer. A separate live authorization is still required (see the end of this
document).

## Defect: the recovery path was unreachable

The published two-step pre-selection recovery interface
(`reconcile-pre-selection-upload-lease` → `recover-pre-selection-upload-lease`)
conflated two distinct repository identities behind a single expected value.

1. `collectRecoveryRepositorySha` (CLI) requires the caller's
   `--expected-repository-sha` to equal the **live** clean `HEAD`, which must
   also equal `origin/main`, with a clean tracked worktree and `0/0`
   ahead/behind. At the published repair baseline that live SHA is:

   `4b9b1ff52433d1aebb699dd2d007f74fae409636`

2. `readOuterPreSelectionEvidence` (lease module) compared that **same**
   expected value against the frozen authorization manifest's
   `expectedManifest.expectedRepositorySha`, which is the historical
   incident-time SHA captured when the failed upload window was authorized:

   `8f4702c1ba7f0e797a2568dac0badfb69f57f137`

Because the repository correctly advanced past the incident commit to the
reviewed publication commit, **no single `--expected-repository-sha` value
could satisfy both checks simultaneously**. The mismatch was raised as a
generic thrown error inside `reconcilePreSelectionUploadLease` and collapsed by
the outer `catch` into `reason: "INSUFFICIENT_EVIDENCE"`, hiding the specific
semantic conflict. The prior authorized read-only session observed exactly:

```json
{ "command": "reconcile-pre-selection-upload-lease", "result": "RECOVERY_INELIGIBLE",
  "reason": "INSUFFICIENT_EVIDENCE", "lifecycle": "RECONCILIATION_REQUIRED",
  "stateMutation": false, "onchainWrite": false }
```

## Design: two explicit repository identities

Repository identity is now split into two independent roles.

- **Historical incident repository identity** — the SHA frozen when the failed
  invocation was authorized. It is immutable evidence. It stays bound to the
  existing authorization manifest, outer invocation/host-result evidence, and
  the existing evidence hashes. It is **not** required to equal the live SHA.
  The caller binds it explicitly via the new
  `--expected-incident-repository-sha`, and it is verified to equal the frozen
  `manifest.expectedRepositorySha`. The retained authorization/evidence files
  were **not** edited, regenerated or re-pinned.

- **Live recovery repository identity** — the SHA whose reviewed code is
  executing the recovery. It remains bound to `--expected-repository-sha` and
  keeps every existing live gate: clean tracked worktree/index,
  `HEAD == origin/main`, exact expected live SHA, `0/0` ahead/behind.

### Mandatory ancestry safety relationship

The repair does not permit arbitrary repository transitions. The historical
incident SHA must be a Git ancestor of the live recovery SHA, checked with the
exact semantics of `git merge-base --is-ancestor <incident> <live>` in
`collectIncidentRepositoryAncestry`:

- exit `0` → ancestor (equal SHAs count as an ancestor — a same-commit recovery
  remains valid);
- exit `1` → not an ancestor → rejected;
- any other exit / signal / spawn error → fails closed.

The exact live SHA binding is preserved; this is **not** a generic
"any newer commit is acceptable" rule. A forward or unrelated transition (live
SHA not descended from the incident SHA) is rejected.

## Precise failure classification

Known repository-identity validation failures no longer collapse into the
generic `INSUFFICIENT_EVIDENCE` bucket. A dedicated `PreSelectionEvidenceError`
carries a precise reason surfaced by the reconcile result:

- `INCIDENT_REPOSITORY_IDENTITY_MISMATCH` — the caller's expected incident SHA
  does not equal the frozen manifest's `expectedRepositorySha` (wrong incident
  binding or tampered manifest repository SHA).
- `HISTORICAL_REPOSITORY_NOT_ANCESTOR` — the incident SHA is not a Git ancestor
  of the live recovery SHA.

The existing live-SHA gate continues to reject via `OBSERVATION_MISMATCH`
(observed live HEAD ≠ expected live SHA) at the pure-function boundary, and via
the CLI's `collectRecoveryRepositorySha` hard error (`COMMAND_FAILED_SAFE`) for
dirty worktree / `HEAD ≠ origin/main` / wrong expected live SHA. Unexpected
parser, filesystem or evidence-read exceptions still fail closed as
`INSUFFICIENT_EVIDENCE`. No secrets, keypair bytes, transaction bytes or
credential-bearing URLs are added to any error.

## Schema / versioning decision

`UPLOAD_PRE_SELECTION_RECOVERY_V1` is **unchanged**. The historical and live
identities are already bound cryptographically through the recovery-hash
projection: the recovery hash covers the complete `expected` object, which now
includes both `repositorySha` (live) and `incidentRepositorySha` (historical),
and the persisted `recovery.json` receipt binds that recovery hash. No
whitelist/receipt key set required a rename, so the published exact-whitelist
schema was not modified in place. The `--expected-repository-sha` flag keeps its
existing meaning (live recovery SHA); a new, unambiguously named
`--expected-incident-repository-sha` flag carries the historical binding.

## RED evidence

A focused regression exercising the real repository-identity decision boundary
(distinct incident SHA `9…9`, live SHA `a…a`, incident is an ancestor, all
other bindings valid) failed on the pre-repair code:

```
✖ distinct historical incident and live recovery repository SHAs are eligible when incident is an ancestor
✖ the recovery hash binds both the historical incident and live recovery repository identities
✖ repository-identity failures surface precise reasons instead of a generic bucket
   actual reason: INSUFFICIENT_EVIDENCE   expected: HISTORICAL_REPOSITORY_NOT_ANCESTOR
```

## GREEN evidence

After the repair:

- `tests/devnet/upload-preselection-recovery.test.mjs` — all pure-function
  cases pass, including distinct incident/live eligibility, recovery-hash
  binding of both identities, and precise `HISTORICAL_REPOSITORY_NOT_ANCESTOR`
  / `INCIDENT_REPOSITORY_IDENTITY_MISMATCH` / `OBSERVATION_MISMATCH` reasons.
- `tests/devnet/upload-buffer-cli-safety.test.mjs` — real temporary Git
  repositories prove the live gates (clean `HEAD == origin/main`, wrong live
  SHA rejected, dirty worktree rejected, `HEAD` ahead of `origin/main`
  rejected) and the ancestry helper (incident ancestor → true, equal → true,
  forward transition → false).
- Full devnet unit suite: **379 / 379** (was 374; +5 tests). `tsc --noEmit`
  clean. JavaScript syntax checks clean.

The unchanged dead-owner, zero-send, retained-process, operation-lock, state,
buffer, candidate and outer-evidence gates continue to reject their respective
tampering scenarios; the identity split does not weaken any of them.

## Toolchain note

Anchor is not installed on this host, so the Anchor local-validator integration
suite, random-port integrations and optimized SBF build / serialized-transaction
size check were not run locally. They are unaffected by this JavaScript-only
change to the recovery tooling (no Rust, Anchor program or `.ts` sources were
touched) and are verified by the authoritative exact-SHA CI run. The
serialized-transaction size and vector-parity assertions that live in the
devnet unit suite are included in the passing 379.

## Safety confirmation

- No `reconcile-pre-selection-upload-lease` was executed in this repair session.
- No `recover-pre-selection-upload-lease` (recovery mutation) was executed.
- No uploader, supervisor or outer-host invocation was executed.
- No transaction was constructed, signed or sent; no devnet write occurred.
- The retained lease directory still contains exactly `lease.json` and
  `telemetry.json`; state, binary, lease, telemetry and outer evidence hashes
  are unchanged.

## Authorization still required after publication

This repair only makes the recovery path reachable for the valid
historical/live SHA pair. It does **not** authorize the live operation. After
this repair is published and exact-SHA CI succeeds, a separate explicit
authorization is required to run, in order and once each:

1. `reconcile-pre-selection-upload-lease` (read-only) — now supplying
   `--expected-repository-sha 4b9b1ff…` (live) and
   `--expected-incident-repository-sha 8f4702c…` (historical);
2. `recover-pre-selection-upload-lease` (single stale-lease recovery mutation),
   only on a fresh `RECOVERY_ELIGIBLE` result;
3. and, only afterward, a completely new R4 authorization for one uploader
   window.
