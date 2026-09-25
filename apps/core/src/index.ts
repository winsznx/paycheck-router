import { createApp } from "./app.ts";
import { type ChainClient, createChainClient } from "./chain/client.ts";
import { ConfigError, chainEndpoints } from "./config.ts";
import { handleScheduled } from "./crons/index.ts";
import { createDb, type Db } from "./db/client.ts";
import { inflowWatcher } from "./do/stubs.ts";
import { createEngine, setDefaultEngine } from "./engine/factory.ts";
import { createSdkEngine } from "./engine/sdk.ts";
import type { Env } from "./env.ts";
import { log } from "./log.ts";
import { handleQueue } from "./queues/index.ts";

export { InflowWatcher } from "./do/inflow-watcher.ts";
export { RateGate } from "./do/rate-gate.ts";
export { RouterActor } from "./do/router-actor.ts";
export { UserHub } from "./do/user-hub.ts";

setDefaultEngine(createSdkEngine);

const app = createApp((env) => {
  let db: Db | null = null;
  let chain: ChainClient | null = null;
  return {
    get db(): Db {
      if (!env.HYPERDRIVE) throw new ConfigError("the database (Hyperdrive) is not configured");
      db ??= createDb(env.HYPERDRIVE);
      return db;
    },
    get chain(): ChainClient {
      chain ??= createChainClient(chainEndpoints(env));
      return chain;
    },
    engine: () => createEngine(env),
    now: () => new Date(),
  };
});

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
