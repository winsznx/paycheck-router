import { REGISTRY, USDC_FEED_ID } from "@paycheck-router/shared";
import { and, count, eq, lt } from "drizzle-orm";
import { createDb, type Db } from "../db/client.ts";
import { legs, priceSnapshots, statusSnapshots } from "../db/schema.ts";
import { inflowWatcher } from "../do/stubs.ts";
import type { Env } from "../env.ts";
import { log } from "../log.ts";
import { HermesError, latestPrices } from "../pricing/hermes.ts";
import { jupiterPrices } from "../pricing/reference.ts";

const PRICE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

async function snapshot(
  db: Db,
  component: string,
  status: string,
  metrics: Record<string, unknown>,
): Promise<void> {
  await db.insert(statusSnapshots).values({ component, status, metrics });
}

/** Execution, routing and notification health for `/status` history (section 26.3). */
async function statusSnapshotJob(env: Env, db: Db): Promise<void> {
  const stuckBefore = new Date(Date.now() - 5 * 60 * 1000);
  const [stuck] = await db
    .select({ n: count() })
    .from(legs)
    .where(and(eq(legs.status, "executing"), lt(legs.executingSince, stuckBefore)));
  await snapshot(db, "execution", (stuck?.n ?? 0) > 0 ? "degraded" : "operational", {
    stuckExecuting: stuck?.n ?? 0,
  });
  const started = Date.now();
  try {
    const prices = await jupiterPrices(env, [REGISTRY[0]?.mint ?? ""]);
    await snapshot(db, "routing", prices.size > 0 ? "operational" : "degraded", {
      latencyMs: Date.now() - started,
    });
  } catch (error) {
    await snapshot(db, "routing", "down", { error: String(error) });
  }
  const email = Boolean(env.RESEND_API_KEY && env.RESEND_FROM);
  const telegram = Boolean(env.TELEGRAM_BOT_TOKEN);
  await snapshot(db, "notifications", email || telegram ? "operational" : "unknown", {
    email: email ? "configured" : "not configured",
    telegram: telegram ? "configured" : "not configured",
    push: "not built",
  });
}

/** Five-minute Pyth snapshots that feed the 30-day series; a refused feed group is recorded. */
async function priceSnapshotJob(env: Env, db: Db): Promise<void> {
  const hermes = { url: env.HERMES_URL, apiKey: env.PYTH_API_KEY };
  const groups = [
    [USDC_FEED_ID],
    REGISTRY.flatMap((asset) => [asset.feedId, asset.feedId247]).filter(
      (feed): feed is string => feed !== null,
    ),
  ];
  for (const feeds of groups) {
    try {
      const prices = await latestPrices(hermes, feeds);
      if (prices.length === 0) continue;
      await db.insert(priceSnapshots).values(
        prices.map((price) => ({
          feedId: price.feedId,
          price: price.price,
          conf: price.conf,
          expo: price.exponent,
          publishTime: price.publishTime,
        })),
      );
    } catch (error) {
      const refused =
        error instanceof HermesError && (error.status === 401 || error.status === 403);
      await snapshot(db, "pricing", refused ? "degraded" : "down", {
        feeds: feeds.length,
        error: refused ? "not entitled" : String(error),
      });
    }
  }
}

/** Price snapshots older than 90 days leave the database (section 10.4). */
async function retentionJob(db: Db): Promise<void> {
  await db
    .delete(priceSnapshots)
    .where(lt(priceSnapshots.capturedAt, new Date(Date.now() - PRICE_RETENTION_MS)));
}

/**
 * Section 9.4. On surfnets the reconcile sweep runs from the InflowWatcher's 2-second alarm, so
 * the minute cron only makes sure that loop is alive.
 */
export async function handleScheduled(controller: ScheduledController, env: Env): Promise<void> {
  const db = createDb(env.HYPERDRIVE);
  try {
    switch (controller.cron) {
      case "* * * * *": {
        const watcher = inflowWatcher(env);
        if (env.SURFNET_RPC_URL) await watcher.ensureRunning();
        else await watcher.sweep();
        await statusSnapshotJob(env, db);
        return;
      }
      case "*/5 * * * *":
        await priceSnapshotJob(env, db);
        return;
      case "15 3 * * *":
        await retentionJob(db);
        return;
      default:
        log.info("cron has no job in this build", { cron: controller.cron });
    }
  } catch (error) {
    log.error("cron failed", { cron: controller.cron, error });
    throw error;
  }
}
