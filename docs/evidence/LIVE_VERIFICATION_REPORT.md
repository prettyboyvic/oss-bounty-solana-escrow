# Live Verification Report — Canonical Business-Flow Demonstration

> Live execution code SHA: `e4547ea75a13ebd7ee96ef5c91bc7071017950d6`
> Current reviewed code SHA: `4544c3403b7acb0630d2aeb1c1388226f3187c51`
> Historical manifest hash: `8ee0247a0a4df05efe8a7bec73dc9025b0430d8f8ef10adec02ddebd17d13016`
> Execution-spec hash: `6eef9c1959792ba6b111a0b1cd4259e70c6e2f72e74d68034e3d92cc4f3531ac`
> Execution ID: `exec-4c6cce10-2f17-4a51-896d-79a2569107d0`
> Cluster: devnet (`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`)

## Dual-SHA provenance

- **Live matrix executed at** `e4547ea75a13ebd7ee96ef5c91bc7071017950d6`. The 12 on-chain transactions below were produced by that code.
- Independent review verdict: **LIVE_EVIDENCE_ACCEPTED_WITH_TARGETED_FIX_REQUIRED**.
- Review found a planner fee undercount (per-transaction instead of per-signature).
- Targeted repair `4544c3403b7acb0630d2aeb1c1388226f3187c51` changes only the funding projection — not transaction bytes, signer sets, event ordering, the executor, or receipt semantics.
- Funding-repair verdict: **TARGETED_FUNDING_REPAIR_ACCEPTED**; second live execution required: **no**.
- The historical manifest hash `8ee0247a0a4df05efe8a7bec73dc9025b0430d8f8ef10adec02ddebd17d13016` is immutable evidence at the live SHA and is **not** reproduced by current code.

## Result

Final status: **COMPLETE** (12 SEND / 3 SIMULATE / 1 WAIT). All 16 canonical events terminal and expectation-satisfied.

## Canonical events

| # | Event | Kind | Terminal state | Signature / detail |
|---|-------|------|----------------|--------------------|
| 0 | setup:create_mint | SEND | VERIFIED | `Lxc43Kps9TBFHAZHJbpGz8EGebmCzVrP32NYvAzBCzhSXDC7BXLYGysiLEXzH8tFWtd8MKYdHgE8teBaETNXuMt` |
| 1 | setup:sponsor_ata | SEND | VERIFIED | `3sFhg2tJabXcwt6eHXYc3HyC7Hx76CLJVUn4sxnjUZHiLPvEBFGDZNEvjSWJPAM86HV4fCsWsz9EpauphZFjgxDT` |
| 2 | setup:contributor_ata | SEND | VERIFIED | `4nEm2BEu1qna4NS8yqszhz3abSaWdRAppFJRMVHomq6y1M7RTDXTYxbvo9SCUE4R1wCTSuSBPNH8fkdjszvyCQdA` |
| 3 | setup:mint_tokens | SEND | VERIFIED | `3j2KY4ZwxH2rhLDqAepmVY9ZLdkMFfn5e4EKYZ6nnTdosrpyW47QztghdkogyACuFFo68CnBTQPUHbk6xfiQM3M7` |
| 4 | release:initialize | SEND | VERIFIED | `5ahktwo1BLX5Ad5XTfkYuWUDmnsufqFqKoePY8Goqs9EgtxK44pxnFvB7zSB8WjHuqyKwQqvqHwtxMp1GNTLLoe1` |
| 5 | release:fund | SEND | VERIFIED | `56jFWeznsor22sfq6EYHfxH1e6jmZH6tBPKAgiNyLpThdrMkKjcryE9ex1bS4oGMgjK59DWfuvQGP71D7ptzeMFK` |
| 6 | unauthorized_release | SIMULATE | EXPECTED_ERROR | ConstraintHasOne (Custom 2001, ix 0) |
| 7 | release:release | SEND | VERIFIED | `2PCHamg34n3VyfH6F3knSShHYTM6j79de1Rk76qbeH8VX34pL1FaiNgVXwu9kDU36wsqsCZzsfTbpci1ta8jSbCW` |
| 8 | refund:initialize | SEND | VERIFIED | `5sHA1yRjQpB8FwqGUDN4fBPuPiYrBrUPsg9Zf6M28FYFqvxkdGdPiAwcNv9RDuwxTtGMbu9rdJyNa7LoYCWtqWgK` |
| 9 | refund:fund | SEND | VERIFIED | `44NTdR3TDNmQhu9JxoGExw8RPyiL5qppkbje3NTkSN9SHJUMjRGztLoDmqQZ6wq1RwAgfsjY1sfAFusxnYDYAneu` |
| 10 | refund_before_expiry | SIMULATE | EXPECTED_ERROR | EscrowNotExpired (Custom 6008, ix 0) |
| 11 | refund:wait_expiry | WAIT | WAIT_REACHED | REACHED |
| 12 | release_at_or_after_expiry | SIMULATE | EXPECTED_ERROR | EscrowExpired (Custom 6007, ix 0) |
| 13 | refund:refund | SEND | VERIFIED | `2nfC3oweH8i3S74J2CKwX65otDHX3tzSyzuwdViMjwuJvXsJgqPjpxRnK3W9bht93tMCWcLJYgJyxtSFKJ7J3qyr` |
| 14 | cancel:initialize | SEND | VERIFIED | `M8ALpezxKk4KcA1p1k2Xz1g6Bc3ntjHGUQvDTJC78cvDMsCJwV5wdVVrrWK9tVH6tiadcSWGh8woQkzi1j29wLG` |
| 15 | cancel:cancel | SEND | VERIFIED | `3RhLMJ8SJzehKkEiroXbnZthjaWRRoudbcDQ2P6XFQ8W56WpgyrMVJWgaujVB14HTAB4ug8StZDuKcvgyKtaXfxa` |

