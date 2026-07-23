# R4K-R1 Paced Upload Telemetry Implementation Plan

**Goal:** Persist complete, sanitized, crash-resilient timing evidence for
future bounded upload windows without changing Solana transactions or opening
a live window.

**Architecture:** A dedicated telemetry module owns a versioned canonical
snapshot under the active lease directory. Existing scheduler/uploader
boundaries feed it monotonic events. Terminal state stores only verdict/hash;
release verifies the file survives the existing atomic archive rename.

## Constraints

- No uploader, live devnet write, signer load, blockhash request, transaction,
  R4L, finalize, deploy, close, faucet, mint, or escrow flow.
- TDD: each behavior begins with a focused failing test.
- Existing archives remain valid and report telemetry `UNAVAILABLE`.
- No implementation/test-pass claim belongs in the preceding documentation
  commit.

## Tasks

1. **Telemetry schema, sanitizer, canonical hash, and monotonic updates**
   - Add focused tests for whitelist validation, deterministic hash ordering,
     `COMPLETE`/`INCOMPLETE`/`UNAVAILABLE`, legacy reads, and rejection of
     record regression or secret-bearing values.
   - Add the smallest standalone telemetry module and make those tests pass.

2. **Incremental scheduler/uploader instrumentation**
   - Add failing deterministic tests for complete five-chunk evidence,
     preflight/request import, measured cooldown, send boundaries, RPC minimum
     gap, confirmation-poll minimum gap, and partial evidence after an injected
     process failure.
   - Expose safe request-boundary observation and wire the execution recorder
     without changing request policy or transaction construction.

3. **Terminal reference and fail-closed publication gate**
   - Add failing tests for terminal state verdict/hash, missing/malformed/hash
     mismatch rejection, and explicit incomplete publication denial.
   - Persist only the reference in the upload window and implement the local
     evidence evaluator.

4. **Release/archive preservation**
   - Add failing tests proving telemetry bytes/hash survive archive, a reduced
     overwrite is rejected, archive failure remains recoverable, and old
     no-telemetry archives remain idempotently readable.
   - Add pre/post archive verification without changing reconciliation or
     release authorization.

5. **Transaction and full regression**
   - Assert exact serialized length 1,231 and ceiling 1,232.
   - Run focused telemetry/scheduler/uploader/lease/contract/state suites, full
     devnet tooling, local-validator suites without a retained validator,
     integration, TypeScript, Rust, formatting, vectors, binary identity,
     YAML, diff/link/secret checks, and ignored-runtime scope checks.

6. **Publication**
   - Stage only implementation, tests, and this plan's completed checkboxes if
     updated.
   - Run `git diff --check`, secret scan, exact staged-path review, and prove
     no `.devnet` file is staged.
   - Commit as `fix(devnet): persist paced upload timing evidence`, push only
     when all gates pass, and verify CI for the exact pushed SHA.
