# R4N Separate-Authorization Readiness Plan

## Scope and current verdict

R4N is not executed by this plan. It is a new label and must never be treated
as an R4M retry or replay.

The separately authorized R4N attempt with outer execution ID
`6c955b77-a82d-4c0d-b8ae-e85cb28b759a` and inner execution ID
`c44e7175-9184-4324-8d6e-94f09374434c` is spent and cannot be replayed. It
failed after lease acquisition but before candidate selection. The preserved
lease remains active pending a separately authorized recovery; the recovery
command was not executed by the repair publication.

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
  --child-lifecycle-timeout-ms <authorized-child-lifecycle-milliseconds> \
  --outer-cleanup-allowance-ms <authorized-outer-cleanup-milliseconds> \
  --finalization-timeout-ms <authorized-finalization-milliseconds> \
  --host-total-timeout-ms <authorized-total-host-milliseconds> \
  --result-root .devnet/upload-window-host-results \
  --expected-repository-sha <exact-authorized-commit> \
  --expected-state-sha <fresh-state-sha256> \
  --expected-buffer-sha <fresh-finalized-buffer-sha256> \
  --expected-binary-sha <fresh-binary-sha256> \
  --expected-plan-fingerprint <fresh-plan-fingerprint> \
  --expected-candidate-evidence-sha <R4_CANDIDATE_EVIDENCE_V1-sha256> \
  --expected-candidates <fresh-inclusive-range> \
  --expected-invocations 1 \
  -- \
  <exact-node-executable> scripts/devnet/upload-process-supervisor.mjs \
    --timeout-ms <explicitly-authorized-inner-milliseconds> \
    --cleanup-timeout-ms <explicitly-authorized-inner-cleanup-milliseconds> \
    -- \
    upload-buffer-throttled <exact-R4N-uploader-arguments> \
      --rpc-request-timeout-ms <authorized-per-attempt-milliseconds>
