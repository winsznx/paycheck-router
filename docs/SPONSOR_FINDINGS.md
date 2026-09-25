# Sponsor findings

Things we ran into while building on sponsor infrastructure, with evidence, written so the sponsor can act on them.

## Jupiter

**1. Proprietary AMM venues can't execute on a mainnet fork, and nothing in the API marks them.** Our first fork swap routed USDC through BisonFi, which returned zero and made the next hop (Raydium CLMM) revert with `ZeroAmountSpecified`. Venues like BisonFi, HumidiFi and SolFi price from state an off-chain updater rewrites every slot on mainnet, so a fork's one-time copy goes stale. We now pass `excludeDexes` for 15 such labels on forks only. A flag in `/program-id-to-label` (or a `forkSafe` / `onchainStateOnly` routing option on `/build`) would save every team that tests on Surfpool from rediscovering this. Evidence: `evidence/day-one/2026-09-25T10-20-11-643Z.json`.

**2. `/build` creates the taker's output-mint token account even when `destinationTokenAccount` is set.** With a PDA taker and the owner's account as destination, the setup instructions still create the PDA's associated token account for the output mint, paid by `payer`. The output lands in the destination and the PDA's account stays empty. For CPI integrators that's one wasted rent deposit per taker and mint. Skipping that setup instruction when a destination is given would remove it. Evidence: `evidence/day-one/2026-09-25T10-21-50-930Z.json`, check 4.

**3. `/build` works with a PDA taker inside CPI.** For the record, it works as documented: the RouteV2 instruction invoked with `invoke_signed` and the PDA marked as signer only inside the CPI executed a full 10 USDC → NVDAx swap on a fork.

## PreStocks

**1. Signed marks would remove a trust assumption.** The router guards pre-IPO slices against the mark from `https://prestocks.com/api/prestocks`. Today our own attester key fetches that mark and signs it for the program to verify with Ed25519. If PreStocks published marks signed with a PreStocks key, the program could verify them directly and the attester would leave the trust model entirely.

**2. The guard is doing real work right now.** At 11:31 WAT on Sep 25, 2026 the OpenAI token traded at $1,359.35 against a $1,023.70 mark (+32.8%) and Neuralink at +29.6%. An auto-buyer without a mark check would have paid that premium on every paycheck.

## Pyth

**1. Extended-hours sessions.** Hermes `schedule` attributes for `Equity.US` feeds list 09:30–16:00 while the market-hours page describes pre, post and overnight sessions. We haven't confirmed yet whether extended-hours prices publish on the same feed IDs. It decides whether an xStock slice without a 24/7 feed can buy at 08:00 ET.
