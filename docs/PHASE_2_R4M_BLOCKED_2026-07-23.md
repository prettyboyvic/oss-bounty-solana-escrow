# Phase 2 R4M Blocked Report - 2026-07-23

## Verdict

`R4M_POST_INVOCATION_BLOCKED_PRE_LEASE_NOOP`

R4M invoked the uploader exactly once. The external execution boundary
terminated that process with exit code 1 at a configured one-second timeout,
before the production command acquired an upload lease. No second R4M
invocation is permitted, and no R4M success checkpoint may ever be produced.
Any future live upload window must use a separately authorized R4N gate.

## Baseline and preflight evidence

R4M began and ended at
`723e294ba6fc603cdd13283588222f329f5185b5`, with local `HEAD` and
`origin/main` equal, ahead/behind `0/0`, and a clean worktree and index.
Exact-SHA CI run
[29988229339](https://github.com/prettyboyvic/oss-bounty-solana-escrow/actions/runs/29988229339)
was successful.

The initial paced read-only preflight completed 10/10 RPC calls with a measured
minimum request-start gap of 502.2794 ms. Cooldown was 1,604 seconds. The
authority balance was 3,247,158,680 lamports, leaving 243,330,920 lamports of
headroom after the required reserve and remaining deployment allowance.

The frozen window contained exactly chunks 264-268; chunk 269 was excluded.
Canonical candidate evidence SHA-256 was
`6554cbe1ad09b9e621a709dde9c4fb2f59404a8d2a8551a133552fe2ef345180`.
Every candidate transaction serialized to 1,231 bytes against the 1,232-byte
ceiling.

Focused telemetry/runtime tests passed 78/78. The earlier R4L telemetry
remained `COMPLETE` and publishable, with canonical SHA-256
`208feebe16685c52898c71ad988bc948f8bbd8079154de465ec1bd6153af0a02`
and raw archived SHA-256
`dd18d2c1d4122f96a2fd9064d04606993b1a3d0c56e8511bde6ce704f10741e7`.

## Sole invocation boundary

The uploader invocation count was exactly one and the process exited with code
1. It did not persist an R4M execution ID, acquire a lease, retain an operation
lock, load a signer, sign a transaction, send a transaction, or attempt any
chunk. There is consequently no per-chunk R4M result.

R4M telemetry is `UNAVAILABLE`, not `INCOMPLETE` or `COMPLETE`. The process did
not reach the active-lease telemetry boundary; this is boundary absence, not
telemetry corruption. Missing telemetry must not be reconstructed or inferred.
R4M publication is `BLOCKED`.

## Post-invocation proof

Post-invocation verification performed 6/6 successful read-only RPC calls with
a minimum request-start gap of 504.2719 ms and zero
`SEND_RAW_TRANSACTION` calls. It proved:

- buffer-data SHA-256 remained
  `79f566a6d3ec79a2afae1189097d17ca728bb0125663b13c0b7bd4a3c0861c26`;
- local state SHA-256 remained
  `86096abfa50e3d5bdf54cab1f11583d06293c6d2cb912563492ceca6903e794b`;
- 264 chunks were `CONFIRMED`, 127 were `PLANNED`, and zero were `SENT` or
  `UNKNOWN`;
- chunk index 264 remained `PLANNED` with a null signature;
- R4L remained the latest execution;
- the upload-lease archive count remained 11; and
- there was no active lease, operation lock, uploader, or reconciler.

No reconciliation or release was required or run because no R4M lease existed.
No retry, replay, finalize, deploy, faucet, mint, buffer close, or escrow flow
occurred.

## Root-cause boundary

The repository command does not spawn or supervise a second uploader process.
`scripts/devnet/upload-buffer-cli.mjs` calls `executeUploadWindow` directly in
the same Node process. That execution creates an ID in memory and then awaits
the complete read-only preflight before persisting a lease; telemetry is
created only after the lease.

No one-second uploader timeout, seconds-to-milliseconds conversion, or
production uploader supervisor exists in the repository baseline. The
one-second limit was imposed by the external execution host/operator boundary.
The exact external signal and the mapping that produced exit code 1 are not
available from repository evidence and are not inferred here.

Normal startup can legitimately exceed one second. The production preflight
contains six paced RPC requests with a 500 ms minimum request-start gap, so
even zero-latency responses require at least 2.5 seconds to start all six.
The successful R4L five-chunk window took 90,450 ms.

The safe correction is an explicit repository-owned supervisor boundary with
an unambiguous millisecond timeout, strict validation, exactly-one-spawn
semantics, bounded process-tree cleanup, and fail-closed pre-lease
classification. The outer execution host must still be configured to outlive
that supervisor timeout; repository code cannot override an earlier external
kill.

## Timeout hardening

`scripts/devnet/upload-process-supervisor.mjs` adds that boundary without
changing the uploader, candidate selection, transaction construction, signer,
send, lease, state, or telemetry implementations.

The supervisor requires `--timeout-ms` and has no live default. It accepts only
safe integer milliseconds from 3,000 through 2,147,483,647. The lower bound is
an invalid-value floor derived from the six-request, 500 ms paced preflight; it
is not a recommended live timeout. The future R4N authorization must supply
the actual duration and configure the external host to outlive it.

The supervisor starts the uploader once. On timeout it terminates the owned
process tree and never retries. Absence of the lease produces
`UPLOAD_TIMEOUT_PRE_LEASE_NOOP_BLOCKED`, telemetry `UNAVAILABLE`, null
execution evidence, and no per-chunk results. An existing lease instead
produces `UPLOAD_TIMEOUT_ACTIVE_LEASE_BLOCKED` and requires preservation of
the existing reconciliation evidence.

## Offline verification

The timeout regression was implemented test-first. The initial focused command

```text
node --test tests/devnet/upload-process-supervisor.test.mjs
```

failed because the supervisor module did not yet exist. After the minimum
implementation, it passed 8/8 tests covering explicit units, invalid-value
rejection before invocation, initialization longer than one second, bounded
timeout, process-tree cleanup, no retry, both lease classifications, no
fabricated evidence, and successful-child passthrough.

The safe repository ladder then passed:

- `npm run test:devnet:unit`: 271/271;
- `node --test tests/local-validator/throttled-uploader.test.mjs`: 1/1;
- `node --test tests/local-validator/upload-execution-command.test.mjs`: 1/1;
- `powershell -ExecutionPolicy Bypass -File scripts/test-local.ps1`: 26/26;
- `cargo test --workspace`: 11/11;
- `npm run typecheck`;
- both Rust formatting checks;
- JavaScript syntax checks for all 39 `.mjs` files;
- CI YAML parsing;
- exact 2,907-byte Loader-v3 vector parity; and
- exact 395,144-byte optimized binary identity and 1,231-byte serialized
  transaction regression under the 1,232-byte ceiling.

The local machine did not have the Anchor CLI in `PATH`, so local
`anchor build` was not available. The publication CI installs pinned Anchor
0.31.1 and remains the mandatory build and exact-SHA publication gate. This
report does not claim that new CI result before it exists.
