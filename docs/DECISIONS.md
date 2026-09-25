# Decisions

Observations where the real chain, SDK or API differed from the plan, and what changed because of them. Newest first.

## 2026-09-25: Pyth Hermes requires an API key

**Observed.** Since Pyth's core upgrade on Aug 26, 2026, Hermes answers `401 unauthorized` on every price-update endpoint without a key: `/v2/updates/price/latest`, `/v2/updates/price/{publish_time}` and `/api/latest_vaas`. Feed metadata (`/v2/price_feeds`) still answers 200. Checked at 11:48 WAT. Keys come from Pyth Terminal and are sent as `Authorization: Bearer <key>`. Routes and response shapes are unchanged, and the onchain receiver is still permissionless.

**Changed.** The crank, `pnpm demo:fork`, the verifier CLI and the API read `PYTH_API_KEY` (and an optional `HERMES_URL`) and send it on every Hermes request. Running the pipeline or re-verifying a bundle now needs a Pyth key as well as the free Helius and Jupiter keys. There is no fallback price source: without a key, nothing buys.

## 2026-09-25: Jupiter creates the Authority PDA's output-token account

**Observed.** With the Authority PDA as `taker` and the owner's token account as `destinationTokenAccount`, `/swap/v2/build` still returns a setup instruction that creates the PDA's associated token account for the output mint, paid by `payer` (the crank). The shares land in the destination account; the PDA's account stays empty. Evidence: `evidence/day-one/2026-09-25T10-21-50-930Z.json`, check 4.

**Changed.** The execute transaction keeps Jupiter's setup instructions. Each router carries one empty authority token account per asset it has bought, paid once by the crank. The invariant "the Authority holds nothing between instructions" is checked on every authority token account the transaction touches, not only USDC.

## 2026-09-25: Proprietary AMMs are excluded from routes on a fork

**Observed.** The first fork swap routed USDC through BisonFi and failed in the next hop with Raydium CLMM `ZeroAmountSpecified` (6020): BisonFi returned zero. BisonFi, HumidiFi, SolFi and similar proprietary AMMs price from state that an off-chain updater rewrites every slot on mainnet. A fork copies that state once and never sees the updates, so those pools quote stale or zero. Evidence: `evidence/day-one/2026-09-25T10-20-11-643Z.json`.

**Changed.** On surfnets only, the SDK passes `excludeDexes` for the 15 proprietary AMMs listed in `FORK_EXCLUDED_DEXES`. Mainnet routing keeps every DEX. The onchain guard is unchanged either way. Fork fills can therefore be slightly worse than mainnet fills for the same slice, and fork cost and premium figures say so.

## 2026-09-25: Jupiter `/swap/v2/build` works without an API key

**Observed.** `GET https://api.jup.ag/swap/v2/build` returns 200 with a full instruction set and no `x-api-key` header.

**Changed.** Nothing in the design. The SDK sends the key when `JUPITER_API_KEY` is set, and the rate gate still assumes the free key's 1 request per second.
