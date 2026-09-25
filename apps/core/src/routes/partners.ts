import { api } from "@paycheck-router/shared";
import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { newNonce, newRefreshToken, sha256Hex } from "../auth/tokens.ts";
import {
  adminUsers,
  auditLog,
  legs,
  partnerInvites,
  partnerKeys,
  partnerMembers,
  partners,
  partnerWebhooks,
  paychecks,
  routers,
} from "../db/schema.ts";
import type { AppEnv } from "../http/context.ts";
import { readJson } from "../http/json.ts";
import {
  ApiError,
  forbidden,
  notConfigured,
  notFound,
  parseOrThrow,
  unauthorized,
} from "../http/problem.ts";
import { rateLimit } from "../http/rate-limit.ts";
import { requireSession, sessionOf } from "../http/session.ts";
import { fanOut, webhookSecret } from "../partners/webhooks.ts";

type PartnerEnv = AppEnv;

export const partnerRoutes = new Hono<PartnerEnv>();

function partnerOf(c: { var: AppEnv["Variables"] }): { partnerId: string; scopes: string[] } {
  if (!c.var.partner) throw unauthorized("A partner key is required");
  return c.var.partner;
}

const KEY_PREFIX = "pk_live_";
const SCOPES = ["invites", "members", "stats", "webhooks"] as const;

/** Partner routes take `Authorization: Bearer pk_live_...`; keys are stored as SHA-256 only. */
const requirePartner = createMiddleware<PartnerEnv>(async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const key = header.startsWith(`Bearer ${KEY_PREFIX}`) ? header.slice("Bearer ".length) : null;
  if (!key) throw unauthorized("A partner key is required");
  const { db, now } = c.var.services;
  const [row] = await db
    .select({ key: partnerKeys, partner: partners })
    .from(partnerKeys)
    .innerJoin(partners, eq(partners.id, partnerKeys.partnerId))
    .where(and(eq(partnerKeys.keyHash, await sha256Hex(key)), isNull(partnerKeys.revokedAt)))
    .limit(1);
  if (!row || row.partner.disabledAt) throw unauthorized("Unknown or revoked partner key");
  await db.update(partnerKeys).set({ lastUsedAt: now() }).where(eq(partnerKeys.id, row.key.id));
  c.set("partner", { partnerId: row.partner.id, scopes: row.key.scopes });
  c.set("session", null);
  await next();
});

const scope = (name: (typeof SCOPES)[number]) =>
  createMiddleware<PartnerEnv>(async (c, next) => {
    if (!partnerOf(c).scopes.includes(name)) throw forbidden(`This key lacks the ${name} scope`);
    await next();
  });

partnerRoutes.use("/partner/*", requirePartner, rateLimit("PARTNER_LIMITER", "ip"));

partnerRoutes.post("/partner/invites", scope("invites"), async (c) => {
  const { db, now } = c.var.services;
  const body = parseOrThrow(api.CreateInviteRequest, await readJson(c));
  const code = newNonce();
  const expiresAt = body.expiresInDays
    ? new Date(now().getTime() + body.expiresInDays * 86_400_000)
    : null;
  const [invite] = await db
    .insert(partnerInvites)
    .values({ partnerId: partnerOf(c).partnerId, code, preset: body.preset, expiresAt })
    .returning();
  if (!invite) throw new Error("invite insert returned no row");
  const response: api.Invite = {
    id: invite.id,
    code,
    url: `${c.env.APP_ORIGIN}/join/${code}`,
    preset: body.preset,
    expiresAt: expiresAt?.toISOString() ?? null,
  };
  return c.json(response, 201);
});

