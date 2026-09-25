# Demo script

Two recordings, both made with `pnpm demo:record` on a fresh Surfpool fork of mainnet during the US regular session (09:30–16:00 ET, 14:30–21:00 WAT), so SPYx and the other xStocks price from live Pyth regular-session feeds. The fork banner "Mainnet fork (Surfpool) · no real funds" stays visible in every shot.

## Before you press record

1. `pnpm install --frozen-lockfile`
2. Put `HELIUS_API_KEY` (and `JUPITER_API_KEY` if you have one) in your shell.
3. `pnpm demo:record`. Wait for it to print the web URL, the API URL and the surfnet RPC URL. It has already started a fresh surfnet, deployed the program under its production ID, initialized Config, seeded the asset registry and funded the fork-only keys.
4. Open the web URL in Chrome with the device toolbar set to a 390×844 phone viewport, zoom 100%.
5. Open a second tab on Solana Explorer with `?cluster=custom&customUrl=<surfnet RPC URL>` for the walkthrough.
6. Keep the `demo:record` terminal visible in a corner or in a second window. Pressing P in it sends the paycheck.

Every number on screen comes from the run itself. Don't narrate a number before it appears. If a slice waits for a different reason than expected, narrate the reason the app shows.

## Pitch video (3:00 or less)

| Time | Beat | On screen | Say (roughly) |
| --- | --- | --- | --- |
| 0:00–0:15 | Tolu | Landing hero, then the phone viewport on `/app` with "Turn your next paycheck into stocks" | "Tolu is a frontend engineer in Lagos, paid in USDC by a US company. It lands in her wallet and sits there. From today, a slice of it becomes stock the moment it lands." |
| 0:15–0:35 | The gap | Landing section with the PreStocks premium strip (live) and the fee comparison | "More than half of stablecoin pay stays idle. The exchange route costs 2% a trade. Off-hours prices drift. Right now OpenAI PreStocks trades about 30% over its mark." Read the live number from the strip. |
| 0:35–1:20 | Setup, under a minute | `/app/onboarding`: welcome → sign in with the demo wallet → eligibility → wallet → split (Pre-IPO spice: SPYx, NVDAx, Anthropic, OpenAI) → allowance (3 paychecks) → review → "Sign and go live" → done | "Connect, pick a split, set an allowance of three paychecks, one signature." Point at the review line that says what the signature can and can't do. |
| 1:20–2:05 | Payday on the fork | `/app` home. Press P in the terminal. The paycheck card appears, the split animates, slices go Executing → Executed → Verified; the OpenAI segment turns hatched amber with its reason. Tap into `/app/paychecks/[id]` | "This is a Surfpool fork of mainnet: the real Jupiter pools, the real xStocks and PreStocks mints, real Pyth prices, no real money. An employer wallet sends $1,850. Three slices buy and verify. OpenAI waits, because it's trading over its mark, and it says so." |
| 2:05–2:35 | Why Solana | Paycheck detail proof drawer on one Verified slice (Pyth feed, publish time, computed minimum, delivered) | "Payroll stablecoins and 95% of onchain stock volume are on the same chain. Slices this small only make sense at sub-cent fees. xStocks carry dividends in Token-2022, and the price check happens inside the program." |
| 2:35–2:55 | Proof | `/proof` page, then a terminal running `npx @paycheck-router/verify --bundle evidence/stocklana-fork` printing PASS per slice, then `pnpm demo:fork` starting | "Every slice has a public proof, and anyone can re-check it against Pyth history with one command, or replay the whole run from a clean clone." |
| 2:55–3:00 | Close | Logo and URL | "Your paycheck, turned into stocks the moment it lands." |

## Technical walkthrough (5:00 or less)

| Time | Beat | On screen |
| --- | --- | --- |
| 0:00–0:40 | Accounts and PDAs | Repository `programs/paycheck_router/src/state`: Config, Asset, Router, Authority, Convert authority, Paycheck, with their seeds. The Authority PDA is the SPL delegate on the owner's USDC and the Jupiter taker, and holds nothing between instructions. |
| 0:40–1:20 | The guard | `docs/ARCHITECTURE.md` guard section: minimum shares from the Pyth USDC price, the Pyth share price, the band and the Scaled UI multiplier, all in fixed point, floored. Mention the TypeScript reference model that must match the program to the base unit. |
| 1:20–2:30 | One execute_leg, stepped through | Solana Explorer on the surfnet: the canonical run's `execute_leg` transaction. Walk the instructions: compute budget, Pyth price update accounts, ATA creation, `execute_leg` with the fee transfer, the move into the Authority's USDC account, the Jupiter CPI, the delta checks and the `LegExecuted` event. Then the `surfnet_profileTransaction` output for compute per instruction. |
| 2:30–3:10 | The crank | `apps/core`: the reconcile sweep on a 2-second Durable Object alarm (Helius webhooks on mainnet), the RouterActor serialising one router, the executor running the leg pipeline, the verifier re-reading the chain. |
| 3:10–3:40 | Pyth and PreStocks | Pyth posting with full verification and closed update accounts; the Ed25519 mark attestation placed right before `execute_prestock_leg`, and the OpenAI slice's simulation log showing OutputBelowMinimum. |
| 3:40–4:20 | Evidence | `evidence/stocklana-fork/` manifest, the verifier output, `/proof`. What the fork proves: the program, the real routes and real prices. What waits for mainnet: real money, congestion, a second RPC provider and speed claims. |
| 4:20–5:00 | Trust model and repo tour | `docs/SECURITY.md` key table (no key can move user funds), one `revoke` cuts everything off, then a quick tour of `programs/`, `packages/sdk`, `apps/core`, `apps/web`, `packages/verify`. |
