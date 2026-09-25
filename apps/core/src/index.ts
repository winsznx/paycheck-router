import { createApp } from "./app.ts";
import { handleScheduled } from "./crons/index.ts";
import { inflowWatcher } from "./do/stubs.ts";
import { setDefaultEngine } from "./engine/factory.ts";
import { createSdkEngine } from "./engine/sdk.ts";
import type { Env } from "./env.ts";
import { log } from "./log.ts";
import { handleQueue } from "./queues/index.ts";
import { createServices } from "./services/factory.ts";

export { InflowWatcher } from "./do/inflow-watcher.ts";
export { MarkBook } from "./do/mark-book.ts";
export { RateGate } from "./do/rate-gate.ts";
export { RouterActor } from "./do/router-actor.ts";
export { UserHub } from "./do/user-hub.ts";

setDefaultEngine(createSdkEngine);

const app = createApp(createServices);

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