```

The host verifies the immutable manifest before child spawn, requires
`expected-invocations = 1`, and creates
`<result-root>/<execution-id>/` with exclusive-create semantics. An execution
ID is consumed permanently once that directory is created, including after
host failure or crash. The host never retries, resumes, respawns, or starts a
replacement child.

The nested command itself binds inner runtime, inner cleanup, and RPC request
timeout. The host separately binds child lifecycle, outer cleanup, durable
finalization, and total-host values. Before spawn, code requires:

```text
CHILD_LIFECYCLE > INNER_RUNTIME + INNER_CLEANUP
HOST_TOTAL > CHILD_LIFECYCLE + OUTER_CLEANUP + FINALIZATION
HOST_TOTAL > INNER_RUNTIME + INNER_CLEANUP + OUTER_CLEANUP + FINALIZATION
```

The absolute monotonic host timeline begins immediately before the authorized
child spawn. Repository verification, authorization persistence, and final
local revalidation are explicitly pre-spawn and outside that timeline.

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

Log closure, terminal parsing, log hashing, atomic result persistence,
file/directory flush, and preparation of the pre-emission terminal envelope
are covered by the finalization allowance. Node synchronous filesystem calls
cannot be cancelled mid-call; the host checks the monotonic deadline
immediately before and after each call and overwrites provisional success
fail-closed with `HOST_FINALIZATION_TIMEOUT`. The persisted result is the
pre-emission state; stdout emission occurs only afterward.

## Canonical candidate evidence

The future manifest must use repository-produced
`R4_CANDIDATE_EVIDENCE_V1`. Canonical JSON has exact top-level order `schema`,
`stateSha256`, `binarySha256`, `planFingerprint`, `candidateCount`,
`candidates`. Candidate fields are exactly `index`, `offset`, `length`,
`payloadSha256`, `serializedTransactionBytes`, `expectedState`,
`expectedSignature`, in ascending index order. Integers use base-10 JSON
integer syntax; null is literal `null`; there is no whitespace or newline.
SHA-256 input is UTF-8 `R4_CANDIDATE_EVIDENCE_V1`, one NUL byte, then the
canonical JSON bytes. Duplicate, malformed, unsorted, missing, or extra fields
fail closed.

The historical digest
`6554cbe1ad09b9e621a709dde9c4fb2f59404a8d2a8551a133552fe2ef345180`
is `LEGACY_NON_REPRODUCIBLE` and must not be used by R4N. The
repository-generated digest for the unchanged baseline candidates 264-268 is
`9b77aa9af1f5885f20eb914f5fed6fb352f1b58e68767e2ed85ee5b85ed8ad44`.
This is non-authorizing repair evidence only and must be recomputed after the
repair commit.

## RPC timeout and retry safety

The live uploader CLI requires `--rpc-request-timeout-ms`. Every scheduler
attempt has a finite monotonic duration bound and receives an `AbortSignal`;
transports that support it terminate the underlying request. Timeout is
`RPC_REQUEST_TIMEOUT`, distinct from rate limiting and other RPC/transport
errors. Retry-safe reads retain the existing two retries and 2000/5000 ms
backoffs. An attempt cannot start if its timeout plus required cleanup does not
fit the supplied operation deadline.

Web3 transports that do not accept an abort signal can settle later in the
background; the scheduler still stops awaiting them at the bound. A write in
that state is ambiguous and is never treated as cancelled or safe to resend.

`SEND_RAW_TRANSACTION` is never retried after timeout. Its persisted signature
remains an ambiguous outcome eligible only for the existing read-only
reconciliation path. Telemetry V2 retains per-request duration and the derived
`requestTimeoutCount`; legacy V1 telemetry remains readable.

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
7. Record all six host/supervisor timeout components plus the RPC request
   timeout and prove the complete arithmetic above.
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

- the structured retained-process-classifier repair must be pushed;
- exact-SHA CI for that repair commit must complete successfully;
- the repository must remain clean and synchronized afterward.
- a new read-only authorization pass must recompute every manifest binding,
  cooldown/funding fact, and exact timeout value against that commit.

The later R4N authorization must additionally supply the exact supervisor and
outer-host timeout values, both cleanup allowances, finalization allowance,
total deadline, request timeout, canonical candidate digest, execution ID,
result root, and
approve the one bounded live invocation. This plan and implementation supply
no such authorization.

## Rejected pre-child authorization

Execution ID `ddf6f16e-7556-43d8-9875-9b3371ad524e` was used by the one
authorized outer-host attempt and is permanently
`AUTHORIZATION_SPENT_PRE_CHILD`. The host returned
`HOST_MANIFEST_REJECTED`/64 before creating a durable execution directory and
reported child spawn count zero. The technical substatus is
`R4N_HOST_MANIFEST_REJECTED_PRE_CHILD`: no supervisor, uploader, signer, lease,
signed transaction, or sent transaction existed.

The rejection was a retained-process false positive. Raw command-line
substring matching saw the complete future command inside the PowerShell
parent's `-Command` argument. It did not prove that PowerShell was the Node
outer host, supervisor, or uploader. Parent/ancestor exclusion alone is not a
valid repair because a real retained role may itself be a parent or ancestor.

The gate must instead use structured process metadata, Windows-aware argv
parsing, Node executable identity, and the exact repository entrypoint at
`argv[1]`. Only after role proof may program, buffer, and state identities
establish a workflow conflict. Metadata that exposes a canonical entrypoint
but lacks executable proof fails closed with bounded sanitized diagnostics; a
transient Node record with no entrypoint evidence is not a positive or a
suspicious candidate. The read-only gate never terminates processes.

Publication of this repair does not revive the spent execution ID. Any future
R4N preparation requires a new read-only pass, a fresh authorization manifest,
and a new execution ID.

This repair does not authorize R4N.

## Pre-selection failure repair

The incident retained one incomplete telemetry request and no send/signature
evidence. Fractional elapsed-duration validation is the probable reproducible
failure class, but the deliberately sanitized public error cannot prove a
unique historical cause. The absence of durable terminal evidence and the
lack of an evidence-bound pre-selection cleanup path were proven defects.

The repair derives telemetry duration from monotonic endpoints with a bounded
floating representation check, installs a post-acquire lifecycle guard, writes
whitelisted terminal evidence on failure, and adds separate read-only
reconciliation and acknowledged archival recovery commands. It does not
change transaction construction, instruction/account/signer selection,
pacing, retry, confirmation, or outer-host exactly-once behavior.

Publication of this repair does not authorize recovery, replay, a new R4N
window, or any devnet write. Recovery must first run the exact read-only
pre-selection reconciliation command against fresh evidence, then receive
separate authorization for its returned recovery hash.
