# Gates

Results of each check and campaign case, pass or fail, in the order they ran. Failed runs stay here with their evidence.

| Time (WAT) | Gate | Result | Evidence |
| --- | --- | --- | --- |
| 2026-09-25 11:20 | Day-one: fork clock, Jupiter route, fork signatures, CPI with PDA taker | 3 of 4 PASS; the Jupiter route and the CPI check failed on a proprietary AMM hop | `evidence/day-one/2026-09-25T10-20-11-643Z.json` |
| 2026-09-25 11:22 | Day-one re-run with proprietary AMMs excluded on the fork | 4 of 4 PASS | `evidence/day-one/2026-09-25T10-21-50-930Z.json` |
| 2026-09-25 14:29 | `pnpm demo:fork` rehearsal from main on the verifiable build of main@eade508 (solana-verify `be0602b7…876b`) | Detected 4 s after the transfer, recorded 1 s later (370 of 1,850 USDC invested). SPYx and NVDAx wait PRICE_UNAVAILABLE (Hermes 403, key lacks the equities grant). OpenAI waits PREMIUM_TOO_HIGH from the program's simulation. Anthropic FAILED: first attempt rejected in Flux (fork-stale DEX, excluded and re-quoted), second hit InputOverspent from leftover wSOL on a two-hop route (fixed by #32) | `evidence/2026-09-25T13-29-17-861Z/` |
