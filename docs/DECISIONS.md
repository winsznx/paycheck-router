# Decisions

Observations where the real chain, SDK or API differed from the plan, and what changed because of them. Newest first.

## 2026-09-25: A Pyth Terminal key covers crypto feeds only until equity grants are added

**Observed.** With a fresh Pyth Terminal API key, Hermes returns a signed update for `Crypto.USDC/USD` (200). It returns 403 for `Equity.US.*` regular-session feeds ("Not entitled … asset type 'equity'"), for the 24/7 equity and pre-IPO feeds ("gated feed; requires group pyth-indices") and for FX feeds. Checked at 13:08 WAT.

**Changed.** Nothing about the guard. xStock slices need an equity grant (and `pyth-indices` for the 24/7 feeds) on the key; until it exists they can't execute, and the attempt records the 403 as its own error. PreStocks slices are unaffected, because they are priced from the attested mark plus USDC/USD. There is no substitute price source.

## 2026-09-25: Program size, math limits and layout as built

**Observed.** The release build of `paycheck_router` is 693,272 bytes with all 21 instructions, against a planned 350–450 KB. At 5,080 lamports per byte, program rent on mainnet is about 3.52 SOL rather than 2.34 SOL. In LiteSVM, `execute_leg` uses about 95,700 compute units including the test swap's two token CPIs, so the program's own work sits near the planned 80,000.

The guard is one u128 fraction per formula, so a buy overflows (MathOverflow) above about 33,900 USDC for 9-decimal tokens, or about 339,000 USDC for 8 decimals. The golden vector `buy_large_leg_50000_usdc_d9` documents it.

**Changed.**
- The mainnet deploy needs about 3.6 SOL for the program plus the 1.0 SOL crank float. The first rent cut after deploy refunds the difference.
- `max_leg_usdc` (5,000 USDC at launch) must stay below about 33,000 USDC while pre-IPO assets are listed.
- The Scaled UI multiplier is truncated to 1e12 fixed point, matching `packages/guard-math`. Buy minimums still round toward the owner; sell and conversion minimums can be low by less than one part in 10^12.
- Errors 6032 `InvalidParameter`, 6033 `Unauthorized` and 6034 `LegNotExpired` follow the planned 6000–6031.
- Router gains `pending_legs` (for `close_router`). Each paycheck leg is 81 bytes with `issuer_fee`. Paycheck stores its bump. `RouterClosed` and `PaycheckClosed` events exist. `LegExecuted` and `GuardedSwap` carry the attestation and the price source.
- `initialize_config` requires the program's upgrade authority, so it can't be front-run. `upsert_asset` rejects mints with an active transfer-hook program.
- Authority token accounts that Jupiter creates for output mints stay open after `close_router`; the crank paid their rent.
- Every mint read on the fork (SPYx, QQQx, NVDAx, AAPLx, TSLAx, OpenAI, Anthropic, SpaceX) has DefaultAccountState initialized, a null transfer-hook program and pausable not paused.

## 2026-09-25: The demo environment runs Postgres 17 in PGlite

**Observed.** The recording machine's Docker engine answers HTTP 500, and the disk had 1.6 GB free at 12:43 WAT, while `supabase start` pulls several GB of images. The demo database only mirrors offchain state; the money state it describes lives onchain.

**Changed.** `pnpm demo:record` always runs Postgres 17 through PGlite's wire-protocol server on port 54322, applying the same `supabase/migrations` and `seed.sql`. It is the only database path for `demo`, not a fallback, and the startup log says which database is running. Supabase through Hyperdrive stays the database for staging and production. `pnpm demo:fork` needs no database at all.

## 2026-09-25: Fuzzing with proptest under LiteSVM instead of Trident

**Observed.** Trident 0.12.0 (and 0.13.0-rc.4) is built on Solana 2.x crates, while Anchor 1.0.2 is on Solana 3.x. The program's entry point compiles under Trident, but the first sysvar read fails at runtime (`UnsupportedSysvar`) because Trident installs only the 2.x syscall stubs, and every instruction here reads `Clock`.

