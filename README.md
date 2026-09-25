# Paycheck Router

Paycheck Router turns a slice of every USDC paycheck into US stocks the moment it lands, in your own wallet, at a Pyth-checked price.

Runs on a Surfpool fork of mainnet until the mainnet deploy: the real xStocks, PreStocks, Jupiter and Pyth programs and prices, no real funds.

> Work in progress for the Stocklana hackathon (Sep 25, 2026). The result line, proof links, videos and the one-command fork replay land here as they are measured.

## How it works

1. You pick a split once, for example 20% of every paycheck into SPYx and 5% into OpenAI PreStocks, and sign one setup transaction. It gives the Paycheck Router program a capped SPL allowance on your USDC account. Nothing leaves your wallet.
2. When USDC pay lands, a permissionless crank records the paycheck onchain and builds one Jupiter swap per slice.
3. The program swaps each slice by CPI and reverts unless the shares landing in your wallet meet a minimum it computes itself from a fresh Pyth price, or from a signed PreStocks mark for pre-IPO tokens.
4. A slice that can't buy inside its band waits with a named reason, and expires with your USDC untouched if it never can.

## Licence

[Apache-2.0](LICENSE)
