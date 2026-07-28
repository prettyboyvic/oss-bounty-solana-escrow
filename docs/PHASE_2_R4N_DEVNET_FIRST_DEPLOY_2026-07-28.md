# Phase 2 R4N — Devnet First Deployment (upgradeable, retained authority)

Separately authorized single-invocation first deployment of the escrow program to
devnet from the completed upload buffer. Governance decision **A — RETAIN UPGRADE
AUTHORITY** (`Avfvs1k6…`). No immutable conversion, no authority transfer/revocation,
no upgrade, no buffer-close recovery action, no business-flow testing performed.

## Governance decision applied

- Operator-selected: **A — retain upgrade authority**; intended upgrade authority
  `Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk`.
- `solana program set-upgrade-authority --final` was **not** run; upgrade authority
  was neither transferred nor revoked.

## Pre-deploy preflight (independently verified, directly measured)

- HEAD = origin/main = remote = `cdff4d6684dcd826bc37ae811ab83344f400f71c`; `0/0`; clean; no git op locks.
- exact-SHA CI `30316619807` (headSha `cdff4d6…`) = success.
- upload state `391 CONFIRMED / 0 PLANNED / 0 SENT / 0 UNKNOWN`; prefix 391;
  state SHA `05a1def974277117fe3948fd980ef997f6ec37f313056628e2a875b2d83e33a9`;
  plan fingerprint `a5e631b1…`.
- binary `target/sbf-solana-solana/release/oss_bounty_escrow.so`, length 395144,
  SHA `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`.
- buffer `CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW`: owner loader, executable false,
  loader-state tag 1 (Buffer), authority `Avfvs1k6…`, allocation 395181, lamports 2751406320;
  extracted payload (data minus 37-byte metadata) byte-identical to the local binary.
- program account `6UoYT4jt…` and ProgramData PDA `GSLxCPBr…` both **absent** (clean first deploy).
- program keypair derives `6UoYT4jt…` matching `config/devnet.json` and `Anchor.toml`.
- deployment-authority pubkey == buffer authority; keypair, fee-payer and upgrade-authority
  roles are intentionally the same keypair `Avfvs1k6…`.
- authority balance 3246523680 lamports; buffer lamports 2751406320 == ProgramData rent
  (deficit 0); program-account rent 1141440; fresh authority cost ~1.15M lamports; headroom > 3.24 SOL.
- Solana CLI 2.2.20 (Agave). Local devnet unit suite 379/379.
- No active lease, operation lock, uploader, validator or conflicting process.
- Stale local `.devnet/state.json` buffer label `BUFFER_WRITING` did not block the
  authoritative byte-comparison finalize path and was **not** modified.

## The single authorized deploy invocation

Rendered by the repository's authoritative `buildFinalizeBufferCommand`
(`scripts/devnet/deploy.mjs`); sanitized argument vector (keypair bytes never read/printed):

```
solana program deploy \
  --url https://api.devnet.solana.com --use-rpc \
  --keypair   .devnet/deployment-authority.devnet-keypair.json \
  --fee-payer .devnet/deployment-authority.devnet-keypair.json \
  --program-id .devnet/program.devnet-keypair.json \
  --buffer CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW \
  --upgrade-authority .devnet/deployment-authority.devnet-keypair.json \
  --max-len 395144 --output json
```

- invocation count: **1** (no retry).
- start `2026-07-28T00:45:17.636Z`, finish `2026-07-28T00:45:19.893Z`; exit code `0`.
- CLI JSON: `programId 6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z`,
  `signature 4dJrk1HNCxk5SeLcMvuegsfc7TXRTGvYzSFvC1JziTvrgRhkfXL1Ymye9thMkZAETvJF5BuHeU4aWf6FLQuQNYhc`.
- stderr empty; no intermediate/recovery address emitted.
- durable receipts: `.devnet/deploy-receipts/{stdout.json,stderr.txt,exitcode.txt,timestamps.txt}` (gitignored).

Success was **not** inferred from exit code alone; it was confirmed by direct on-chain observation below.

## Deployment acceptance (directly observed on-chain)

- **Program account** `6UoYT4jt…`: owner `BPFLoaderUpgradeab1e…`, executable `true`,
  loader-state tag 2 (Program), data length 36, points to ProgramData `GSLxCPBr…` (linkage correct).
- **ProgramData account** `GSLxCPBr…` (PDA of `[programId]` under the loader): owner
  `BPFLoaderUpgradeab1e…`, tag 3 (ProgramData), deployed slot 479386086, upgrade-authority
  option set, **upgrade authority `Avfvs1k6…`**, data length 395189.
- **Deployed payload**: extracted using the authoritative loader-state layout
  (offset 45 = tag 4 + slot 8 + option 1 + pubkey 32, derived from the observed account,
  not hard-coded); length 395144; SHA
  `f0820f1f06e5ffcb64026ae3c748b47b6e64674333f3ca98e8e468717c668fcd`
  = local binary SHA; byte-identical (`Buffer.compare === 0`); no trailing padding
  (ProgramData sized exactly `45 + 395144` via `--max-len 395144`).
- **Buffer disposition**: `CT1DGjkt…` closed/consumed (absent after deploy) — expected
  `DeployWithMaxDataLen` semantics; its lamports moved into ProgramData.
- **Balance/rent accounting**: authority `3246523680 → 3245372240` (Δ −1151440 =
  program-account rent 1141440 + ~10000 tx fee); ProgramData lamports 2751406320
  (= former buffer lamports); program-account lamports 1141440. Internally consistent.
- No unexpected account or authority change.

## Recovery classification

`classifyBufferLifecycle` equivalent: program executable + exact binary match →
`PROGRAM_DEPLOYED / action NONE / retryEligible false`. No retry performed or needed.

## Validation

Code unchanged (only gitignored `.devnet` mutated on disk; tracked tree clean).
Post-deploy devnet unit suite 379/379. Historical `378/1` anomaly did not recur
(root cause remains UNPROVEN).

## Not performed / not claimed

No immutable conversion; no `set-upgrade-authority --final`; no authority
transfer/revocation; no program upgrade; no buffer close as an independent recovery
action; no business-flow testing; no tooling/code/test change; no second deploy
invocation; no secret-key inspection. The program is deployed and upgradeable with
authority `Avfvs1k6…`; no claim of business-logic correctness is made here.

## Recommended next phase (separately authorized)

Business-flow acceptance testing of the deployed escrow program (initialize/deposit/
release/refund paths) against devnet, as a separately authorized phase with its own
funded test accounts and evidence.
