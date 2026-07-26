# R4 Pre-selection Failure Repair Design

## Scope

Repair the probable floating-duration telemetry invariant, guarantee durable
terminal evidence for every failure after lease acquisition, and add a
repository-owned recovery path for evidence-proven dead-owner pre-selection
leases. The historical R4N cause remains narrowed rather than proven.

The repair does not change transaction construction, instructions, accounts,
signers, candidate selection, payloads, funding, RPC pacing, retries,
confirmation criteria, or outer-host exactly-once behavior.

## Canonical timing

Telemetry keeps schema `UPLOAD_EXECUTION_TELEMETRY_V2`. Elapsed monotonic
endpoints are canonical. New records derive their stored duration exactly once
from those endpoints. Incoming ledger durations are accepted only when finite,
nonnegative, and equal within a representation-derived floating-point rounding
bound; materially inconsistent values remain invalid. Existing integer records
and valid legacy V1/V2 archives remain readable.

## Post-lease lifecycle

Immediately after lease acquisition, one lifecycle guard owns all subsequent
phases. It records the current phase and counts for selection, keypair access,
blockhash requests, signing attempts, send attempts, and persisted signatures.
One catch path preserves the primary exception and safe classification.
Telemetry, observer cleanup, state terminalization, and fallback persistence
errors are appended as sanitized secondary evidence and never replace the
primary error.

Normal telemetry remains the detailed request/send/poll record. Every failed
post-lease execution additionally receives a minimal whitelisted
`terminal.json` record bound to the lease SHA, state hashes, public identities,
phase, safe code, boundary counts, and timestamps. The record contains no raw
exception text, secret path, keypair material, transaction bytes, or
credential-bearing URL.

`FAILED_PRE_SELECTION_STALE_SAFE` is emitted only when the durable boundary
counts prove zero selection, keypair access, blockhash, signing, sends, and
signatures, the state hash did not change, and no ambiguous write outcome
exists. It permits later recovery evaluation but never releases the lease.

## Durable persistence

Telemetry and terminal records use a same-directory exclusive temporary file,
file `fsync`, atomic rename, and directory `fsync` where the platform supports
directory handles. A failed write cannot create a falsely complete final
record. Existing richer evidence cannot be replaced by a regressive snapshot.

## Recovery

The existing lease framework gains read-only pre-selection reconciliation and
an explicitly acknowledged archival command. Inputs bind the exact lease,
terminal-or-legacy telemetry evidence, outer and inner execution IDs,
repository/state/buffer hashes, public identities, candidate range, and
zero-send/dead-owner assertions.

Eligibility requires a dead owner, no retained process or operation lock,
byte-exact outer evidence, unchanged canonical state and finalized buffer,
only authorized lease files, no candidate signature or `SENT`/`UNKNOWN` state,
and no send evidence. A legacy incident without `terminal.json` is eligible
only when its incomplete telemetry, outer evidence, exact repository SHA, and
persist-before-send code identity jointly prove the pre-selection boundary.

Recovery re-evaluates the evidence under the operation lock, writes a durable
hash-bound recovery record, and then atomically archives only the bound active
lease directory. Repeating the exact completed recovery is idempotent. A
different lease or authorization cannot reuse the recovery hash.

The under-lock evaluation freshly collects repository, retained-process,
state, and paced finalized-buffer observations. The outer exactly-one uploader
invocation is structurally linked to the inner lease by ordered authorization,
child-spawn, lease-start, and host-finish timestamps in addition to the
execution, state, buffer, candidate, and file hashes. The recovery hash and
receipt bind the complete pre-recovery lease-file projection. Idempotent replay
revalidates the archived file set, lease/evidence hashes, and schemas. The
original `lease.json` remains incident evidence; the durable `recovery.json`
is its terminal lifecycle marker before the atomic archive rename.

The legacy outer schema did not retain the uploader PID, so this contract
never claims direct lease-PID ancestry. It instead requires identical durable
manifest copies, the consistent host/supervisor PID chain, exactly one
uploader invocation, the ordered time interval, a dead lease PID, both
execution IDs in their respective artifacts, and all exact hashes and
zero-send observations. Missing evidence fails closed.

This repair does not authorize stale-lease recovery or another R4N invocation.
