# Stocklana submission

Every field as entered on the hackathons.solana.com form. Values that depend on the canonical fork run come from [`submission-facts.json`](../submission-facts.json) and are updated when the run is measured.

| Field | Value |
| --- | --- |
| Name | Paycheck Router |
| Tagline | Your USDC paycheck, turned into US stocks the moment it lands, in your own wallet, at a Pyth-checked price |
| Tracks | Main; PreStocks (Best Use of PreStocks); Pyth (Best use of Pyth market data) |
| Repository | https://github.com/winsznx/paycheck-router (Apache-2.0), submitted commit tagged `stocklana-submission` |
| Live demo | Left empty. The rules describe a live demo as deployed to devnet or mainnet, and routing runs on a mainnet fork. The site and `/proof` are linked from the description and the README. |
| Pitch video | 3:00 or less, link added after recording |
| Technical walkthrough | 5:00 or less, link added after recording |
| Team | Invited from the submission form |

## Description

> Runs on a Surfpool fork of mainnet: the real xStocks, PreStocks, Jupiter and Pyth programs and prices, no real funds. Replay it with `pnpm demo:fork`.
>
> Paycheck Router turns a slice of every USDC paycheck into US stocks the moment it lands, in the worker's own wallet, at a Pyth-checked price. The worker signs once: a split and a capped SPL allowance to the router's Authority PDA. When pay lands, a permissionless crank records the paycheck onchain and swaps each slice through Jupiter by CPI. The program reverts unless the shares landing in the owner's wallet meet a minimum it computes itself from a fresh, fully verified Pyth price and the token's Scaled UI multiplier, or from an Ed25519-signed PreStocks mark for pre-IPO slices. A slice that can't buy inside its band waits with a named reason and expires with the USDC untouched.
>
> PreStocks: pre-IPO slices (OpenAI, Anthropic, Anduril and more) from every paycheck, guarded against the PreStocks mark, which is why the OpenAI slice waits while it trades about 30% over mark.
>
> Pyth: every automatic buy is gated onchain by a posted, fully verified `PriceUpdateV2`, and each executed slice is re-checked against Hermes price history by an independent verifier CLI.
>
> Result on a Surfpool fork of mainnet (Sep 25, 2026): a $1,850 USDC paycheck from an employer wallet was detected 1.5 s after it landed and recorded onchain, with $370 invested across four slices. The Anthropic slice bought and verified at 0.40% over its signed mark. The OpenAI slice waited because it traded 30.4% over its mark. The SPYx and NVDAx slices waited because our Pyth API key lacks the US equities grant, and the program never buys without a verified price. A 32-run evaluation campaign is published with every failure: 20 of 20 executed slices verified; the guard held off buys 6% to 34% over mark, and replaying the same quotes without the guard would have overpaid $129.95; median all-in cost was $1.00 per $100 ($0.24 for xStocks, $1.75 for PreStocks including the issuer's 1% transfer fee).
>
> Check it yourself: `pnpm verify:bundle evidence/stocklana-fork` re-derives the canonical run from its raw artifacts, `pnpm verify:campaign` rebuilds every campaign number, and `pnpm demo:fork` replays a run from a clean clone.
