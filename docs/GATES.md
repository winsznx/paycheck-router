# Gates

Results of each check and campaign case, pass or fail, in the order they ran. Failed runs stay here with their evidence.

| Time (WAT) | Gate | Result | Evidence |
| --- | --- | --- | --- |
| 2026-09-25 11:20 | Day-one: fork clock, Jupiter route, fork signatures, CPI with PDA taker | 3 of 4 PASS; the Jupiter route and the CPI check failed on a proprietary AMM hop | `evidence/day-one/2026-09-25T10-20-11-643Z.json` |
| 2026-09-25 11:22 | Day-one re-run with proprietary AMMs excluded on the fork | 4 of 4 PASS | `evidence/day-one/2026-09-25T10-21-50-930Z.json` |
| 2026-09-25 14:29 | `pnpm demo:fork` rehearsal from main on the verifiable build of main@eade508 (solana-verify `be0602b7…876b`) | Detected 4 s after the transfer, recorded 1 s later (370 of 1,850 USDC invested). SPYx and NVDAx wait PRICE_UNAVAILABLE (Hermes 403, key lacks the equities grant). OpenAI waits PREMIUM_TOO_HIGH from the program's simulation. Anthropic FAILED: first attempt rejected in Flux (fork-stale DEX, excluded and re-quoted), second hit InputOverspent from leftover wSOL on a two-hop route (fixed by #32) | `evidence/2026-09-25T13-29-17-861Z/` |
| 2026-09-25 15:25 | Canonical fork run, attempt 1, on the verifiable build of main@e53fbfe (solana-verify `8412a604…8cc4`) | FAILED: `solana program deploy` stalled for 11 minutes with the surfnet idle after its account fetches from the public mainnet datasource; stopped and retried | `evidence/2026-09-25T14-25-46-561Z/surfpool.log` |
| 2026-09-25 15:38 | Canonical fork run, attempt 2 (main@44315ca, same binary) | Paycheck detected 1.5 s after the transfer and recorded (370 of 1,850 USDC). Anthropic VERIFIED: 86,315,830 raw delivered + 871,878 issuer fee withheld against a 84,991,267 minimum, 40 bps over the attested mark, 162 bps all-in, every verifier check passed. OpenAI waits PREMIUM_TOO_HIGH (program simulation OutputBelowMinimum; quote 30.4% over mark). SPYx and NVDAx wait PRICE_UNAVAILABLE (Pyth key lacks the equities grant) | `evidence/stocklana-fork/` |
