# R4N Separate-Authorization Readiness Plan

## Scope and current verdict

R4N is not executed by this plan. It is a new label and must never be treated
as an R4M retry or replay.

Readiness is `BLOCKED` until the timeout-hardening commit is pushed and its
exact-SHA CI completes successfully. After that gate passes, the readiness
verdict becomes `READY_FOR_SEPARATE_AUTHORIZATION`; live execution still
requires a new explicit authorization.

## Mandatory supervisor boundary

The future operator must invoke the repository-owned supervisor, not the
uploader entrypoint directly:

```text
node scripts/devnet/upload-process-supervisor.mjs \
  --timeout-ms <explicitly-authorized-milliseconds> \
  -- \
  upload-buffer-throttled <exact-R4N-uploader-arguments>
```

The timeout has no live default. The R4N authorization must state the exact
integer millisecond value. Values below 3,000 ms, zero, negative, fractional,
overflowed, or unit-suffixed values are rejected before uploader invocation.
The 3,000 ms bound is only a strict invalid-value floor derived from paced
preflight startup; it is not a recommended live duration.

The external execution host must have a separately explicit timeout greater
than the supervisor timeout plus cleanup allowance. Repository code cannot
override an earlier host kill. Both values and their units must be recorded in
the R4N gate before invocation.

## R4N gate

A separately authorized R4N session must:

1. Start from clean, synchronized `main`, with `HEAD = origin/main`, ahead and
   behind `0/0`, no staged or untracked work, and successful exact-SHA CI for
   the timeout-hardening commit.
2. Prove there is no uploader, validator, reconciler, active upload lease, or
   operation lock.
3. Run fresh paced read-only RPC preflight without loading the signer.
4. Recalculate cooldown, balance, remaining funding requirement, reserve, and
   headroom from fresh evidence.
5. Recompute the binary identity, state identity, plan fingerprint, ordered
   candidate evidence, and serialized transaction sizes.
6. Select exactly chunks 264-268 only if state still contains 264 confirmed
   chunks, 127 planned chunks, zero `SENT`, zero `UNKNOWN`, and chunk index 264
   remains `PLANNED` with a null signature. Otherwise stop before signer load.
7. Record explicit inner-supervisor and outer-host timeout values in
   milliseconds and prove the outer boundary outlives the inner boundary.
8. Invoke the supervisor exactly once. Never retry, replay, re-sign, resend, or
   start a second child after success, error, timeout, rate limit, or ambiguity.
9. Treat a pre-lease timeout as blocked/no-op with telemetry `UNAVAILABLE`.
   Preserve any actual active lease and evidence if timeout occurs after lease
   acquisition.
10. Reconcile exactly once only if an actual lease exists. Apply only exact
    freshly proven transitions under separate authorization, and release only
    from `SAFE_TO_RELEASE` evidence.
11. Publish an R4N checkpoint only when terminal state and complete telemetry
    agree, the canonical telemetry hash validates, archive preservation is
    exact, the safe verification ladder passes, and exact-SHA publication CI
    succeeds.

## Permanent prohibitions

R4M remains `R4M_POST_INVOCATION_BLOCKED_PRE_LEASE_NOOP`; R4N must not alter,
reconstruct, or upgrade its `UNAVAILABLE` telemetry. R4N must not use an R4M
label, retry or replay R4M, or claim R4M success. No finalize, deploy, buffer
close, faucet, mint, DEVTEST, or escrow flow is authorized by this plan.

## Remaining blockers

Before `READY_FOR_SEPARATE_AUTHORIZATION`:

- the timeout-hardening commit must be pushed;
- its exact-SHA CI must complete successfully; and
- the repository must remain clean and synchronized afterward.

The later R4N authorization must additionally supply the exact supervisor and
outer-host timeout values and approve the one bounded live invocation. This
plan supplies no such authorization.