/** Members who consented to share, with totals only: no wallets, no personal data. */
partnerRoutes.get("/partner/members", scope("members"), async (c) => {
  const { db } = c.var.services;
  const members = await db
    .select()
    .from(partnerMembers)
    .where(
      and(
        eq(partnerMembers.partnerId, partnerOf(c).partnerId),
        isNotNull(partnerMembers.consentedAt),
        isNull(partnerMembers.consentRevokedAt),
      ),
    );
  const totals =
    members.length === 0
      ? []
      : await db
          .select({
            userId: routers.userId,
            paychecks: sql<number>`count(distinct ${paychecks.id})::int`,
            invested: sql<string>`coalesce(sum(${legs.amountIn}) filter (where ${legs.status} in ('executed','verified','unverified')), 0)::text`,
          })
          .from(routers)
          .innerJoin(paychecks, eq(paychecks.routerId, routers.id))
          .leftJoin(legs, eq(legs.paycheckId, paychecks.id))
          .where(
            inArray(
              routers.userId,
              members.map((member) => member.userId),
            ),
          )
          .groupBy(routers.userId);
  const byUser = new Map(totals.map((row) => [row.userId, row]));
  const body: api.PartnerMembersResponse = {
    members: members.map((member) => ({
      memberId: member.userId,
      joinedAt: member.createdAt.toISOString(),
      consentedAt: (member.consentedAt ?? member.createdAt).toISOString(),
      paychecks: byUser.get(member.userId)?.paychecks ?? 0,
      investedUsdc: byUser.get(member.userId)?.invested ?? "0",
    })),
  };
  return c.json(body);
});

partnerRoutes.get("/partner/stats", scope("stats"), async (c) => {
  const { db } = c.var.services;
  const [partner] = await db
    .select()
    .from(partners)
    .where(eq(partners.id, partnerOf(c).partnerId))
    .limit(1);
  const consenting = db
    .select({ userId: partnerMembers.userId })
    .from(partnerMembers)
    .where(
      and(
        eq(partnerMembers.partnerId, partnerOf(c).partnerId),
        isNotNull(partnerMembers.consentedAt),
        isNull(partnerMembers.consentRevokedAt),
      ),
    );
  const [memberCount] = await db
    .select({ n: count() })
    .from(partnerMembers)
    .where(
      and(
        eq(partnerMembers.partnerId, partnerOf(c).partnerId),
        isNotNull(partnerMembers.consentedAt),
        isNull(partnerMembers.consentRevokedAt),
      ),
    );
  const [totals] = await db
    .select({
      paychecks: sql<number>`count(distinct ${paychecks.id})::int`,
      slices: sql<number>`count(${legs.id}) filter (where ${legs.status} in ('executed','verified','unverified'))::int`,
      invested: sql<string>`coalesce(sum(${legs.amountIn}) filter (where ${legs.status} in ('executed','verified','unverified')), 0)::text`,
    })
    .from(routers)
    .innerJoin(paychecks, eq(paychecks.routerId, routers.id))
    .leftJoin(legs, eq(legs.paycheckId, paychecks.id))
    .where(inArray(routers.userId, consenting));
  const body: api.PartnerStatsResponse = {
    members: memberCount?.n ?? 0,
    paychecks: totals?.paychecks ?? 0,
    slicesExecuted: totals?.slices ?? 0,
    investedUsdc: totals?.invested ?? "0",
    revenueShareBps: partner?.revenueShareBps ?? 0,
  };
  return c.json(body);
});

partnerRoutes.post("/partner/webhooks", scope("webhooks"), async (c) => {
  if (!c.env.PARTNER_WEBHOOK_SIGNING_KEY) throw notConfigured("Partner webhook signing");
  const { db } = c.var.services;
  const body = parseOrThrow(api.CreateWebhookRequest, await readJson(c));
  const [hook] = await db
    .insert(partnerWebhooks)
    .values({ partnerId: partnerOf(c).partnerId, url: body.url, events: body.events })
    .returning();
  if (!hook) throw new Error("webhook insert returned no row");
  const response: api.Webhook = {
    id: hook.id,
    url: hook.url,
    events: body.events,
    secret: await webhookSecret(c.env.PARTNER_WEBHOOK_SIGNING_KEY, hook.id),
    createdAt: hook.createdAt.toISOString(),
  };
  return c.json(response, 201);
});

