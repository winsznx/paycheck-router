import { createApp } from "./app.ts";
import { createChainClient } from "./chain/client.ts";
import { chainEndpoints } from "./config.ts";
import { createDb } from "./db/client.ts";
import type { Env } from "./env.ts";

export { InflowWatcher } from "./do/inflow-watcher.ts";
export { RateGate } from "./do/rate-gate.ts";
export { RouterActor } from "./do/router-actor.ts";
export { UserHub } from "./do/user-hub.ts";

const app = createApp((env) => ({
  db: createDb(env.HYPERDRIVE),
  chain: createChainClient(chainEndpoints(env)),
  now: () => new Date(),
}));

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
