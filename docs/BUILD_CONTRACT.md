# Build contract

Rules for how code, numbers and evidence are produced in this repository. They apply to people and coding agents alike.

1. **One source of truth.** The design document governs. When the real chain, an SDK or an API behaves differently, the observation goes into [DECISIONS.md](DECISIONS.md) with evidence, the design is corrected the same day, and nothing keeps building on the disproven premise.
2. **Settled decisions.** These change only with new evidence: production on Solana mainnet and never devnet, with the hackathon entry on a Surfpool fork of mainnet until the deploy deposit is funded; Jupiter `/swap/v2/build` invoked by CPI with the Authority PDA as taker; Pyth pull updates with full verification; Ed25519-attested PreStocks marks; Helius webhooks plus a reconcile sweep (the sweep alone on forks); the web app and API on Cloudflare; Supabase through Hyperdrive; Sign-In-With-Solana plus Privy; the dark brutalist visual system; Apache-2.0.
3. **No mocks in product paths.** Every product surface reads real chain state and real upstream data. Test doubles live in unit tests only and never ship.
4. **No phased scope.** Everything designed ships. Nothing is parked as "later".
5. **Evidence honesty.** No fabricated or hard-coded metrics, transactions, users, videos or receipts. Team-funded paychecks are labelled wherever they appear, and so is every run recorded on a fork.
6. **Traceable numbers.** Every number shown anywhere comes from a machine-readable artifact with a denominator and provenance, through [`submission-facts.json`](../submission-facts.json) and [`evidence/`](../evidence).
7. **Failures stay.** Failed runs, waits, expiries and withdrawn claims stay in `evidence/` and [GATES.md](GATES.md).
8. **No silent substitution.** A load-bearing dependency is never swapped for a weaker path while the product keeps claiming the stronger one: no guard-free buys, no estimated prices in the guard.
9. **Matched comparisons.** Baselines use the same timestamps and amounts as the product arm.
10. **Targets stay targets** until they're measured.
11. **Freeze.** Before submitting: re-run verification, rebuild `/proof` from raw artifacts, and check every public surface against `submission-facts.json`.

## Repository practice

- Short-lived branches merged to `main` through pull requests with rebase-merge, so every commit survives.
- Conventional commits in the imperative, one logical change each, with tests run before every commit.
- A pre-commit hook runs gitleaks and refuses private planning files and Solana keypair JSON.
- Every dependency is pinned exactly, and pnpm refuses package versions published less than a day ago.
