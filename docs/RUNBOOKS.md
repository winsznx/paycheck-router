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

## Hosted fork demo

| Symptom | Action |
| --- | --- |
| `/demo/status` says the fork is down | On the VPS, `systemctl status paycheck-surfnet` and `journalctl -u paycheck-surfnet -n 100`. `systemctl restart paycheck-surfnet` starts a fresh fork from the snapshot; core notices the new epoch and clears the old fork's rows |
| Core gets 403 from the fork | The `SURFNET_RPC_KEY` secret on `paycheck-router-demo-core` doesn't match the key in the Caddy block. Set them to the same value and reload Caddy |
| The fork's memory keeps growing | systemd holds it at 1 GB and the 6-hour restart clears it. For an early reset, restart the service |
| Pre-IPO slices fail with `PriceStale` (6012) | The fork's clock ran ahead of wall time. Check `journalctl -u paycheck-surfnet-clock`; the watchdog pauses the clock whenever it is 1 s or more ahead |
| Slices wait in LANDING with `PreStocks API 429` or `Jupiter build 429` in the core logs | The upstream is rate-limiting the fork host's IP. PreStocks denies part of its traffic by design and retries absorb it. For Jupiter, check that `JUPITER_API_KEY` is set on `paycheck-router-demo-core` |
| The program or protocol accounts are missing after a restart | The snapshot is stale or incomplete. Re-run `scripts/hosted-demo/bootstrap.ts` against a local surfnet, upload the new snapshot and restart. If the lookup table address changed, update `PROTOCOL_ALT` for `env.hosted` in `apps/core/wrangler.jsonc` and redeploy core |
