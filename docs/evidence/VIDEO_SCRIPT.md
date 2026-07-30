# Video Script — Canonical Business-Flow Demonstration (devnet)

> Live execution code SHA: `e4547ea75a13ebd7ee96ef5c91bc7071017950d6`
> Current reviewed code SHA: `4544c3403b7acb0630d2aeb1c1388226f3187c51`
> Historical manifest hash: `8ee0247a0a4df05efe8a7bec73dc9025b0430d8f8ef10adec02ddebd17d13016`
> Execution-spec hash: `6eef9c1959792ba6b111a0b1cd4259e70c6e2f72e74d68034e3d92cc4f3531ac`
> Execution ID: `exec-4c6cce10-2f17-4a51-896d-79a2569107d0`
> Cluster: devnet (`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`)

Production-ready script for a manual operator recording. Suggested length ~3 minutes. Use historical finalized Explorer evidence and the sanitized package only — **do not re-run the matrix**. The recording is a walkthrough of existing evidence, not a new live execution.

## Shot list & narration

| Time | Shot | Narration |
|------|------|-----------|
| 0:00–0:20 | Title card / README | Purpose: a neutral pre-funded OSS-bounty escrow prototype on Solana devnet. Devnet only, no real-value assets. This is a walkthrough of a completed demonstration. |
| 0:20–0:40 | Program on Explorer (6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z) | Program deployed on devnet, executable, upgradeable loader; ProgramData GSLxCPBrBFwAhyCTUpMGKGeqvUQWD1YkZG9ssXp1kPBs. Canonical execution-spec hash 6eef9c1959792ba6b111a0b1cd4259e70c6e2f72e74d68034e3d92cc4f3531ac. |
| 0:40–0:55 | Deterministic mint (6dGuA5C7hh8kHgcUHc9uT97ecAw9Z7eTUa6rtakQaAMr) | Mint derived by seed (no ephemeral mint signer), decimals 6, initialized. |
| 0:55–1:20 | Release tx 2PCHamg34n3V… + release escrow | Maintainer releases the locked amount before expiry; escrow becomes Released; contributor ATA receives the payout. |
| 1:20–1:35 | Unauthorized-release negative proof | Read-only simulation rejected with ConstraintHasOne (Custom 2001). |
| 1:35–2:05 | Refund flow (before-expiry proof, WAIT, refund tx 2nfC3oweH8i3…) | Before expiry, refund is rejected with EscrowNotExpired (6008). The run WAITs on authoritative chain time (REACHED); after expiry, release is rejected with EscrowExpired (6007) and the sponsor refund succeeds; escrow becomes Refunded. |
| 2:05–2:20 | Cancel flow (cancel tx 3RhLMJ8SJzeh…) | Sponsor cancels an initialized-but-unfunded escrow; escrow becomes Cancelled. |
| 2:20–2:40 | Final accounting | Token accounting: minted 3000000 = contributor 1000000 + sponsor 2000000; all vaults drained to 0. |
| 2:40–2:55 | Integrity & provenance | Immutable receipt SHA-256 f18b2daecd963cb3213693d11143d7e6c3e1c980e343058031fdb81dbf41fef1. Live matrix ran at e4547ea75a13ebd7ee96ef5c91bc7071017950d6; the funding repair 4544c3403b7acb0630d2aeb1c1388226f3187c51 changed only the fee projection (per-transaction → per-signature), so the live evidence stays valid and no second live run was required. |
| 2:55–3:00 | Limitations | Devnet only; no mainnet, no persistence/recovery, no formal audit, no production-security claim. |

## Narration guardrails

Do NOT claim: mainnet readiness; a formal audit; persistence/recovery; production security; a live transaction at the post-repair SHA; or that the video is itself a new live execution.
