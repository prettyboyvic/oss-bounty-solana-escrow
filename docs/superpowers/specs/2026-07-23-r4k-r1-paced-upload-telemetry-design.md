# R4K-R1 Paced Upload Telemetry Design

## Decision

Persist a canonical `telemetry.json` snapshot inside the active upload-lease
directory. Update it atomically and incrementally, then archive it through the
existing single directory rename. Keep full telemetry out of authoritative
deployment state; terminal upload-window state stores only:

```text
telemetryEvidence: {
  verdict: "COMPLETE" | "INCOMPLETE",
  sha256: "<canonical sanitized telemetry hash>"
}
```

Legacy archives without telemetry are read as `UNAVAILABLE`. No old timing is
reconstructed.

## Sanitized schema

The versioned snapshot binds one execution ID and contains:

- audit-only ISO `startedAt` and optional `finishedAt`;
- configured pre-sign, RPC-start, confirmation-poll, retry, and inter-chunk
  thresholds;
- ordered request records containing sequence, request type, retry number,
  outcome, mutation capability, signature-persisted flag, monotonic
  start/end elapsed milliseconds, duration, and audit-only ISO boundaries;
- ordered per-chunk send records with monotonic and ISO start/finish,
  duration, and measured pre-sign cooldown;
- ordered per-chunk confirmation poll start elapsed values and ISO timestamps;
- computed minimum RPC request-start and confirmation-poll gaps;
- explicit `COMPLETE` or `INCOMPLETE` verdict plus enumerated missing fields.

The file contains no RPC URL, headers, request/response body, account data,
payload, signed or serialized transaction, secret-bearing path, keypair, seed,
or credential.

## Clocks and calculations

All compliance durations and gaps derive from one nondecreasing monotonic clock
and are stored as elapsed values relative to invocation start. Wall-clock ISO
timestamps improve audit readability only and never establish compliance.
Canonical sanitized JSON uses recursively sorted object keys and stable array
order. SHA-256 is computed over the canonical form excluding no evidence
fields and is deterministic.

## Persistence and crash behavior

The execution ID, invocation clocks, and policy are established before
preflight. No lease or telemetry file is created when preflight fails.
Immediately after safe lease acquisition, the initial `INCOMPLETE` snapshot is
written and already completed preflight request entries are imported.

Subsequent completed RPC entries, pre-sign cooldown boundaries, send
start/finish boundaries, and confirmation poll starts each trigger an atomic
snapshot write. A send start is persisted before dispatch. A process crash
therefore preserves all previously committed boundaries; an unfinished
boundary remains visibly incomplete.

Every update validates the old snapshot and requires the new snapshot to be a
monotonic extension: immutable identity/policy/origin fields must match,
existing ordered records must be exact prefixes, finished fields cannot be
removed, and `COMPLETE` cannot regress. A less informative overwrite is
rejected.

## Terminal state and publication

At terminal success or failure, the snapshot records `finishedAt`, recomputes
minimum gaps, and evaluates required evidence. The upload-window state stores
only verdict and canonical telemetry hash. Publication is allowed only for
`COMPLETE` evidence whose canonical hash matches state and archive. Missing,
malformed, hash-mismatched, `INCOMPLETE`, or `UNAVAILABLE` evidence fails
closed.

Telemetry persistence failure aborts before a later signing/send boundary. If
failure occurs after a send start, normal lease reconciliation remains
required; telemetry cannot manufacture an on-chain outcome.

## Archive and compatibility

Lease release reads and validates any existing `telemetry.json`, records its
canonical hash, performs the existing atomic directory rename, then rereads the
archived file and requires identical bytes and hash. Existing archives without
the file retain their established release behavior and telemetry reads return
`UNAVAILABLE`.

No telemetry requirement changes reconciliation evidence, release
authorization, or the atomic archive semantics. The telemetry file accompanies
the lease; it is not deleted or rewritten during release.

## Transaction isolation

Instrumentation surrounds existing scheduler, cooldown, send, and confirmation
boundaries only. It does not modify Loader-v3 instruction data, account metas,
fee payer, blockhash, signer set, serialization, or transport payload. A hard
test must retain the existing 1,231-byte serialized transaction and enforce
the 1,232-byte ceiling.
