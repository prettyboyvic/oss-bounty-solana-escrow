# Phase 2-R4D-D scheduler timing checkpoint — 2026-07-20

R4D-D corrects RPC scheduler timing and finalized-confirmation polling without opening another upload window. All execution in this phase was unit-test or local-validator execution with generated test identities. No devnet blockhash, simulation, send, signer load, or state/archive mutation occurred.

## Preserved R4D-C facts

The historical conclusion is `cause not uniquely recoverable`. R4D-C retained ledger timestamps but did not separately retain scheduler grant and actual RPC invocation timestamps, so the 499.2464 ms observation cannot be uniquely assigned to an early timer wake, rounding, or the pre-operation timestamp boundary.

The R4D-C record remains unchanged:

- configured global gap: 500 ms;
- minimum observed actual gap: 499.2464 ms;
- three finalized transactions;
- 46 `GET_SIGNATURE_STATUSES` requests, including eight rate-limited status requests;
- no send retry;
- terminally clean state and lease;
- historical R4C method: `METHOD_UNKNOWN`;
- no claim about provider quota.

## Scheduler timing correction

Previously, the scheduler slept once for the computed remainder and trusted that sleep to reach the target. It retained a timestamp before ledger work and operation invocation. The first failure-first probes observed a second start at 499 ms, repeated early wakes, missing shared boundary metadata, and no fail-closed clock-regression path.

The corrected sequence is:

1. FIFO admission remains bounded and concurrency remains one.
2. Compute `earliestStart = previousActualStart + 500` and any later per-request not-before floor.
3. Re-read the same monotonic clock and sleep only a positive remainder until `now >= earliestStart`.
4. Inside the ledger, assign the next sequence, resample that monotonic clock immediately before calling the operation, and use the sample for ledger start and scheduler `lastRequestStartMs`.
5. Notify external observers only after the operation has started. Observer failure cannot abandon the request: the request is awaited, its real ledger outcome is retained, queued work is rejected, and the scheduler drains terminally without retry.
6. Read-only retries wait from the preceding completion for 2,000 ms and then 5,000 ms, while still satisfying the global actual-start gap. Send remains single-attempt.

There is no epsilon workaround. Deterministic tests allow exactly 500 ms and wait again at 499 ms, repeated early wakes, and 499.999 ms. The deterministic minimum was exactly 500 ms. The final eight-call real-timer stress run measured a minimum operation-start gap of 500.0556 ms.

Independent review first reproduced a 450 ms operation-start gap despite 500 ms recorded timestamps, then reproduced an observer exception that could abandon an active promise. Both findings were corrected. Final independent adversarial review passed with one active request, one queued request, pending close, ledger `SUCCESS`, queued rejection, and drained terminal status.

## Confirmation polling correction

Normal confirmation polling now has a separate 2,000 ms actual-attempt-start floor while remaining inside the shared scheduler. A rate-limited status request uses only the existing bounded 2,000/5,000 ms retry schedule; the next normal poll is constrained from the latest retry attempt, so retry and normal timers cannot overlap or burst.

Only `finalized` status or an explicit transaction error is terminal. A `confirmed` status cannot advance a chunk. The same persisted signature is used for every poll; there is no re-sign, resend, or next-chunk send before terminal status and a fresh exact-byte read.

The sanitized public policy is:

```json
{
  "globalRequestStartGapMs": 500,
  "confirmationPollIntervalMs": 2000,
  "rateLimitRetryScheduleMs": [2000, 5000]
}
```

The deterministic three-transaction, approximately 13-second fixture used 21 status requests instead of the historical 46. The final local-validator three-chunk scenario used 12 status requests; all three transactions finalized, all bytes matched, and each transaction was sent exactly once.

## Failure-first and final verification

RED was observed before implementation for early 499 ms and repeated early wakes, a timestamp recorded before operation invocation, missing invocation observer/ledger APIs, clock regression, sub-2,000 ms normal confirmation polling, post-retry polling burst, `confirmed` as terminal, and exact bytes advancing without finalized post-send evidence. Independent review added two adversarial RED probes for stale boundary timing and observer-failure abandonment.

Final GREEN evidence:

- complete devnet tooling: 237/237;
- scheduler and ledger focused suite: 25/25;
- state v3 focused suite: 24/24;
- production local-validator upload/recovery suite: 1/1;
- local-validator interruption/resume suite: 1/1;
- Anchor-compatible local integration: 26/26;
- Rust workspace: 11/11;
- IDL-build identity: 8/8;
- TypeScript, root/tool rustfmt, loader-vector parity, workflow YAML, canonical identity, and `git diff --check`: passed;
- optimized SBF: 395,144 bytes, SHA-256 `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`.

The production local-validator suite injected an early wake, preflight/status rate limits, confirmation timeout, and abort during a paced wait. It proved exact three-chunk bytes, global minimum 500 ms, 3,000 ms pre-sign cool-off, concurrency one, no send retry, no duplicate send, no next-chunk advancement after uncertainty, fresh reconciliation, and clean lease archives. The timeout fixture retained `[UNKNOWN, PLANNED]` after one send; abort prevented RPC invocation, signer load, send, and lease acquisition.

## No-mutation and hygiene evidence

The real state remained 226 `CONFIRMED`, 165 `PLANNED`, zero `SENT/UNKNOWN`, with SHA-256 `bee372e99019b35b30d2801eb927cf343411b848ba2f99d7f89650928de62481`, length 112,514, and mtime `2026-07-20T01:05:27.2393423Z`. All six R4B/R4C/R4D-C lease and release files retained their exact Gate 0 SHA-256 and mtimes. There was no active lease or uploader process.

`.devnet/` remained ignored and untracked. Focused added-line scans found no mnemonic, seed phrase, private-key array, credentialized RPC URL, signed transaction bytes, or new secret-bearing path. All five parked repositories remained clean at their audited HEADs and ahead/behind `0/0`.

## Published implementation scope

Implementation commit `d4ad4847a0e8b3299e58fd3efc11622ee7ef0239` contains:

- `scripts/devnet/rpc-request-ledger.mjs`
- `scripts/devnet/rpc-request-scheduler.mjs`
- `scripts/devnet/throttled-uploader.mjs`
- `scripts/devnet/upload-execution-command.mjs`
- `scripts/devnet/upload-execution-contract.mjs`
- `tests/devnet/rpc-request-ledger.test.mjs`
- `tests/devnet/rpc-request-scheduler.test.mjs`
- `tests/devnet/throttled-uploader.test.mjs`
- `tests/devnet/upload-buffer-cli-safety.test.mjs`
- `tests/devnet/upload-execution-command.test.mjs`
- `tests/devnet/upload-execution-contract.test.mjs`
- `tests/local-validator/throttled-uploader.test.mjs`
- `tests/local-validator/upload-execution-command.test.mjs`
- `docs/superpowers/plans/2026-07-20-r4d-d-scheduler-timing-confirmation-polling.md`

## Proposed next live window — not executed

A separately authorized bounded window could retain five chunks, 1,000 ms inter-chunk delay, 500 ms literal global RPC start gap, 2,000 ms normal confirmation floor, 3,000 ms pre-sign cool-off, bounded read retries, persisted-before-send state, no send retry, finalized status plus fresh exact-byte reconciliation, and stop-on-first uncertainty. R4D-D does not authorize or execute that window.
