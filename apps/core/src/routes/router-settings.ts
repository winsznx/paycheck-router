import { api } from "@paycheck-router/shared";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { inflows, payerTags, routers } from "../db/schema.ts";
import type { AppEnv } from "../http/context.ts";
import { readJson } from "../http/json.ts";
import { notFound, parseOrThrow } from "../http/problem.ts";
import { rateLimit } from "../http/rate-limit.ts";
import { requireSession, sessionOf } from "../http/session.ts";
import { activateRouter, ownedRouter } from "../services/routers.ts";

export const routerSettingsRoutes = new Hono<AppEnv>();

routerSettingsRoutes.use("/routers/:id/*", requireSession, rateLimit("USER_LIMITER", "user"));

const INFLOW_WINDOW = 200;

routerSettingsRoutes.get("/routers/:id/inflows", async (c) => {
  const { db } = c.var.services;
  const { userId } = sessionOf(c);
  const router = await ownedRouter(db, userId, parseOrThrow(api.Uuid, c.req.param("id")));
  if (!router) throw notFound("Router");
  const rows = await db
    .select()
    .from(inflows)
    .where(eq(inflows.routerId, router.id))
    .orderBy(desc(inflows.createdAt))
    .limit(INFLOW_WINDOW);
  const tags = await db.select().from(payerTags).where(eq(payerTags.routerId, router.id));
  const labels = new Map(tags.map((tag) => [tag.payerOwner, tag.label]));
  const grouped = new Map<string, { count: number; total: bigint; lastAt: Date }>();
  for (const row of rows) {
    const key = row.senderOwner ?? "";
    const entry = grouped.get(key) ?? { count: 0, total: 0n, lastAt: row.createdAt };
    entry.count += 1;
    entry.total += row.amount;
    if (row.createdAt > entry.lastAt) entry.lastAt = row.createdAt;
    grouped.set(key, entry);
  }
  const body: api.RouterInflowsResponse = {
    senders: [...grouped.entries()]
      .sort((a, b) => b[1].lastAt.getTime() - a[1].lastAt.getTime())
      .map(([sender, entry]) => ({
        sender: sender || null,
        label: labels.get(sender) ?? null,
        tagged: labels.has(sender),
        count: entry.count,
        total: entry.total.toString(),
        lastAt: entry.lastAt.toISOString(),
      })),
  };
  return c.json(body);
});

routerSettingsRoutes.put("/routers/:id/payers", async (c) => {
  const { db, now } = c.var.services;
  const { userId } = sessionOf(c);
  const router = await ownedRouter(db, userId, parseOrThrow(api.Uuid, c.req.param("id")));
  if (!router) throw notFound("Router");
  const body = parseOrThrow(api.PutPayersRequest, await readJson(c));
  await db.delete(payerTags).where(eq(payerTags.routerId, router.id));
  if (body.tags.length > 0) {
    await db.insert(payerTags).values(
      body.tags.map((tag) => ({
        routerId: router.id,
        payerOwner: tag.payerOwner,
        label: tag.label,
      })),
    );
  }
  const [updated] = await db
    .update(routers)
    .set({ payerRule: body.payerRule, updatedAt: now() })
    .where(eq(routers.id, router.id))
    .returning();
  if (updated) await activateRouter(c.env, db, updated);
  return c.json(body);
});
