import { api } from "@paycheck-router/shared";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { assets, submittedTxs, users, wallets } from "../db/schema.ts";
import type { AppEnv } from "../http/context.ts";
import { readJson } from "../http/json.ts";
import { ApiError, forbidden, parseOrThrow } from "../http/problem.ts";
import { rateLimit } from "../http/rate-limit.ts";
import { requireSession, sessionOf } from "../http/session.ts";
import { routersOf, routerView, syncUserRouters } from "../services/routers.ts";

export const routerRoutes = new Hono<AppEnv>();

routerRoutes.use("/routers", requireSession, rateLimit("USER_LIMITER", "user"));
routerRoutes.use("/routers/*", requireSession);
routerRoutes.use("/routers/tx/*", rateLimit("TX_LIMITER", "user"));

const SPONSORED_SETUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const BUILDER_TTL_MS = 60_000;

routerRoutes.get("/routers", async (c) => {
  const services = c.var.services;
  const { userId } = sessionOf(c);
  await syncUserRouters(c.env, services, userId);
  const rows = await routersOf(services.db, userId);
  const views: api.Router[] = [];
  for (const row of rows) views.push(await routerView(c.env, services, row));
  const body: api.RoutersResponse = { routers: views };
  return c.json(body);
});

routerRoutes.post("/routers/tx/create", async (c) => {
  const services = c.var.services;
  const { db, now } = services;
  const { userId } = sessionOf(c);
  const body = parseOrThrow(api.CreateRouterTxRequest, await readJson(c));

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (user?.eligibilityStatus !== "eligible") {
    throw new ApiError(403, "ineligible", "Finish the eligibility step before creating a router");
  }
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.address, body.wallet)))
    .limit(1);
  if (!wallet) throw forbidden("That wallet is not linked to this account");

  const recent = await db
    .select({ signature: submittedTxs.signature })
    .from(submittedTxs)
    .where(
      and(
        eq(submittedTxs.kind, "router.create"),
        inArray(submittedTxs.status, ["confirmed", "finalized"]),
        sql`${submittedTxs.context}->>'wallet' = ${body.wallet}`,
        gt(submittedTxs.submittedAt, new Date(now().getTime() - SPONSORED_SETUP_WINDOW_MS)),
      ),
    )
    .limit(1);
  if (recent.length > 0) {
    throw new ApiError(
      429,
      "rate_limited",
      "This wallet already had a sponsored setup in the last 30 days",
    );
  }

  const registry = await db
    .select({ mint: assets.mint, status: assets.status, maxBandBps: assets.maxBandBps })
    .from(assets)
    .where(
      inArray(
        assets.mint,
        body.legs.map((leg) => leg.mint),
      ),
    );
  const byMint = new Map(registry.map((row) => [row.mint, row]));
  for (const leg of body.legs) {
    const asset = byMint.get(leg.mint);
    if (!asset || asset.status !== "active") {
      throw new ApiError(400, "validation_failed", `${leg.mint} is not an active registry asset`);
    }
    if (leg.bandBps > asset.maxBandBps) {
      throw new ApiError(
        400,
        "validation_failed",
        `band for ${leg.mint} is above ${asset.maxBandBps} bps`,
      );
    }
  }

  const built = await services.engine().buildCreateRouter({
    owner: body.wallet,
    investBps: body.investBps,
    legs: body.legs,
    minInflow: BigInt(body.minInflow),
    dailyCap: BigInt(body.dailyCap),
    maxWaitSecs: body.maxWaitSecs,
    autoConvert: body.autoConvert,
    allowance: BigInt(body.allowance),
  });
  const response: api.TxBuildResponse = {
    tx: built.tx,
    summary: built.summary,
    expiresAt: new Date(now().getTime() + BUILDER_TTL_MS).toISOString(),
    feePayer: built.feePayer,
    lastValidBlockHeight: built.lastValidBlockHeight.toString(),
  };
  return c.json(response);
});
