import { createApp } from "./app.ts";
import { createChainClient } from "./chain/client.ts";
import { chainEndpoints } from "./config.ts";
import { handleScheduled } from "./crons/index.ts";
import { createDb } from "./db/client.ts";
import { inflowWatcher } from "./do/stubs.ts";
import { createEngine } from "./engine/factory.ts";
import type { Env } from "./env.ts";
import { log } from "./log.ts";
import { handleQueue } from "./queues/index.ts";

export { InflowWatcher } from "./do/inflow-watcher.ts";
export { RateGate } from "./do/rate-gate.ts";
export { RouterActor } from "./do/router-actor.ts";
export { UserHub } from "./do/user-hub.ts";

const app = createApp((env) => ({
  db: createDb(env.HYPERDRIVE),
  chain: createChainClient(chainEndpoints(env)),
  engine: () => createEngine(env),
  now: () => new Date(),
}));

let watcherStarted = false;

export default {
  fetch(request, env, ctx) {
    if (env.SURFNET_RPC_URL && !watcherStarted) {
      watcherStarted = true;
      ctx.waitUntil(
        inflowWatcher(env)
          .ensureRunning()
          .catch((error: unknown) => {
            watcherStarted = false;
            log.warn("could not start the surfnet sweep", { error });
          }),
      );
    }
    return app.fetch(request, env, ctx);
  },
  queue: handleQueue,
  scheduled: handleScheduled,
} satisfies ExportedHandler<Env>;
