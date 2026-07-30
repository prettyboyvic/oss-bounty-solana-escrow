# Screenshot & Video Capture Checklist (operator step)

> Live execution code SHA: `e4547ea75a13ebd7ee96ef5c91bc7071017950d6`
> Current reviewed code SHA: `4544c3403b7acb0630d2aeb1c1388226f3187c51`
> Historical manifest hash: `8ee0247a0a4df05efe8a7bec73dc9025b0430d8f8ef10adec02ddebd17d13016`
> Execution-spec hash: `6eef9c1959792ba6b111a0b1cd4259e70c6e2f72e74d68034e3d92cc4f3531ac`
> Execution ID: `exec-4c6cce10-2f17-4a51-896d-79a2569107d0`
> Cluster: devnet (`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`)

These assets are **not yet captured**. Capture from historical finalized Explorer evidence and the sanitized receipt; do **not** re-run the matrix. Sanitize before sharing: no keypairs, no local absolute paths, no OS username, no unrelated desktop content.

Save each PNG under `docs/evidence/assets/screenshots/` using the exact filename below, then record its SHA-256 in `docs/evidence/assets/ASSET_INVENTORY.json` (regenerate is not automatic for binaries — update the inventory's per-asset `sha256` and `status`).

## Screenshots

| # | Filename | Target | Source | What to show |
|---|----------|--------|--------|--------------|
| 1 | `01-program-account.png` | Program account | https://explorer.solana.com/address/6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z?cluster=devnet | Executable, owned by the upgradeable loader; Devnet cluster visible. |
| 2 | `02-programdata.png` | ProgramData account | https://explorer.solana.com/address/GSLxCPBrBFwAhyCTUpMGKGeqvUQWD1YkZG9ssXp1kPBs?cluster=devnet | ProgramData with retained upgrade authority; Devnet cluster visible. |
| 3 | `03-deterministic-mint.png` | Deterministic mint account | https://explorer.solana.com/address/6dGuA5C7hh8kHgcUHc9uT97ecAw9Z7eTUa6rtakQaAMr?cluster=devnet | Mint initialized, decimals 6; Devnet cluster visible. |
| 4 | `04-release-transaction.png` | Release transaction | https://explorer.solana.com/tx/2PCHamg34n3VyfH6F3knSShHYTM6j79de1Rk76qbeH8VX34pL1FaiNgVXwu9kDU36wsqsCZzsfTbpci1ta8jSbCW?cluster=devnet | Success; fee payer maintainer; Devnet cluster visible. |
| 5 | `05-release-escrow-released.png` | Release escrow (Released) | https://explorer.solana.com/address/eYZqDuBoDqkMirew1LPBnxynCGPENoZq6z5g7AkLHfc?cluster=devnet | Escrow account in Released state; vault drained. |
| 6 | `06-refund-transaction.png` | Refund transaction | https://explorer.solana.com/tx/2nfC3oweH8i3S74J2CKwX65otDHX3tzSyzuwdViMjwuJvXsJgqPjpxRnK3W9bht93tMCWcLJYgJyxtSFKJ7J3qyr?cluster=devnet | Success; fee payer sponsor; Devnet cluster visible. |
| 7 | `07-refund-escrow-refunded.png` | Refund escrow (Refunded) | https://explorer.solana.com/address/9CqmJ8Eb8nxPoPHfzXHuHimgcTLgrV2JvhGK7vjAJfVF?cluster=devnet | Escrow account in Refunded state; vault drained. |
| 8 | `08-cancel-transaction.png` | Cancel transaction | https://explorer.solana.com/tx/3RhLMJ8SJzehKkEiroXbnZthjaWRRoudbcDQ2P6XFQ8W56WpgyrMVJWgaujVB14HTAB4ug8StZDuKcvgyKtaXfxa?cluster=devnet | Success; fee payer sponsor; Devnet cluster visible. |
| 9 | `09-cancel-escrow-cancelled.png` | Cancel escrow (Cancelled) | https://explorer.solana.com/address/Hn1nBPj2X91GDmquVWFeFZj9Spf8sx3KCuQhaHsEbMDb?cluster=devnet | Escrow account in Cancelled state. |
| 10 | `10-contributor-ata.png` | Contributor ATA balance | https://explorer.solana.com/address/AsrnmfH1CBhWyFXQJeDdQK12KGcESqK3EaamywXgP4NW?cluster=devnet | Token balance 1000000 base units (from release payout). |
| 11 | `11-sponsor-ata.png` | Sponsor ATA balance | https://explorer.solana.com/address/3uwyoGTkBNKvx82StNvpasA7wVuToM5R9LF9oFBmG2vp?cluster=devnet | Token balance 2000000 base units (minted minus release, plus refund). |
| 12 | `12-negative-simulations.png` | Three negative simulation proofs | sanitized report | From docs/evidence/LIVE_VERIFICATION_REPORT.md: the three EXPECTED_ERROR simulations — ConstraintHasOne (Custom 2001), EscrowNotExpired (Custom 6008), EscrowExpired (Custom 6007). |
| 13 | `13-integrity-provenance.png` | Evidence integrity & dual-SHA provenance | terminal | Terminal: `sha256sum` of the receipt equals the inventory hash, plus `git log` showing the live execution SHA and the funding-repair commit (dual-SHA provenance). |

Cropping, annotation, and redaction are permitted only for clarity/privacy and must not change evidence meaning. Do not alter screenshots to fabricate data.

## Video (see docs/evidence/VIDEO_SCRIPT.md for the full script)

Record ~2–4 minutes from the same historical finalized evidence; do not re-run the matrix. Narration must not claim mainnet readiness, persistence/recovery, production security, a formal audit, or that current HEAD produced the live transactions.
