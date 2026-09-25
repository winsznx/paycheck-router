# Runbooks

What to check and what to do for each known failure. Every paycheck is traceable from inflow to verified shares by `router:seq:leg:attempt` in the logs, the database and the evidence bundle.

| Symptom | Diagnosis | Action |
| --- | --- | --- |
| Webhook lag or a Helius outage | Reconciler catches rising; Helius status page | The reconcile sweep keeps detection alive. If Helius RPC is down, swap provider roles by environment variable so sending and verifying still use different providers |
| Jupiter 429 or 5xx | Rate-gate queue depth, error rate | Slices wait with LANDING. After 30 minutes, post an incident banner. Move to the paid plan if the rate limit is the cause |
| Pyth updates stale | Hermes latency and publish times | Nothing buys without fresh prices, by design. Slices wait with MARKET_CLOSED or PRICE_UNCERTAIN. Add an incident note if Hermes itself is degraded |
| Crank or sponsor SOL below 0.5 | Balance metric | The ops wallet swaps USDC to SOL through Jupiter and tops the key up to 1.0 SOL. Alert if the ops wallet is low |
| xStocks mint paused | The mint's Pausable flag | The crank marks slices ASSET_PAUSED without sending. The admin sets the asset status by proposal if it lasts |
| PreStocks API down | Attester errors | PreStocks slices wait on stale attestations. Alert |
| Unverified slice | Verifier diff | Page on-call, hold further executions for that router, and publish the diff and the cause |
| Supabase unavailable | Hyperdrive errors | The API reads money state straight from chain; Durable Objects buffer offchain writes and flush on recovery |
| Dead-letter messages | DLQ depth | Inspect in admin and replay after the cause is fixed |
| Suspected exploit | Any invariant alert | SEV1: the guardian sets the global pause, status page, email every user, investigate, timelocked fix, public post-mortem |
| Upgrade proposed | Squads proposal event | Email users with the diff summary and revoke instructions, and watch through the 48-hour timelock |

## On a fork

| Symptom | Action |
| --- | --- |
| A route fails with a zero-amount error in a later hop | A proprietary AMM slipped into the route. Add its label to `FORK_EXCLUDED_DEXES` and re-run; see [DECISIONS.md](DECISIONS.md) |
| Price checks fail right after start | The surfnet clock drifted more than 5 s from wall time. Start a fresh surfnet; `pnpm demo:fork` refuses to run in that state |
| A pool's price looks hours old | Surfpool keeps its first copy of an account. `surfnet_resetAccount` the pool, or start a fresh surfnet |
| Explorer shows nothing | Open Solana Explorer with `?cluster=custom&customUrl=<surfnet RPC>`; the fork isn't visible on mainnet explorers |
