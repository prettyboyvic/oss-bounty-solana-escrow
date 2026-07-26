# R4 Outer Upload Host Design

## Status and scope

This design adds a repository-owned outer execution host around
`scripts/devnet/upload-process-supervisor.mjs`. It does not authorize or run
R4N, alter uploader behavior, load a signer, acquire a lease, or perform a
write RPC. R4M remains permanently
`R4M_POST_INVOCATION_BLOCKED_PRE_LEASE_NOOP`.

## Architecture

`scripts/devnet/upload-window-host.mjs` owns five boundaries:

1. Parse a closed CLI contract and reject unsafe execution IDs or any
   `expected-invocations` value other than exactly one.
2. Verify immutable repository, state, binary, plan, candidate, process, lease,
   and finalized-buffer bindings before any child spawn. Production buffer
   verification uses the existing paced RPC scheduler.
3. Create `<result-root>/<execution-id>` with exclusive-create semantics and
   atomically persist `authorization.json`. The durable directory is the
   consumed execution-ID marker and is never removed.
4. Spawn the inner supervisor once without a shell, stream complete stdout and
   stderr to separate files, persist `invocation.json` from the child's actual
   `spawn` event, and independently enforce the outer monotonic timeout and
   bounded owned-process-tree cleanup.
5. Parse the final sanitized supervisor JSON envelope and atomically persist
   `host-result.json` only after child close, log closure, and cleanup.

The host exposes dependency-injection seams for Git/process checks, finalized
buffer verification, spawning, clocks/timers, cleanup, and filesystem failure
tests. Production defaults remain closed and fail before spawn.

## Candidate-evidence contract

Canonical evidence uses schema `R4_CANDIDATE_EVIDENCE_V1` and exact top-level
field order `schema`, `stateSha256`, `binarySha256`, `planFingerprint`,
`candidateCount`, `candidates`. Each candidate uses exact field order `index`,
`offset`, `length`, `payloadSha256`, `serializedTransactionBytes`,
`expectedState`, `expectedSignature` and appears in ascending index order.
Integers are base-10 JSON integers, a missing signature is JSON `null`, strings
use JSON escaping, and serialization has no whitespace or trailing newline.
The hash input is UTF-8 `R4_CANDIDATE_EVIDENCE_V1`, a NUL byte, then canonical
JSON. Duplicate, unsorted, missing, extra, or malformed fields are rejected.

The historical digest
`6554cbe1ad09b9e621a709dde9c4fb2f59404a8d2a8551a133552fe2ef345180`
is `LEGACY_NON_REPRODUCIBLE`; it is not accepted as a new manifest binding.

## Complete deadline contract

The exact components are `innerRuntimeTimeoutMs`, `innerCleanupTimeoutMs`,
`childLifecycleTimeoutMs`, `outerCleanupAllowanceMs`,
`finalizationTimeoutMs`, and `hostTotalTimeoutMs`. Inner values are parsed from
the actual nested supervisor command. Before spawn the host requires:

```text
childLifecycleTimeoutMs > innerRuntimeTimeoutMs + innerCleanupTimeoutMs
hostTotalTimeoutMs > childLifecycleTimeoutMs + outerCleanupAllowanceMs + finalizationTimeoutMs
hostTotalTimeoutMs > innerRuntimeTimeoutMs + innerCleanupTimeoutMs + outerCleanupAllowanceMs + finalizationTimeoutMs
```

The host timeline begins immediately before its single spawn; verification,
authorization persistence, and final local revalidation are pre-spawn. The
child watchdog owns child lifecycle. Outer termination is graceful, escalates
halfway through the outer cleanup allowance, and fails at its full bound.

The inner supervisor starts its runtime timer immediately before child spawn.
At timeout it begins graceful owned-tree cleanup, force-escalates halfway
through its explicit cleanup bound, and emits after child close or the cleanup
deadline. Configured values, timer origin, actual elapsed times, and cleanup
verdict are machine-readable.

