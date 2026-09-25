import { api, USDC_FEED_ID } from "@paycheck-router/shared";
import { desc } from "drizzle-orm";
import { Hono } from "hono";
import { verifyTurnstile } from "../compliance/turnstile.ts";
import { environment } from "../config.ts";
import { statusSnapshots, waitlist } from "../db/schema.ts";
import type { AppEnv, Services } from "../http/context.ts";
import { readJson } from "../http/json.ts";
import { ApiError, notConfigured, parseOrThrow } from "../http/problem.ts";
import { rateLimit } from "../http/rate-limit.ts";
import { latestPrices } from "../pricing/hermes.ts";

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.use("/status", rateLimit("PUBLIC_LIMITER", "ip"));
publicRoutes.use("/waitlist", rateLimit("AUTH_LIMITER", "ip"));

type Component = api.StatusResponse["components"][number];

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
  const [chain, pricing, snapshots] = await Promise.all([
    probeChain(services),
    probePricing(c.env, services),
    services.db
      .selectDistinctOn([statusSnapshots.component])
      .from(statusSnapshots)
      .orderBy(statusSnapshots.component, desc(statusSnapshots.capturedAt)),
  ]);
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
      fromSnapshot("detection"),
      fromSnapshot("execution"),
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
