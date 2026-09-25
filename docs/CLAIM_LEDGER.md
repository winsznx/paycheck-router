# Claim ledger

Every public claim, the artifact behind it, whether it is a target or measured, and its limit. The README, submission text, videos and site take their numbers from [`submission-facts.json`](../submission-facts.json), and this ledger says where each one came from.

| Claim | Status | Environment | Artifact | Date | Limitation |
| --- | --- | --- | --- | --- | --- |
| The Jupiter `/swap/v2/build` instruction runs inside CPI with a PDA as taker | Measured | Fork | `evidence/day-one/2026-09-25T10-21-50-930Z.json`, check 4 | 2026-09-25 | Throwaway probe program, not the router program |
| Jupiter routes execute against a fork's copies of the pools | Measured | Fork | Same file, check 2 | 2026-09-25 | Proprietary AMMs excluded on forks ([DECISIONS.md](DECISIONS.md)) |
| A paycheck becomes verified shares end to end | Measured | Fork | Canonical run bundle, `evidence/stocklana-fork/` (Anthropic slice) | 2026-09-25 | Fork: no real money, no congestion. Only the pre-IPO slice bought; the xStock slices waited on a Pyth data entitlement |
| Every executed slice is Verified | Measured: 20 of 20 in the campaign, 1 of 1 in the canonical run | Fork | `evidence/campaign/summary.json`, `evidence/stocklana-fork/` | 2026-09-25 | On a fork, Verified means surfnet readback plus Hermes history, with no second RPC provider |
| The guard makes the OpenAI slice wait while it trades about 30% over mark | Measured: 30.4% over mark, OutputBelowMinimum in simulation | Fork | `evidence/stocklana-fork/raw/jupiter/…_0_3_0.json` and the OpenAI simulation log | 2026-09-25 | Depends on the live premium at run time |
| Median all-in cost per $100 invested ≤ $0.50 | Inconclusive: median $1.00 (n=15); xStocks $0.24 (n=4), PreStocks $1.75 (n=11, includes the issuer's 1% transfer fee) | Fork | `evidence/campaign/summary.json` metrics | 2026-09-25 | Not claimed as a pass; fork cost uses real pool state but no competing flow |
| Speed | Not claimed | — | — | — | Only mainnet runs can support a speed claim |
| OpenAI PreStocks traded 32.8% over its mark | Measured | Mainnet data | PreStocks API read at 11:31 WAT | 2026-09-25 | A point-in-time reading |
| The guard held off buys far over the mark | Measured: OpenAI about +31%, Neuralink about +34%, Anduril and Polymarket about +6% waited | Fork | `evidence/campaign/` P4 real market and P8 bundles | 2026-09-25 | Described as protection only; no waiting slice later filled in band |
| A naive router would have overpaid | Computed: $129.95 across 26 quoted slices, replayed from recorded first-attempt quotes | Fork (replayed) | `evidence/campaign/summary.json` ablations.guard | 2026-09-25 | Replay, not executed |
| Jupiter's quote alone is not a safe reference | Computed: 7 of 26 slices would have executed out of band | Fork (replayed) | `evidence/campaign/summary.json` ablations.oracle | 2026-09-25 | Replay, not executed |
