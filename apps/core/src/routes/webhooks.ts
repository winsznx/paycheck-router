import { api } from "@paycheck-router/shared";
import { Hono } from "hono";
import { inflowWatcher } from "../do/stubs.ts";
import type { AppEnv } from "../http/context.ts";
import { readJson } from "../http/json.ts";
import { notConfigured, parseOrThrow, unauthorized } from "../http/problem.ts";
import { rateLimit } from "../http/rate-limit.ts";
import { log } from "../log.ts";

export const webhookRoutes = new Hono<AppEnv>();

/** Constant-time string comparison through SHA-256 digests of equal length. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

/**
 * Helius account webhook for pay-in accounts. The secret is checked before anything else runs;
 * a delivery triggers the reconcile sweep, which reads the balances itself, so a webhook can
 * only make detection sooner and never decides what counts as an inflow.
 */
webhookRoutes.post("/webhooks/helius", async (c) => {
  if (!c.env.HELIUS_WEBHOOK_SECRET) throw notConfigured("The Helius webhook");
  const given = c.req.header("authorization") ?? "";
  if (!(await sameSecret(given, c.env.HELIUS_WEBHOOK_SECRET)))
    throw unauthorized("Bad webhook secret");
  const events = await readJson(c);
  const count = Array.isArray(events) ? events.length : 0;
  c.executionCtx.waitUntil(
    inflowWatcher(c.env)
      .sweep()
      .then((hits) => log.info("webhook sweep", { events: count, hits: hits.length }))
      .catch((error: unknown) => log.error("webhook sweep failed", { error })),
  );
  return c.json({ accepted: count }, 202);
});

webhookRoutes.use("/metrics", rateLimit("PUBLIC_LIMITER", "ip"));

/** Web-vitals beacons into Analytics Engine (section 11.2). */
webhookRoutes.post("/metrics", async (c) => {
  const beacon = parseOrThrow(api.MetricBeacon, await readJson(c));
  c.env.METRICS.writeDataPoint({
    indexes: [beacon.name],
    blobs: [beacon.name, beacon.route, beacon.deviceClass, c.env.ENVIRONMENT],
    doubles: [beacon.value],
  });
  return c.body(null, 204);
});
