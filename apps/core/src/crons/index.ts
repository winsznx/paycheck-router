import { inflowWatcher } from "../do/stubs.ts";
import type { Env } from "../env.ts";
import { log } from "../log.ts";

/**
 * Section 9.4. On surfnets the reconcile sweep runs from the InflowWatcher's 2-second alarm, so
 * the minute cron only makes sure that loop is alive.
 */
export async function handleScheduled(controller: ScheduledController, env: Env): Promise<void> {
  switch (controller.cron) {
    case "* * * * *": {
      const watcher = inflowWatcher(env);
      if (env.SURFNET_RPC_URL) await watcher.ensureRunning();
      else await watcher.sweep();
      return;
    }
    default:
      log.info("cron has no job in this build", { cron: controller.cron });
  }
}
