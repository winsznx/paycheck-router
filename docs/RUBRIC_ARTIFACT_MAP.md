# Rubric to artifact map

Each judged criterion, the claim it rests on, and where a judge can check it without a wallet. A row is bound only when its artifact exists and the link resolves. Before submitting, every row must be bound.

| Criterion | Claim | Artifact | Judge sees it at | Bound |
| --- | --- | --- | --- | --- |
| Main: real user and problem | Stablecoin-paid workers hold idle USDC and have no paycheck-to-stock path | Sourced evidence table | [THESIS.md](THESIS.md), README "The problem", landing, pitch 0:15 | Yes |
| Main: working end-to-end demo | A paycheck became verified shares on a Surfpool fork of mainnet through the real Jupiter, xStocks, PreStocks and Pyth programs | Fork bundle in `evidence/stocklana-fork/`, `pnpm demo:fork`, `/proof` | `/proof`, pitch 1:20, `pnpm demo:fork` | No, waits for the canonical run |
| Main: belongs on Solana | Same-rails payroll and liquidity, sub-cent slices, Token-2022, onchain Pyth | README "Why Solana", chain ablation (P7) | README, pitch 2:05 | Partly: README yes, P7 waits for the campaign |
| Main: quality of execution | Verifiable build, tests and CI, device matrix, accessibility, proof campaign | CI badges, `solana-verify` hash, axe reports, `/proof` table | README, repository | No |
| PreStocks: best use | Pre-IPO slices from every paycheck, guarded by the attested mark, converted at IPO | PreStocks leg records from the fork run, attestation log, the OpenAI wait on live marks | `/proof`, pitch 1:20, walkthrough 3:10 | No |
| Pyth: data doing real work | Every automatic buy is gated onchain by a verified Pyth price, and 24/7 feeds keep Big Tech buying off-hours | Execute records with posted `PriceUpdateV2` accounts, each checked against Hermes history; P3 and P7 results | `/proof`, walkthrough 1:20 | No |