partnerRoutes.delete("/partner/webhooks/:id", scope("webhooks"), async (c) => {
  const { db, now } = c.var.services;
  const id = parseOrThrow(api.Uuid, c.req.param("id"));
  const [hook] = await db
    .update(partnerWebhooks)
    .set({ disabledAt: now() })
    .where(and(eq(partnerWebhooks.id, id), eq(partnerWebhooks.partnerId, partnerOf(c).partnerId)))
    .returning({ id: partnerWebhooks.id });
  if (!hook) throw notFound("Webhook");
  return c.body(null, 204);
});

/** Public: what an invite pre-fills. */
partnerRoutes.get("/invites/:code", rateLimit("PUBLIC_LIMITER", "ip"), async (c) => {
  const { db, now } = c.var.services;
  const [row] = await db
    .select({ invite: partnerInvites, partner: partners })
    .from(partnerInvites)
    .leftJoin(partners, eq(partners.id, partnerInvites.partnerId))
    .where(eq(partnerInvites.code, c.req.param("code")))
    .limit(1);
  if (!row || row.invite.revokedAt || (row.invite.expiresAt && row.invite.expiresAt <= now())) {
    throw notFound("Invite");
  }
  const body: api.InviteView = {
    code: row.invite.code,
    partner: row.partner?.name ?? null,
    preset: row.invite.preset,
    expiresAt: row.invite.expiresAt?.toISOString() ?? null,
  };
  return c.json(body);
});

/** The signed-in user joins the inviting partner; sharing is opt-in. */
partnerRoutes.post("/invites/:code/accept", requireSession, async (c) => {
  const { db, now } = c.var.services;
  const { userId } = sessionOf(c);
  const body = parseOrThrow(api.AcceptInviteRequest, await readJson(c));
  const [invite] = await db
    .select()
    .from(partnerInvites)
    .where(eq(partnerInvites.code, c.req.param("code")))
    .limit(1);
  if (!invite || invite.revokedAt || (invite.expiresAt && invite.expiresAt <= now())) {
    throw notFound("Invite");
  }
  if (!invite.partnerId) throw new ApiError(409, "conflict", "This is a personal invite");
  await db
    .insert(partnerMembers)
    .values({
      partnerId: invite.partnerId,
      userId,
      inviteId: invite.id,
      consentedAt: body.shareWithPartner ? now() : null,
    })
    .onConflictDoUpdate({
      target: [partnerMembers.partnerId, partnerMembers.userId],
      set: {
        consentedAt: body.shareWithPartner ? now() : null,
        consentRevokedAt: body.shareWithPartner ? null : now(),
      },
    });
  if (body.shareWithPartner) {
    await fanOut(db, c.env.PARTNER_WEBHOOK_SIGNING_KEY, userId, "member.joined", {}, now());
  }
  return c.json({ joined: true, sharing: body.shareWithPartner });
});

/** Admins create partners; the key is shown once and stored as a hash. */
partnerRoutes.post("/admin/partners", requireSession, async (c) => {
  const { db } = c.var.services;
  const { userId } = sessionOf(c);
  const [admin] = await db
    .select({ role: adminUsers.role })
    .from(adminUsers)
    .where(eq(adminUsers.userId, userId))
    .limit(1);
  if (admin?.role !== "admin") throw forbidden("Admin access only");
  const body = parseOrThrow(api.CreatePartnerRequest, await readJson(c));
  const [partner] = await db
    .insert(partners)
    .values({ name: body.name, contactEmail: body.contactEmail ?? null })
    .returning();
  if (!partner) throw new Error("partner insert returned no row");
  const key = `${KEY_PREFIX}${newRefreshToken()}`;
  await db.insert(partnerKeys).values({
    partnerId: partner.id,
    keyHash: await sha256Hex(key),
    prefix: key.slice(0, 12),
    scopes: [...SCOPES],
  });
  await db.insert(auditLog).values({
    actorType: "admin",
    actorId: userId,
    action: "partner.create",
    target: partner.id,
    details: { name: body.name },
    ip: c.req.header("cf-connecting-ip") ?? null,
  });
  return c.json({ partnerId: partner.id, key }, 201);
});
