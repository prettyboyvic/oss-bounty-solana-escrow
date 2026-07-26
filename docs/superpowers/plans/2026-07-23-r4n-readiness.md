# R4N Separate-Authorization Readiness Plan

## Scope and current verdict

R4N is not executed by this plan. It is a new label and must never be treated
as an R4M retry or replay.

The inner timeout-hardening gate has passed. The repository now owns the outer
host implementation, but this implementation does not authorize R4N.
R4N remains `R4N_NOT_READY` until the outer-host commit is pushed, exact-SHA CI
passes, and a new read-only authorization-preparation pass selects fresh
manifest bindings and timeout values for that exact commit.

## Mandatory outer-host boundary

The future operator must invoke the repository-owned outer host. Direct
invocation of either the uploader or inner supervisor is forbidden:

```text
node scripts/devnet/upload-window-host.mjs \
  --execution-id <separately-authorized-single-use-id> \
  --outer-timeout-ms <explicitly-authorized-outer-milliseconds> \
  --cleanup-allowance-ms <explicitly-authorized-cleanup-milliseconds> \
  --result-root .devnet/upload-window-host-results \
  --expected-repository-sha <exact-authorized-commit> \
  --expected-state-sha <fresh-state-sha256> \
  --expected-buffer-sha <fresh-finalized-buffer-sha256> \
  --expected-binary-sha <fresh-binary-sha256> \
  --expected-plan-fingerprint <fresh-plan-fingerprint> \
  --expected-candidates <fresh-inclusive-range> \
  --expected-invocations 1 \
  -- \
  <exact-node-executable> scripts/devnet/upload-process-supervisor.mjs \
    --timeout-ms <explicitly-authorized-inner-milliseconds> \
    -- \
    upload-buffer-throttled <exact-R4N-uploader-arguments>
```

The host verifies the immutable manifest before child spawn, requires
`expected-invocations = 1`, and creates
`<result-root>/<execution-id>/` with exclusive-create semantics. An execution
ID is consumed permanently once that directory is created, including after
host failure or crash. The host never retries, resumes, respawns, or starts a
replacement child.

The outer timeout is enforced by repository code using a monotonic timer. It
must be strictly greater than the inner timeout plus the explicit cleanup
allowance. All values have no live default and must be selected by the later
authorization in integer milliseconds. The earlier `879500`, `5000`, and
`889500` values remain unapproved proposals and are not embedded in the host.

Durable host evidence is outside the upload-lease lifecycle:

```text
<result-root>/<execution-id>/authorization.json
<result-root>/<execution-id>/invocation.json
<result-root>/<execution-id>/supervisor-stdout.log
<result-root>/<execution-id>/supervisor-stderr.log
<result-root>/<execution-id>/host-result.json
```

`.devnet/state.json.upload-lease/telemetry.json` is not the durable host
result. `host-result.json` is written atomically only after child cleanup and
both log streams close.

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
8. Invoke the outer host exactly once with a new single-use execution ID. The
   host may spawn the inner supervisor at most once. Never retry, replay,
   re-sign, resend, or start a second child after success, error, timeout, rate
   limit, interruption, cleanup failure, or ambiguity.
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

- the outer-host implementation commit must be pushed;
- exact-SHA CI for that commit must complete successfully;
- the repository must remain clean and synchronized afterward.
- a new read-only authorization pass must recompute every manifest binding,
  cooldown/funding fact, and exact timeout value against that commit.

The later R4N authorization must additionally supply the exact supervisor and
outer-host timeout values, cleanup allowance, execution ID, result root, and
approve the one bounded live invocation. This plan and implementation supply
no such authorization.