**Changed.** The fuzz suite is `proptest` driving the real instructions under LiteSVM: random fees, prices, multipliers and output offsets around the minimum for `execute_leg`; random pay, spend, record, skip and sync sequences; byte flips in the Ed25519 attestation instruction; and properties of the guard math. Trident comes back when it supports Solana 3.x.

## 2026-09-25: Pyth price posts built without the receiver SDK

**Observed.** `@pythnetwork/pyth-solana-receiver@0.16.0` can't be imported under Node's ESM loader. Its dependencies do an extensionless import of `jito-ts/...` (`@pythnetwork/solana-utils@0.6.0`) and a directory import of `@coral-xyz/anchor/dist/cjs/utils/bytes`, and they pull a `@solana/web3.js` 1.x whose `rpc-websockets` subpath isn't exported. It also drags web3.js 1.x into a codebase built on `@solana/kit`, which has to run in Workers.

**Changed.** `packages/sdk` builds the same instructions from the Wormhole core bridge and Pyth receiver account layouts: create, init, write and verify the encoded VAA, `post_update` with full verification, then close the VAA and reclaim the update rent. The program's checks are unchanged: receiver ownership, `Full` verification, feed ID, age and confidence. Fork runs prove the path end to end.

## 2026-09-25: PreStocks tokens charge a Token-2022 transfer fee, and marks are per scaled token

**Observed.** Every PreStocks mint is Token-2022 with 9 decimals and a TransferFee extension: 100 bps from epoch 1039, rising to 300 bps from epoch 1043 (about 27 hours after this check), with no maximum. The fee is withheld in the receiving account. The OpenAI mint also carries a Scaled UI multiplier of 1.4861347, in effect since Jul 17, 2026, and the PreStocks API quotes `markPrice` and `tokenPrice` per scaled token. xStocks have no transfer fee. On a fork, $100 of USDC bought OpenAI in one transfer from the Manifest vault straight into the owner's account: 49,891,236 raw gross, 498,913 withheld, 49,392,323 received. That is $1,349 per scaled token against a $1,023.70 mark. Evidence: `evidence/day-one/prestocks-fee-2026-09-25T11-04-30-889Z.json`.

**Changed.** The guard compares price with the reference on the gross output: the owner's balance change plus the change in the account's withheld fee must reach the minimum. The issuer's transfer fee is read onchain, recorded per slice as `issuer_fee`, and reported as a cost next to the 0.20% protocol fee. It is included in all-in cost per $100 and never folded into the price band. Counting it inside the band would stop every PreStocks slice from buying once the fee reaches 300 bps, and the band exists to catch overpaying the market, not issuer fees. The multiplier applies to pre-IPO slices exactly as it does to xStocks.

## 2026-09-25: Three contrast pairs adjusted to meet WCAG AA

**Observed.** Measured against the design tokens, dark `--text-3` on `--surface-1` is 4.47:1, light `--text-3` on `--surface-2` is 4.49:1, and near-black text on the light danger fill `#c2183a` is 3.28:1. All three are under the 4.5:1 AA floor.

**Changed.** `--text-3` is used only on the canvas, where it passes, and a contrast test in `packages/ui` enforces that. The light danger button uses white ink (`--danger-ink: #ffffff`, 6.02:1).

## 2026-09-25: Next.js 16 with edge middleware on OpenNext

**Observed.** The design named Next.js 15 in one place and 16 in another. Next.js 16 renames `middleware` to `proxy`, but OpenNext for Cloudflare 1.20 supports Node proxies only experimentally (opennextjs-cloudflare #1373, #1376).

**Changed.** The web app runs Next.js 16.3.6 (inside OpenNext's supported range) and keeps locale negotiation in `middleware.ts`, which Next 16 still supports with a deprecation warning.

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
