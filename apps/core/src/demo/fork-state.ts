import type { api } from "@paycheck-router/shared";
import { eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import {
  conversions,
  crankTxs,
  demoFundings,
  demoPaychecks,
  feeLedger,
  idempotencyKeys,
  inflows,
  paychecks,
  proofRuns,
  routers,
  submittedTxs,
  swaps,
} from "../db/schema.ts";
import type { Env } from "../env.ts";
import type { ForkEpoch } from "./surfnet.ts";

/** How often the InflowWatcher reads the fork's marker to notice a reset. */
export const EPOCH_CHECK_MS = 10_000;
/** Around a scheduled reset an unreachable fork is `resetting`; outside it, `down`. */
const RESET_WINDOW_BEFORE_MS = 5 * 60_000;
const RESET_WINDOW_AFTER_MS = 20 * 60_000;

/** What the InflowWatcher last saw: the fork's epoch, and whether the fork answered. */
export type ForkView = { epoch: ForkEpoch | null; reachable: boolean };

/** `RESET_EVERY_HOURS` in milliseconds, or null where the fork does not reset on a schedule. */
export function resetIntervalMs(env: Env): number | null {
  const hours = Number(env.RESET_EVERY_HOURS);
  return env.RESET_EVERY_HOURS && Number.isFinite(hours) && hours > 0 ? hours * 3_600_000 : null;
}

export function demoStatus(view: ForkView, intervalMs: number | null, now: number): api.DemoStatus {
  const lastResetAt = view.epoch?.startedAt ?? null;
  const resetsAt = lastResetAt !== null && intervalMs !== null ? lastResetAt + intervalMs : null;
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  let state: api.DemoStatus["state"] = "up";
  if (!view.reachable || !view.epoch) {
    const inWindow =
      resetsAt !== null &&
      now >= resetsAt - RESET_WINDOW_BEFORE_MS &&
      now <= resetsAt + RESET_WINDOW_AFTER_MS;
    state = inWindow ? "resetting" : "down";
  }
  return { state, resetsAt: iso(resetsAt), lastResetAt: iso(lastResetAt) };
}

/**
 * Deletes every row that points at accounts or signatures on the previous fork: routers and their
 * paychecks, legs, attempts and verifications, swaps, submitted transactions and stored
 * idempotent responses. Users, wallets and sessions stay, so people remain signed in. Only for
 * the hosted fork's own database, which holds nothing else.
 */
export async function clearForkRows(db: Db, previousEpoch: string): Promise<void> {
  await db.delete(feeLedger);
  await db.delete(proofRuns).where(isNotNull(proofRuns.legId));
  await db.delete(paychecks);
  await db.delete(inflows);
  await db.delete(conversions);
  await db.delete(crankTxs);
  await db.delete(swaps);
  await db.delete(routers);
  await db.delete(submittedTxs);
  await db.delete(idempotencyKeys);
  await db.delete(demoFundings).where(eq(demoFundings.epoch, previousEpoch));
  await db.delete(demoPaychecks).where(eq(demoPaychecks.epoch, previousEpoch));
}
