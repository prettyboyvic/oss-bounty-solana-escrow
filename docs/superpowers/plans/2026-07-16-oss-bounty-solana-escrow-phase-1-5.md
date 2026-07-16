# OSS Bounty Escrow Phase 1.5 Plan

1. Re-verify the initial repository state, ignored runtime artifacts, public
   deterministic fixtures, Apache-2.0 license, source independence, parked
   repositories, and GitHub authentication.
2. Add Rust and local-validator tests that reject an all-zero external
   reference hash, then run them against the unchanged implementation and
   record RED.
3. Add the dedicated program error and validation rule, update the test IDL,
   and record GREEN.
4. Add refund-path unsolicited-dust coverage and document terminal-account,
   rent, and dust limitations.
5. Reclassify JavaScript-only test/tooling packages as development
   dependencies and retain compatible pinned versions.
6. Make Ubuntu CI print and verify the active Solana 2.2.20 and Anchor 0.31.1
   toolchains before build/test.
7. Run formatting, Rust tests, TypeScript typechecking, optimized SBF build,
   the full local-validator suite, YAML validation, diff checks, advisory
   checks, secret scans, and ignored-artifact staging checks.
8. Stage explicit source paths, show the staged path list and diff stat, commit
   on `main`, create the public GitHub repository, push without force, and
   monitor GitHub Actions to a terminal state.
