# Submission Narrative

> Live execution code SHA: `e4547ea75a13ebd7ee96ef5c91bc7071017950d6`
> Current reviewed code SHA: `4544c3403b7acb0630d2aeb1c1388226f3187c51`
> Historical manifest hash: `8ee0247a0a4df05efe8a7bec73dc9025b0430d8f8ef10adec02ddebd17d13016`
> Execution-spec hash: `6eef9c1959792ba6b111a0b1cd4259e70c6e2f72e74d68034e3d92cc4f3531ac`
> Execution ID: `exec-4c6cce10-2f17-4a51-896d-79a2569107d0`
> Cluster: devnet (`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`)

## Short (form-ready)

A neutral pre-funded OSS-bounty escrow prototype on Solana devnet. One canonical business-flow demonstration (execution `exec-4c6cce10-2f17-4a51-896d-79a2569107d0`) completed end-to-end: deterministic mint setup, release payout to the contributor, refund to the sponsor after on-chain expiry, and cancel before funding — plus three attributed negative simulations (unauthorized release, refund-before-expiry, release-after-expiry). All 16 events reached their expected terminal state (COMPLETE); 12 transactions are finalized on devnet. Evidence is bound to an immutable receipt (SHA-256 `f18b2daecd963cb3213693d11143d7e6c3e1c980e343058031fdb81dbf41fef1`). Devnet only; no mainnet, no real-value assets, no formal audit.

## Detailed (for reviewer)

### What the prototype does

- Locks an exact classic SPL-token amount in a per-escrow vault.
- **Release**: the configured maintainer pays out the amount to the contributor before expiry.
- **Refund**: the sponsor recovers the amount at or after on-chain expiry.
- **Cancel**: the sponsor cancels an initialized-but-unfunded escrow.

### Canonical trust path

- A frozen execution spec (hash `6eef9c1959792ba6b111a0b1cd4259e70c6e2f72e74d68034e3d92cc4f3531ac`) defines 16 ordered events; the client authorizes only this spec, not arbitrary transactions.
- Instructions are built solely through the canonical registry/factory and validated against per-event schemas before signing.
- A deterministic mint (`6dGuA5C7hh8kHgcUHc9uT97ecAw9Z7eTUa6rtakQaAMr`) is derived by seed, avoiding an ephemeral mint signer.
- Per-payer funding: the sponsor funds setup and both escrows; the maintainer pays only the release transaction; the contributor and mint authority are non-payer signers only.
- An append-only receipt timeline binds each event to the spec hash and records BUILT→SUBMITTED→CONFIRMED→VERIFIED for sends.

### Negative simulations (read-only, attributed)

- `unauthorized_release` → ConstraintHasOne (Custom 2001), escrow-originated at instruction index 0.
- `refund_before_expiry` → EscrowNotExpired (Custom 6008), escrow-originated at instruction index 0.
- `release_at_or_after_expiry` → EscrowExpired (Custom 6007), escrow-originated at instruction index 0.

### Provenance and the funding repair

- The live matrix ran at `e4547ea75a13ebd7ee96ef5c91bc7071017950d6`. Independent review accepted the business-flow evidence and flagged a planner fee undercount (per-transaction rather than per-signature).
- Repair `4544c3403b7acb0630d2aeb1c1388226f3187c51` corrects only the funding projection. It does not change transaction bytes, signer sets, event ordering, the executor, or receipt semantics, so the existing live evidence remains valid and no second live run is required.

### Evidence links

- Machine-readable manifest: `docs/evidence/evidence-manifest.json`
- Live verification report: `docs/evidence/LIVE_VERIFICATION_REPORT.md`
- Explorer transaction index: `docs/evidence/EXPLORER_INDEX.md`
- Capture checklist (screenshots/video, operator step): `docs/evidence/CAPTURE_CHECKLIST.md`

### Limitations

- Solana devnet only; not deployed to mainnet and handles no real-value assets.
- One completed execution (exec-4c6cce10). No persistence, resume, or recovery machinery is claimed or exercised across host restarts.
- No formal security audit; not production-security hardened.
- The program is deployed upgradeable with a retained loader upgrade authority (governance choice); this is distinct from any in-program upgrade instruction (there is none).
- The client harness authorizes only the frozen canonical execution spec; it is not a generic arbitrary-spec signer.
- This package is submission-candidate evidence pending final independent review; screenshot/video assets are a pending operator capture step.
- The full deterministic mint seed is withheld by policy; only the public mint address is published.
