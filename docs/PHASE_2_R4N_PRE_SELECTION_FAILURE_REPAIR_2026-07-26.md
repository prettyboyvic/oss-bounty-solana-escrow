# Phase 2 R4N Pre-selection Failure Repair

## Historical finding

Forensic verdict: `R4N_FORENSIC_ROOT_CAUSE_NARROWED`.

The one R4N outer-host execution
`6c955b77-a82d-4c0d-b8ae-e85cb28b759a` spawned the inner execution
`c44e7175-9184-4324-8d6e-94f09374434c` exactly once. It exited nonzero after
lease acquisition. The preserved telemetry contains exactly one successful
read-only `GET_GENESIS_HASH` request, no send record, no confirmation poll,
no expected candidate, no persisted signature, and verdict `INCOMPLETE`.
Canonical deployment state remained unchanged.

The narrowest proven failure interval is telemetry replay request sequence 2:
request sequence 1 was durably present, while no later selection or write
boundary was recorded.

The fractional duration values reproduce a class of exact floating-point
equality failure. Because the historical public error was intentionally
reduced to `COMMAND_FAILED_SAFE`, this is the probable narrowed cause, not a
claim that the unique historical stack was recovered. Two defects are proven:
post-acquire failure did not durably record its terminal boundary, and there
was no evidence-bound cleanup path for a dead-owner pre-selection lease.

Both execution IDs are spent. Replay, retry, resign, resend, or relabeling the
attempt is forbidden.

Historical root-cause classification:
`PROBABLE_FLOATING_DURATION_INVARIANT`.

## Published repair contract

- Monotonic elapsed endpoints are canonical for timing. ISO timestamps remain
  audit-only.
- Request duration is derived once from endpoints. Supplied duration must be
  finite, nonnegative, and equivalent within a representation-derived
  floating-point bound.
- Telemetry remains schema `UPLOAD_EXECUTION_TELEMETRY_V2`, canonical,
  sanitized, incremental, non-regressive, and durably persisted.
- One guard begins immediately after lease acquisition and counts candidate
  selection, keypair access, blockhash requests, signing attempts, send
  attempts, and persisted signatures.
- Every post-lease failure attempts a whitelisted `terminal.json`. A
  pre-selection stale-safe classification requires all counters zero,
  unchanged state SHA, and no ambiguous write.
- Primary failure code/phase remains authoritative. Telemetry, cleanup, state
  evidence, and fallback persistence errors are secondary bounded codes.
- No transaction instruction, account, signer, payload, serialized bytes,
  pacing, retry, confirmation, or outer-host exactly-once behavior changes.
  The hard regression remains 1,231 bytes under the 1,232-byte ceiling.

## Incident evidence retained and untouched

At the repair baseline:

- repository SHA:
  `8f4702c1ba7f0e797a2568dac0badfb69f57f137`;
- state SHA-256:
  `86096abfa50e3d5bdf54cab1f11583d06293c6d2cb912563492ceca6903e794b`;
- binary SHA-256:
  `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`;
- finalized buffer data SHA-256:
  `79f566a6d3ec79a2afae1189097d17ca728bb0125663b13c0b7bd4a3c0861c26`;
- lease SHA-256:
  `645b2cbb0623faa060b64f62bfe4c81726b149d4c459eef891a37a9c9060c9b4`;
- telemetry file SHA-256:
  `7836a3275593c72f60885bc93647259a3f9efdb6f27abcd16aab4af38c902dde`.

The real lease directory remains active with only `lease.json` and
`telemetry.json`. No real recovery/reconciliation command, uploader,
supervisor, host, signer load, blockhash request, transaction signing/send, or
devnet write was used to implement or test this repair.

## Two-step recovery interface

The first command is read-only. Its exact arguments bind the canonical RPC,
program, buffer, state, binary, active lease path, outer evidence directory,
lease/evidence SHA-256 values, outer/inner IDs, repository/state/finalized
buffer hashes, authority, candidate indexes, and literal `true` assertions for
zero-send and dead-owner evidence:

```text
node scripts/devnet/upload-buffer-cli.mjs reconcile-pre-selection-upload-lease
  --url <canonical-devnet-rpc>
  --program <canonical-program>
  --buffer <preserved-buffer>
  --state .devnet/state.json
  --binary target/sbf-solana-solana/release/oss_bounty_escrow.so
  --lease-path .devnet/state.json.upload-lease
  --outer-evidence-directory .devnet/upload-window-host-results/<outer-id>
  --expected-lease-sha <lease-sha256>
  --expected-evidence-sha <terminal-or-legacy-telemetry-file-sha256>
  --expected-outer-execution-id <outer-id>
  --expected-inner-execution-id <inner-id>
  --expected-repository-sha <exact-commit>
  --expected-state-sha <state-sha256>
  --expected-buffer-sha <finalized-buffer-data-sha256>
  --expected-authority <canonical-authority>
  --expected-candidates 264,265,266,267,268
  --expected-zero-send true
  --expected-dead-owner true
```

Only a fresh `RECOVERY_ELIGIBLE` result supplies the recovery hash. The
mutation command repeats every binding and adds:

```text
recover-pre-selection-upload-lease
  <all exact reconciliation arguments>
  --recovery-hash <fresh-exact-recovery-hash>
  --acknowledge-pre-selection-recovery R4_RECOVER_PRE_SELECTION_LEASE
```

Recovery rechecks under the shared operation lock, persists a hash-bound
`recovery.json` before mutation, atomically archives only the bound lease, and
verifies archived byte hashes. The under-lock pass freshly re-reads repository,
process, state, and paced finalized buffer observations rather than reusing the
read-only eligibility snapshot. The recovery hash and receipt bind the complete
pre-recovery lease-file projection; idempotent replay revalidates that archived
projection. The original `lease.json` stays byte-identical, while the durable
`recovery.json` is the terminal lifecycle marker written before the single
active-to-archive rename. Recovery never edits `.devnet/state.json` and never
writes on-chain. Neither command shown above was executed during this repair.

The historical outer schema does not persist the uploader PID, so no direct
lease-PID ancestry claim is possible. Legacy attribution therefore requires
the complete conservative conjunction: matching outer/inner IDs in their own
artifacts, dead lease PID, exact lease/evidence hashes, identical host
manifest copies, consistent host/supervisor PID chain, exactly one uploader
invocation, ordered authorization/spawn/lease/finish timestamps, unchanged
state/finalized buffer, and no retained process or send evidence. Any missing
or mismatched component is ineligible.

## Authorization boundary

Publishing code and tests does not authorize the read-only incident pass, the
recovery mutation, or another live upload window. Each requires its own
explicit future authorization. R4N remains blocked; R4L and earlier historical
claims are unchanged.

This repair does not authorize stale-lease recovery or another R4N invocation.
A separate recovery authorization is required after publication, and a
completely new R4 authorization is required after recovery.
