# R4D-B Validation Snapshot and RPC Ledger Design

## Scope and historical boundary

R4D-B is local-only and read-only with respect to devnet. Tests may execute the upload orchestration against temporary fixtures and injected adapters, but no uploader command, real authority signer, live signing blockhash, simulation, or transaction send is permitted.

The retained R4C evidence is permanently classified as:

- `historicalMethod: METHOD_UNKNOWN`
- last guaranteed successful method: the second `GET_RENT_EXEMPTION`
- possible rate-limited class: one of the per-confirmed-record `GET_ACCOUNT_INFO` calls, or `GET_LATEST_BLOCKHASH`
- send, simulation, and confirmation excluded
- no claim about a provider quota

The independently reproducible defect is structural: the pre-send scan validates each of 223 `CONFIRMED` records by fetching the same complete buffer account again.

## Validation snapshot

Preflight captures one finalized buffer account response with context. The immutable snapshot stores account data as an immutable encoding and binds the buffer address, owner, authority, allocation, lamports, account-data SHA-256, finalized context slot, monotonic capture time, state SHA-256, binary SHA-256, and plan fingerprint.

Validation compares the complete plan and state records, rejects invalid indices, offsets, lengths, gaps, overlaps, out-of-bounds ranges, or evidence mismatches, and then compares every `CONFIRMED` range against the local binary bytes. Confirmed progress must be a contiguous prefix; equal-position counts are never used as progress.

The snapshot is reusable only inside the current validation phase. A 30-second TTL is explicit. Expiry, clock regression, state-hash drift, binary-hash drift, plan-fingerprint drift, or identity drift rejects the snapshot. It is never used for unresolved transaction reconciliation or post-send byte validation.

## Request ledger

One in-memory ledger belongs to one production command dependency set. Its method and outcome enums are closed, capacity is bounded, and timestamps come from an injected monotonic clock. Entries contain only sequence, safe method class, start/end time, duration, outcome, retry number, whether a transaction signature existed, and read/write capability.

The ledger accepts no URL, headers, payload, response body, signed bytes, account data, stack, or paths. Errors crossing the CLI boundary expose only safe classification, method class, sequence, and signature-persisted state. Normal output exposes aggregate counts only.

## Shared scheduler and retry policy

One invocation-scoped scheduler owns every production RPC start across preflight, validation, blockhash acquisition, send, confirmation, and reconciliation. It has FIFO capacity 256, concurrency one, a 500 ms minimum request-start gap, an injected monotonic clock and sleeper, explicit close/abort behavior, and no import-time timers or background work. Transaction inter-chunk delay remains an independent uploader policy.

Each attempt is recorded separately in the existing ledger. Safely classified rate-limited reads before signing may retry twice after fixed 2,000 ms and 5,000 ms backoffs. The same bounded policy applies to blockhash only before signing and to status/reconciliation reads using the same persisted signature. A before-attempt guard re-reads the local chunk checkpoint before every blockhash attempt and requires `PLANNED` with a null signature. Security, identity, genesis, response-shape, state, binary, and plan failures are never scheduler retries.

`SEND_RAW_TRANSACTION` is scheduled and recorded but never retried. Any send uncertainty retains the already persisted `SENT` record and public signature, stops the current window, and requires reconciliation. The first blockhash request must begin at least 3,000 ms after completion of the final preflight/validation RPC.

Queued requests that have not started are rejected on terminal abort. Closing an invocation waits for the active request and leaves no timer, promise, or request running after command return.

## Local and live verification boundary

Production-path local-validator tests use only temporary state and test identities. They cover normal three-chunk execution, pre-sign rate-limit recovery, blockhash exhaustion, send uncertainty, confirmation rate limiting, and interruption/resume without duplicate transactions.

Only after every local verification gate passes, one optional read-only devnet observation may use the scheduler for genesis, account, balance, rent, history, and a single contextual buffer snapshot. It may not acquire a lease, load a signer, request a signing blockhash, simulate, send, or mutate state/archive evidence.

## Verification

Failure-first tests observe the production-shaped call graph with 223 confirmed and 168 planned chunks. Before the fix they must observe 224 total buffer account reads: one preflight read plus 223 redundant validation reads. After the fix they must observe exactly one finalized buffer fetch and no signer, blockhash, send, simulation, or real filesystem mutation.

Focused tests cover snapshot topology, byte mismatch, binding drift, expiry, ledger schema, bounded memory, scheduler serialization/pacing/abort, method-class retry behavior, safe error projection, and import side effects. Full local verification includes production-path local-validator recovery, Anchor/Rust/TypeScript/format/vector/identity/CI checks. Final verification rechecks the real ignored state and archive hashes and mtimes before publication.
