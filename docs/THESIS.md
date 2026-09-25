# Thesis

People paid in USDC on Solana have no equivalent of brokerage direct deposit. A US employee can send 10% of every paycheck into an index fund without thinking about it. A frontend engineer in Lagos paid through Deel, or a designer in Nairobi paid through Rise, gets USDC in a wallet and then has three options: hold it, sell it for local currency, or spend it on a card. Nobody offers "invest".

Paycheck Router adds that option. The worker picks a split once, for example 20% of every paycheck into SPYx and 5% into OpenAI PreStocks, and signs one transaction. From then on, whenever pay lands, each slice becomes stock in the worker's own wallet within seconds, at a price the program checks against Pyth before the swap settles.

## Who it's for

Workers outside the US who already receive salary or contract pay in USDC on Solana: Deel, Rise, Toku and Bitwage payees, and freelancers paid directly by clients. The first markets are Nigeria, Kenya, the Philippines, India, Brazil and Argentina. Each asset's eligibility follows its issuer's restricted-country list, and US persons are excluded.

| | Today | With Paycheck Router |
| --- | --- | --- |
| Getting stock exposure | Off-ramp to a local broker, buy on a CEX at 2% per trade, or swap by hand on Jupiter every payday | Automatic on every paycheck |
| Custody | The broker or exchange holds it | The worker's own wallet |
| Timing | Market hours, T+1 settlement | Seconds after pay lands, any day of the week |
| Price protection | None on thin off-hours pools | An onchain Pyth check, or the slice waits and says why |
| Pre-IPO access | None | Slices of OpenAI, Anthropic, Anduril and others through PreStocks |

## Why the numbers point here

| Claim | Number | Source |
| --- | --- | --- |
| Deel pays salary stablecoins on Solana | Part of net salary, plus 10,000+ contractors already on stablecoin payouts | [TheStreet, May 20, 2026](https://www.thestreet.com/crypto/markets/deel-launches-stablecoin-salary-payouts-via-solana) |
| Workers keep the dollars | More than half of worker withdrawals are taken in stablecoins | [Spark](https://www.spark.money/research/stablecoin-payroll-direct-deposit), [Rise, Mar 2026](https://www.riseworks.io/blog/state-of-crypto-payroll-report-2026) |
| No invest option exists | Hold, convert or spend are the only choices payroll platforms offer | [Spark](https://www.spark.money/research/stablecoin-payroll-direct-deposit) |
| The CEX route is expensive | Luno sells tokenized US stocks in Nigeria at 2% per trade | [Mariblock, Sep 8, 2025](https://www.mariblock.com/stories/luno-expands-access-to-tokenized-us-stocks-to-nigeria) |
| The liquidity is on Solana | About 95% of onchain equity volume; xStocks lists 700+ assets | [Solana Compass, Sep 11, 2026](https://solanacompass.com/news/solana-tokenized-equity-supply-hits-684m-record-as-xstocks-crosses-800m-aum) |
| Off-hours prices drift | AMMs lack a live reference for most of the week; Apple-linked tokens traded about 12% over the stock | [crypto.news](https://crypto.news/tokenized-stocks-face-24-7-pricing-gap-redstone-coo/), [Yahoo Finance](https://finance.yahoo.com/markets/crypto/articles/weekend-chain-prices-monday-don-183331035.html) |
| Pre-IPO tokens can trade far from their mark | OpenAI PreStocks traded 32.8% over its mark ($1,359.35 token price vs $1,023.70 mark) at 11:31 WAT on Sep 25, 2026 | [PreStocks API](https://prestocks.com/api/prestocks) |

What is not claimed: user demand. The hypothesis is that at least 30% of stablecoin-paid workers who see the pitch will create a router within a week. The waitlist and onboarding funnel measure that, and nothing here calls it traction until it's measured.

## Why Solana

1. **Same rails.** Payroll stablecoins and tokenized equities settle on the same chain, so paycheck to shares is one hop with no bridge.
2. **Slice economics.** A $20 slice only makes sense when the transaction costs a fraction of a cent.
3. **Settlement.** Shares land in seconds, Saturday paydays included, inside the price band.
4. **Token-2022.** xStocks apply dividends and splits through the Scaled UI Amount multiplier, which the program reads onchain when it computes the minimum it accepts.
5. **Composability.** The shares are ordinary tokens. They can be sold on Jupiter at any hour, borrowed against, or moved to any wallet.

## What it is not

- Not a broker, exchange or custodian. USDC stays in the worker's wallet until a guarded swap delivers shares back into the same wallet.
- Not a trading app: it buys on paydays and sells on request, with no leverage, margin or charts.
- Not an issuer. It routes into existing xStocks and PreStocks tokens.
- Not a fiat on-ramp. Users already receive USDC.