Finalization covers stdout/stderr closure, terminal parsing, complete log
hashing, result construction, atomic write/fsync/rename, directory flush, and
durable preparation of the terminal envelope. The persisted record is
pre-emission; stdout follows durable persistence. Synchronous Node filesystem
calls cannot be cancelled mid-call, so each is checked immediately before and
after against the monotonic deadline. Any observed overrun is overwritten
fail-closed as `HOST_FINALIZATION_TIMEOUT`.

## RPC request deadline contract

The live command supplies positive integer `rpc-request-timeout-ms`.
Scheduler attempts preserve the 500 ms request-start gap and existing
2000/5000 ms retry backoffs. Retry-safe reads may retry rate limits or
`RPC_REQUEST_TIMEOUT`; other failures do not gain retries. Every operation
receives an `AbortSignal`, and no attempt begins when the remaining operation
deadline cannot fit its timeout plus required cleanup. A timed-out write,
especially `SEND_RAW_TRANSACTION`, is never resent and remains ambiguous for
read-only reconciliation. Telemetry records duration and a timeout count.
Solana Web3 methods that do not accept an abort signal may still settle their
transport promise later; the scheduler stops waiting at the bound and treats a
write that does so as ambiguous rather than claiming transport cancellation.

## Durable evidence and outcomes

Every execution that reaches child spawn normally contains:

- `authorization.json`
- `invocation.json`
- `supervisor-stdout.log`
- `supervisor-stderr.log`
- `host-result.json` when final persistence succeeds

The directory itself is the durable single-use marker. Therefore it remains
evidence of consumption even if a filesystem failure prevents one of the JSON
records from being persisted.

`host-result.json` records schema version, public authorization bindings,
sanitized command, host/child PIDs, spawn count, wall and monotonic timing,
timeout/interrupt/cleanup state, parsed terminal result status, log paths,
sizes and hashes, normalized verdict, exit code, error summary, and
`retryOccurred: false`.

Pre-spawn failures that occur before execution-ID consumption return a
terminal envelope with `childSpawnCount: 0`. Once the directory is created,
the ID remains consumed even if authorization persistence, spawn, execution,
cleanup, or result persistence fails.

## Exit precedence

The deterministic precedence is:

1. log, invocation-evidence, or durable-result persistence failure;
2. finalization timeout;
3. cleanup failure;
4. host interruption;
5. outer timeout;
6. child-spawn failure;
7. malformed or missing inner terminal result;
8. nonzero child result;
9. successful child with a valid terminal result.

Manifest failure and execution-ID reuse are pre-spawn outcomes. A safe
nonzero child exit is retained in evidence, while the host uses distinct
normalized exit codes for ambiguous host failures.

## Security and safety

The host never opens the authority/keypair path. URLs are sanitized before
evidence persistence, environment values are not captured, log parsing keeps
only a bounded suffix in memory, and full logs stream directly to files.
Retained-process checks require the canonical workflow's program, buffer, and
relative or resolved state-path identities instead of rejecting unrelated Node
processes. This is intentionally conservative across repository clones: a
supervisor/uploader carrying all canonical upload identities blocks preflight,
but is never terminated by this host.
Cleanup targets only the owned child PID/process group. Graceful cleanup,
force escalation at half the allowance, and a hard failure deadline at the
full allowance are bounded by the supplied cleanup allowance. Windows
`taskkill` helpers are independently timed and unreferenced so they cannot
retain the host beyond that boundary. JSON persistence fsyncs the temporary
file before rename and fsyncs the containing directory where the platform
supports it. The execution marker's parent directory and completed log files
are also flushed before their hashes enter the durable result. The host never
retries, respawns, resumes, or reads lease telemetry as its durable terminal
evidence. If an otherwise unhandled host failure prevents durable persistence,
an emergency diagnostic is written to stderr instead of the normal terminal
envelope. It reports invocation status as unknown rather than falsely claiming
zero spawns when the host cannot prove the count.

## Testing

Deterministic tests inject fake verification, child, timer, cleanup, and
filesystem seams. A real-process fake supervisor fixture proves streamed logs,
terminal parsing, timeout cleanup, single-use IDs, and unrelated-process
isolation without invoking the uploader. Existing uploader and supervisor
tests remain unchanged.

This repair does not authorize R4N.
