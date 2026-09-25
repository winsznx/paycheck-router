import { api } from "@paycheck-router/shared";
import { count, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import {
  adminUsers,
  attempts,
  auditLog,
  legs,
  paychecks,
  routers,
  users,
  wallets,
} from "../db/schema.ts";
import { CRANK_PAUSED_KEY } from "../flags.ts";
import type { AppEnv } from "../http/context.ts";
import { readJson } from "../http/json.ts";
import { forbidden, notFound, parseOrThrow } from "../http/problem.ts";
import { rateLimit } from "../http/rate-limit.ts";
import { requireSession, sessionOf } from "../http/session.ts";

export const adminRoutes = new Hono<AppEnv>();

type Role = "admin" | "support" | "viewer";

function requireRole(allowed: readonly Role[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const { userId } = sessionOf(c);
    const [row] = await c.var.services.db
      .select({ role: adminUsers.role })
      .from(adminUsers)
      .where(eq(adminUsers.userId, userId))
      .limit(1);
    if (!row || !allowed.includes(row.role)) throw forbidden("Admin access only");
    await next();
  });
}

adminRoutes.use("/admin/*", requireSession, rateLimit("USER_LIMITER", "user"));
adminRoutes.use("/admin/*", requireRole(["admin", "support", "viewer"]));

adminRoutes.get("/admin/overview", async (c) => {
  const { db } = c.var.services;
  const [userCount] = await db.select({ n: count() }).from(users);
  const [routerCount] = await db
    .select({ n: count() })
    .from(routers)
    .where(eq(routers.status, "active"));
  const [paycheckCount] = await db.select({ n: count() }).from(paychecks);
  const byStatus = await db
    .select({ status: legs.status, n: count() })
    .from(legs)
    .groupBy(legs.status);
  const waits = await db
    .select({ reason: legs.waitReason, n: count() })
    .from(legs)
    .where(eq(legs.status, "waiting"))
    .groupBy(legs.waitReason);
  return c.json({
    users: userCount?.n ?? 0,
    activeRouters: routerCount?.n ?? 0,
    paychecks: paycheckCount?.n ?? 0,
    legsByStatus: Object.fromEntries(byStatus.map((row) => [row.status, row.n])),
    waitingByReason: Object.fromEntries(waits.map((row) => [row.reason ?? "unknown", row.n])),
    crankPaused: (await c.env.REGISTRY.get(CRANK_PAUSED_KEY)) === "1",
  });
});

/** Read-only lookup of one wallet's account, routers and recent slices. */
adminRoutes.get("/admin/lookup", async (c) => {
  const { db } = c.var.services;
  const wallet = parseOrThrow(api.AddressString, c.req.query("wallet"));
  const [linked] = await db
    .select({ user: users })
    .from(wallets)
    .innerJoin(users, eq(users.id, wallets.userId))
    .where(eq(wallets.address, wallet))
    .limit(1);
  if (!linked) throw notFound("Wallet");
  const owned = await db.select().from(routers).where(eq(routers.userId, linked.user.id));
  const recent =
    owned.length === 0
      ? []
      : await db
          .select({ paycheck: paychecks })
          .from(paychecks)
          .where(
            inArray(
              paychecks.routerId,
              owned.map((router) => router.id),
            ),
          )
          .orderBy(desc(paychecks.recordedAt))
          .limit(10);
  const paycheckIds = recent.map((row) => row.paycheck.id);
  const legRows =
    paycheckIds.length === 0
      ? []
      : await db.select().from(legs).where(inArray(legs.paycheckId, paycheckIds));
  const legIds = legRows.map((leg) => leg.id);
  const lastAttempts =
    legIds.length === 0
      ? []
      : await db
          .select()
          .from(attempts)
          .where(inArray(attempts.legId, legIds))
          .orderBy(desc(attempts.createdAt))
          .limit(50);
  return c.json(
    JSON.parse(
      JSON.stringify(
        {
          user: {
            id: linked.user.id,
            eligibilityStatus: linked.user.eligibilityStatus,
            countryDeclared: linked.user.countryDeclared,
            countryIpLast: linked.user.countryIpLast,
            createdAt: linked.user.createdAt,
          },
          routers: owned.map((router) => ({
            id: router.id,
            routerPda: router.routerPda,
            status: router.status,
            investBps: router.investBps,
          })),
          paychecks: recent.map((row) => ({
            ...row.paycheck,
            legs: legRows.filter((leg) => leg.paycheckId === row.paycheck.id),
          })),
          attempts: lastAttempts,
        },
        (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      ),
    ),
  );
});

adminRoutes.get("/admin/audit", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 100) || 100, 500);
  const rows = await c.var.services.db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
  return c.json({
    entries: rows.map((row) => ({
      ...row,
      id: row.id.toString(),
      createdAt: row.createdAt.toISOString(),
    })),
  });
});

const CrankPauseRequest = z.object({ paused: z.boolean(), reason: z.string().max(200) });

/** Stops (or resumes) every execution the crank would dispatch; admins only, audited. */
adminRoutes.post("/admin/crank/pause", requireRole(["admin"]), async (c) => {
  const body = parseOrThrow(CrankPauseRequest, await readJson(c));
  const { userId } = sessionOf(c);
  if (body.paused) await c.env.REGISTRY.put(CRANK_PAUSED_KEY, "1");
  else await c.env.REGISTRY.delete(CRANK_PAUSED_KEY);
  await c.var.services.db.insert(auditLog).values({
    actorType: "admin",
    actorId: userId,
    action: body.paused ? "crank.pause" : "crank.resume",
    target: "crank",
    details: { reason: body.reason },
    ip: c.req.header("cf-connecting-ip") ?? null,
  });
  return c.json({ crankPaused: body.paused });
});