## Negative simulations (attributed, escrow-originated)

| Event | Code | Name | Instruction index |
|-------|------|------|-------------------|
| unauthorized_release | 2001 | ConstraintHasOne | 0 |
| refund_before_expiry | 6008 | EscrowNotExpired | 0 |
| release_at_or_after_expiry | 6007 | EscrowExpired | 0 |

## Finalized on-chain state

| Flow | Escrow | Status | Vault | Vault amount |
|------|--------|--------|-------|--------------|
| release | `eYZqDuBoDqkMirew1LPBnxynCGPENoZq6z5g7AkLHfc` | Released | `D5Sd41n5MNJrBhv8m8e3ApyQmHWXQwWxUkSNrGESkSUQ` | 0 |
| refund | `9CqmJ8Eb8nxPoPHfzXHuHimgcTLgrV2JvhGK7vjAJfVF` | Refunded | `6BnGE1tLwAHyoah851poCF2y7BAhjuPR1WmjfLNDvzix` | 0 |
| cancel | `Hn1nBPj2X91GDmquVWFeFZj9Spf8sx3KCuQhaHsEbMDb` | Cancelled | `9Dc2Eea1JGJFs35hs3ThTaJFoufZ2enJ9xBdE41kZWPu` | 0 |

Deterministic mint `6dGuA5C7hh8kHgcUHc9uT97ecAw9Z7eTUa6rtakQaAMr` (decimals 6, initialized, owned by the token program). Token accounting: minted 3000000 → contributor ATA 1000000 + sponsor ATA 2000000.

## Funding reconciliation

Actual base fees: sponsor 60000 lamports, maintainer 5000 (total 65000).
The pre-execution planner projected sponsor fees at 55000 (one base fee per SEND transaction); corrected to 60000 (base fee per required signature) in `4544c3403b7acb0630d2aeb1c1388226f3187c51`. Root cause: setup:mint_tokens requires two signatures (sponsor fee payer + mintAuthority); the old planner charged one base fee per transaction and undercounted by 5000 lamports.

## Integrity / hash inventory

- Original receipt (`.devnet/business-flow-receipts/exec-4c6cce10-2f17-4a51-896d-79a2569107d0.matrix.json`, immutable, gitignored): SHA-256 `f18b2daecd963cb3213693d11143d7e6c3e1c980e343058031fdb81dbf41fef1`
- Evidence manifest (`evidence-manifest.json`): SHA-256 `b4127b4257c84b9ca1ce19998a9166ae3e7570e12218364c0377fd4afdc982dc`

## Limitations

- Solana devnet only; not deployed to mainnet and handles no real-value assets.
- One completed execution (exec-4c6cce10). No persistence, resume, or recovery machinery is claimed or exercised across host restarts.
- No formal security audit; not production-security hardened.
- The program is deployed upgradeable with a retained loader upgrade authority (governance choice); this is distinct from any in-program upgrade instruction (there is none).
- The client harness authorizes only the frozen canonical execution spec; it is not a generic arbitrary-spec signer.
- This package is submission-candidate evidence pending final independent review; screenshot/video assets are a pending operator capture step.
- The full deterministic mint seed is withheld by policy; only the public mint address is published.
