# Claim ledger

Every public claim, the artifact behind it, whether it is a target or measured, and its limit. The README, submission text, videos and site take their numbers from [`submission-facts.json`](../submission-facts.json), and this ledger says where each one came from.

| Claim | Status | Environment | Artifact | Date | Limitation |
| --- | --- | --- | --- | --- | --- |
| The Jupiter `/swap/v2/build` instruction runs inside CPI with a PDA as taker | Measured | Fork | `evidence/day-one/2026-09-25T10-21-50-930Z.json`, check 4 | 2026-09-25 | Throwaway probe program, not the router program |
| Jupiter routes execute against a fork's copies of the pools | Measured | Fork | Same file, check 2 | 2026-09-25 | Proprietary AMMs excluded on forks ([DECISIONS.md](DECISIONS.md)) |
| A paycheck becomes verified shares end to end | Target | Fork | Canonical run bundle, `evidence/stocklana-fork/` | — | Fork: no real money, no congestion |
| Every executed slice is Verified | Target | Fork | Verifier output in the canonical bundle | — | On a fork, Verified means surfnet readback plus Hermes history, with no second RPC provider |
| The guard makes the OpenAI slice wait while it trades about 30% over mark | Target | Fork | Simulation logs for the OpenAI leg in the canonical bundle | — | Depends on the live premium at run time |
| Median all-in cost per $100 invested ≤ $0.50 | Target | Fork | Campaign P1 and P8 bundles | — | Fork cost uses real pool state but no competing flow |
| Speed | Not claimed | — | — | — | Only mainnet runs can support a speed claim |
| OpenAI PreStocks traded 32.8% over its mark | Measured | Mainnet data | PreStocks API read at 11:31 WAT | 2026-09-25 | A point-in-time reading |
