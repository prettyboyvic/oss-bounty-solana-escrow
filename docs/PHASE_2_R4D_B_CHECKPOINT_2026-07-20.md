# Phase 2-R4D-B RPC pacing checkpoint — 2026-07-20

R4D-B removes the confirmed-chunk read amplification and adds invocation-scoped RPC pacing without opening an upload window. No devnet transaction was signed, simulated, or sent.

## Historical conclusion

The R4C rate-limited method remains irrecoverably:

- `historicalMethod: METHOD_UNKNOWN`
- last guaranteed success: the second `GET_RENT_EXEMPTION`
- possible class: one of the per-confirmed-record `GET_ACCOUNT_INFO` calls, or `GET_LATEST_BLOCKHASH`
- send, simulation, and confirmation excluded
- no claim about provider quota

The independently reproduced structural defect was 224 buffer reads in the validation phase: one preflight read plus 223 per-record full-buffer reads. The corrected phase uses one finalized contextual buffer snapshot to validate all 223 confirmed byte ranges: `224 → 1`.

## Snapshot and scheduler contract

The immutable validation snapshot binds buffer address, owner, authority, allocation, lamports, complete account-data SHA-256, finalized slot, monotonic capture time, state SHA-256, binary SHA-256, and plan fingerprint. It is reusable only within one validation phase, expires after 30 seconds, and fails closed on clock, state, binary, plan, identity, range, topology, or byte drift. It is never reused for post-send or reconciliation evidence.

One production invocation owns one FIFO scheduler and one bounded ledger:

- concurrency: 1
- queue and ledger capacity: 256
- minimum request-start gap: 500 ms
- minimum final-preflight-to-blockhash cool-off: 3,000 ms
- read-only rate-limit attempts: initial, retry after 2,000 ms, retry after 5,000 ms, then terminal
- blockhash retry: only while a fresh before-attempt guard still observes `PLANNED` and a null signature
- send: exactly one attempt for a persisted public signature; never automatically retried
- confirmation/reconciliation: bounded reads of the same signature, with no re-sign, resend, or next-chunk progress

The ledger schema is closed to monotonic sequence, safe method class, start/end monotonic timestamps, duration, outcome, retry number, signature-persisted flag, and read/write capability. It stores no URL, headers, body, request payload, signed bytes, account data, stack, or path. Public errors expose only safe classification, method class, sequence, and signature-persisted state.

## Failure-first and local verification

Observed RED evidence included the 224-versus-1 production call-count assertion, missing snapshot/ledger/scheduler APIs, a raw preflight 429 with no bounded retry, missing production scheduler ownership, and blockhash state drift continuing to the retry bound. The final results were:

- scheduler focused: 6/6
- focused ledger/snapshot/uploader/CLI/command set: 66/66 before the final guard addition
- full devnet tooling after the final guard: 221/221
- state v3: 24/24; state plus migration: 29/29
- local-validator interruption/resume: 1/1
- production local-validator scenarios A–F: 1/1
- Rust workspace: 11/11
- IDL-build identity tests: 8/8
- escrow local-validator integration: 26/26
- TypeScript typecheck, root/tool rustfmt, loader-vector parity, workflow YAML, program identity, and `git diff --check`: passed
- optimized SBF: 395,144 bytes, SHA-256 `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`

Scenario A completed and archived a three-chunk test-only upload with one validation snapshot, persisted-before-send state, exact confirmation/bytes, scheduler pacing, and cool-off. B retried a pre-sign account read exactly twice before success. C exhausted blockhash retries with zero signature, `SENT`, or send and released as a zero-write outcome. D made one send call, preserved the signature, stopped, reconciled, and released. E polled only the same signature, did not resend or advance, and reconciled from finalized bytes. F destroyed the in-memory runtime, reloaded state, skipped confirmed chunks, and sent no duplicate transaction.

## One read-only devnet observation

After all local gates passed, exactly one scheduler-backed observation used `https://api.devnet.solana.com`. It made 11 successful read calls and zero rate-limited/error calls. The minimum observed request-start gap was 500.0864 ms; observed concurrency was one.

| Evidence | Before | After | Result |
| --- | ---: | ---: | --- |
| Authority balance | 3,247,363,680 | 3,247,363,680 | unchanged |
| Buffer history count | 224 | 224 | unchanged; zero new signatures |
| Buffer data SHA-256 | `5ead93a84d55d9eca4c33517847a20903e7a19aa9a00fa45fa0a7f8f75ce4554` | same | unchanged |
| Buffer finalized slot | 477498878 | 477498889 | read-only observations |
| Program account | absent | absent | unchanged |
| Confirmed/planned chunks | 223 / 168 | 223 / 168 | one validation snapshot |
| Real state and R4B/R4C audit files | captured hash/mtime set | exact same set | unchanged |

The request ledger recorded: one `GET_GENESIS_HASH`, four `GET_ACCOUNT_INFO`, two `GET_BALANCE`, two `GET_RENT_EXEMPTION`, two `GET_SIGNATURE_HISTORY`, and zero blockhash, status, transaction, simulation, or send calls. No lease was acquired and no signer was loaded.

## Preserved local evidence

The real state remains 223 `CONFIRMED`, 168 `PLANNED`, zero `SENT/UNKNOWN`, with SHA-256 `507432a0e941126c09757375d9602493daa9d1d6e2a5daf5675068386fa9e6c0`, mtime `2026-07-19T13:23:40.3892482Z`, and no active lease. R4B/R4C lease and release hashes and mtimes remain unchanged. Focused scans found no private-key array, mnemonic field, credentialized RPC URL, or new secret; the only secret-bearing path matches are explicit negative-test canaries. All five parked repositories remain clean at their recorded audited HEADs.

## Proposed later live policy

If a separately reviewed phase ever authorizes another bounded upload, retain the existing five-chunk ceiling and 1,000 ms inter-chunk delay, plus scheduler concurrency one, 500 ms request-start spacing, 3,000 ms pre-sign cool-off, two bounded rate-limit read retries, no send retry, persisted-before-send state, exact confirmation/byte reconciliation, and stop-on-first uncertainty. This checkpoint does not authorize that execution.
