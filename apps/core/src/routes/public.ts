import { api, USDC_FEED_ID } from "@paycheck-router/shared";
import { and, count, desc, eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { verifyTurnstile } from "../compliance/turnstile.ts";
import { environment } from "../config.ts";
import { legs, statusSnapshots, waitlist } from "../db/schema.ts";
import { inflowWatcher } from "../do/stubs.ts";
import type { AppEnv, Services } from "../http/context.ts";
import { readJson } from "../http/json.ts";
import { ApiError, notConfigured, parseOrThrow } from "../http/problem.ts";
import { rateLimit } from "../http/rate-limit.ts";
import { openApiDocument } from "../openapi.ts";
import { latestPrices } from "../pricing/hermes.ts";

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.use("/status", rateLimit("PUBLIC_LIMITER", "ip"));
publicRoutes.use("/waitlist", rateLimit("AUTH_LIMITER", "ip"));

type Component = api.StatusResponse["components"][number];

/** Detection health from the InflowWatcher's last sweep (every 2 s on surfnets, 60 s elsewhere). */
async function probeDetection(env: AppEnv["Bindings"], services: Services): Promise<Component> {
  const checkedAt = services.now();
  try {
    const sweep = await inflowWatcher(env).lastSweep();
    if (!sweep) {
      return {
        id: "detection",
        status: "unknown",
        detail: "No sweep has run yet",
        checkedAt: checkedAt.toISOString(),
      };
    }
    const ageSecs = Math.round((checkedAt.getTime() - sweep.at) / 1000);
    const limit = env.SURFNET_RPC_URL ? 10 : 120;
    const status = sweep.error ? "down" : ageSecs <= limit ? "operational" : "degraded";
    const detail = sweep.error
      ? `Last sweep failed: ${sweep.error}`
      : `Last sweep ${ageSecs}s ago over ${sweep.routers} routers, ${sweep.hits} new inflows`;
    return { id: "detection", status, detail, checkedAt: checkedAt.toISOString() };
  } catch (error) {
    return {
      id: "detection",
      status: "down",
      detail: String(error),
      checkedAt: checkedAt.toISOString(),
    };
  }
}

/** Execution health: no slice should sit in `executing` for more than five minutes. */
async function probeExecution(services: Services): Promise<Component> {
  const checkedAt = services.now();
  const stuckBefore = new Date(checkedAt.getTime() - 5 * 60 * 1000);
  const [stuck] = await services.db
    .select({ n: count() })
    .from(legs)
    .where(and(eq(legs.status, "executing"), lt(legs.executingSince, stuckBefore)));
  const [waiting] = await services.db
    .select({ n: count() })
    .from(legs)
    .where(eq(legs.status, "waiting"));
  const stuckCount = stuck?.n ?? 0;
  return {
    id: "execution",
    status: stuckCount > 0 ? "degraded" : "operational",
    detail: `${stuckCount} slices executing for over 5 minutes, ${waiting?.n ?? 0} waiting`,
    checkedAt: checkedAt.toISOString(),
  };
}

async function probeChain(services: Services): Promise<Component> {
  const checkedAt = services.now().toISOString();
  try {
    const slot = await services.chain.rpc.getSlot({ commitment: "confirmed" }).send();
    const where = services.chain.endpoints.surfnet ? "surfnet" : "mainnet RPC";
    return { id: "chain", status: "operational", detail: `${where} at slot ${slot}`, checkedAt };
  } catch (error) {
    return { id: "chain", status: "down", detail: String(error), checkedAt };
  }
}

async function probePricing(env: AppEnv["Bindings"], services: Services): Promise<Component> {
  const checkedAt = services.now();
  try {
    const [usdc] = await latestPrices({ url: env.HERMES_URL, apiKey: env.PYTH_API_KEY }, [
      USDC_FEED_ID,
    ]);
    if (!usdc) throw new Error("Hermes returned no USDC/USD update");
    const ageSecs = Math.round((checkedAt.getTime() - usdc.publishTime.getTime()) / 1000);
    return {
      id: "pricing",
      status: ageSecs <= 30 ? "operational" : "degraded",
      detail: `USDC/USD published ${ageSecs}s ago`,
      checkedAt: checkedAt.toISOString(),
    };
  } catch (error) {
    return {
      id: "pricing",
      status: "down",
      detail: String(error),
      checkedAt: checkedAt.toISOString(),
    };
  }
}

publicRoutes.get("/status", async (c) => {
  const services = c.var.services;
  const [chain, pricing, detection, snapshots] = await Promise.all([
    probeChain(services),
    probePricing(c.env, services),
    probeDetection(c.env, services),
    services.db
      .selectDistinctOn([statusSnapshots.component])
      .from(statusSnapshots)
      .orderBy(statusSnapshots.component, desc(statusSnapshots.capturedAt)),
  ]);
  // After the parallel reads: the execution probe queries the database on its own.
  const execution = await probeExecution(services);
  const recorded = new Map(snapshots.map((row) => [row.component, row]));
  const fromSnapshot = (id: Component["id"]): Component => {
    const row = recorded.get(id);
    if (!row) {
      return {
        id,
        status: "unknown",
        detail: "No snapshot recorded yet",
        checkedAt: services.now().toISOString(),
      };
    }
    const parsed = api.ComponentHealth.safeParse(row.status);
    return {
      id,
      status: parsed.success ? parsed.data : "unknown",
      detail: typeof row.metrics === "object" && row.metrics ? JSON.stringify(row.metrics) : "",
      checkedAt: row.capturedAt.toISOString(),
    };
  };
  const body: api.StatusResponse = {
    environment: environment(c.env),
    components: [
      detection,
      execution,
      pricing,
      fromSnapshot("routing"),
      chain,
      fromSnapshot("notifications"),
      {
        id: "api",
        status: "operational",
        detail: "Serving requests",
        checkedAt: services.now().toISOString(),
      },
    ],
    asOf: services.now().toISOString(),
  };
  return c.json(body);
});

publicRoutes.post("/waitlist", async (c) => {
  const body = parseOrThrow(api.WaitlistRequest, await readJson(c));
  if (!c.env.TURNSTILE_SECRET) throw notConfigured("Turnstile");
  const passed = await verifyTurnstile(
    c.env.TURNSTILE_SECRET,
    body.turnstileToken,
    c.req.header("cf-connecting-ip") ?? null,
  );
  if (!passed) throw new ApiError(403, "forbidden", "The anti-bot check did not pass");
  await c.var.services.db
    .insert(waitlist)
    .values({ email: body.email, country: body.country ?? null, source: body.source ?? null })
    .onConflictDoNothing();
  const response: api.WaitlistResponse = { ok: true };
  return c.json(response, 201);
});

publicRoutes.get("/openapi.json", (c) => c.json(openApiDocument(new URL(c.req.url).origin)));
