import { api } from "@paycheck-router/shared";
import { address } from "@solana/kit";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  checkSiwsMessage,
  parseSiwsMessage,
  SIWS_STATEMENT,
  verifySiwsSignature,
} from "../auth/siws.ts";
import {
  newNonce,
  newRefreshToken,
  REFRESH_TOKEN_TTL_SECS,
  sha256Hex,
  signAccessToken,
} from "../auth/tokens.ts";
import { siwsChain, siwsDomains } from "../config.ts";
import type { Db } from "../db/client.ts";
import { authNonces, sessions, users, wallets } from "../db/schema.ts";
import type { AppContext, AppEnv } from "../http/context.ts";
import { readJson } from "../http/json.ts";
import { ApiError, parseOrThrow, unauthorized } from "../http/problem.ts";
import { rateLimit } from "../http/rate-limit.ts";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../http/session.ts";

const NONCE_TTL_MS = 5 * 60 * 1000;
const ISSUED_AT_SKEW_MS = 5 * 60 * 1000;

export const authRoutes = new Hono<AppEnv>();

authRoutes.use(rateLimit("AUTH_LIMITER", "ip"));

authRoutes.get("/nonce", async (c) => {
  const { db, now } = c.var.services;
  const nonce = newNonce();
  const expiresAt = new Date(now().getTime() + NONCE_TTL_MS);
  await db.insert(authNonces).values({ nonce, expiresAt });
  const body: api.NonceResponse = {
    nonce,
    expiresAt: expiresAt.toISOString(),
    domain: siwsDomains(c.env)[0] ?? "",
    uri: c.env.APP_ORIGIN,
    statement: SIWS_STATEMENT,
    version: "1",
    chainId: siwsChain(c.env),
  };
  return c.json(body);
});

authRoutes.post("/siws", async (c) => {
  const { db, now } = c.var.services;
  const body = parseOrThrow(api.SiwsRequest, await readJson(c));
  const message = parseSiwsMessage(body.message);
  if (!message) throw unauthorized("Not a Sign-In-With-Solana message");
  const check = checkSiwsMessage(message, {
    domains: siwsDomains(c.env),
    address: body.address,
    chainId: siwsChain(c.env),
    now: now(),
    maxSkewMs: ISSUED_AT_SKEW_MS,
  });
  if (!check.ok) throw unauthorized(`Sign-in rejected: ${check.reason}`);
  const signature = Uint8Array.from(atob(body.signature), (char) => char.charCodeAt(0));
  if (!(await verifySiwsSignature(address(body.address), body.message, signature))) {
    throw unauthorized("Signature does not match the wallet");
  }
  const consumed = await db
    .update(authNonces)
    .set({ consumedAt: now() })
    .where(
      and(
        eq(authNonces.nonce, check.nonce),
        isNull(authNonces.consumedAt),
        gt(authNonces.expiresAt, now()),
      ),
    )
    .returning({ nonce: authNonces.nonce });
  if (consumed.length === 0) throw unauthorized("Nonce is unknown, used or expired");

  const ipCountry = countryOf(c);
  const user = await upsertWalletUser(db, body.address, ipCountry, now());
  return c.json(await issueSession(c, user, body.address, null));
});

authRoutes.post("/refresh", async (c) => {
  const { db, now } = c.var.services;
  const raw = c.req.header("content-type")?.includes("json") ? await readJson(c) : {};
  const body = parseOrThrow(api.RefreshRequest, raw);
  const token = body.refreshToken ?? getCookie(c, REFRESH_COOKIE);
  if (!token) throw unauthorized("No refresh token");
  const hash = await sha256Hex(token);
  const [current] = await db.select().from(sessions).where(eq(sessions.refreshHash, hash)).limit(1);
  if (!current) throw unauthorized("Unknown refresh token");
  if (current.revokedAt || current.replacedBy) {
    await db
      .update(sessions)
      .set({ revokedAt: now() })
      .where(and(eq(sessions.familyId, current.familyId), isNull(sessions.revokedAt)));
    throw unauthorized("Refresh token reuse detected; every session in this family is revoked");
  }
  if (current.expiresAt <= now()) throw unauthorized("Refresh token expired");
  const [user] = await db.select().from(users).where(eq(users.id, current.userId)).limit(1);
  if (!user || user.deletedAt) throw unauthorized("Account no longer exists");
  return c.json(await issueSession(c, user, current.walletAddress, current));
});

authRoutes.post("/logout", async (c) => {
  const { db, now } = c.var.services;
  const token = getCookie(c, REFRESH_COOKIE) ?? (await optionalRefreshToken(c));
  if (token) {
    const hash = await sha256Hex(token);
    const [current] = await db
      .select({ familyId: sessions.familyId })
      .from(sessions)
      .where(eq(sessions.refreshHash, hash))
      .limit(1);
    if (current) {
      await db
        .update(sessions)
        .set({ revokedAt: now() })
        .where(and(eq(sessions.familyId, current.familyId), isNull(sessions.revokedAt)));
    }
  }
  deleteCookie(c, ACCESS_COOKIE, { path: "/" });
  deleteCookie(c, REFRESH_COOKIE, { path: "/auth" });
  return c.body(null, 204);
});

async function optionalRefreshToken(c: AppContext): Promise<string | undefined> {
  if (!c.req.header("content-type")?.includes("json")) return undefined;
  return parseOrThrow(api.RefreshRequest, await readJson(c)).refreshToken;
}

export function countryOf(c: AppContext): string | null {
  const country = (c.req.raw as Request & { cf?: { country?: unknown } }).cf?.country;
  return typeof country === "string" && /^[A-Z]{2}$/.test(country) ? country : null;
}

type UserRow = typeof users.$inferSelect;

async function upsertWalletUser(
  db: Db,
  walletAddress: string,
  ipCountry: string | null,
  now: Date,
): Promise<UserRow> {
  return db.transaction(async (tx) => {
    const [linked] = await tx
      .select({ user: users })
      .from(wallets)
      .innerJoin(users, eq(users.id, wallets.userId))
      .where(eq(wallets.address, walletAddress))
      .limit(1);
    if (linked) {
      if (linked.user.deletedAt) throw new ApiError(403, "forbidden", "This account was deleted");
      const [updated] = await tx
        .update(users)
        .set({ countryIpLast: ipCountry ?? linked.user.countryIpLast, updatedAt: now })
        .where(eq(users.id, linked.user.id))
        .returning();
      return updated ?? linked.user;
    }
    const [created] = await tx.insert(users).values({ countryIpLast: ipCountry }).returning();
    if (!created) throw new Error("user insert returned no row");
    await tx.insert(wallets).values({
      userId: created.id,
      address: walletAddress,
      kind: "external",
      verifiedAt: now,
    });
    return created;
  });
}

async function issueSession(
  c: AppContext,
  user: UserRow,
  walletAddress: string,
  previous: typeof sessions.$inferSelect | null,
): Promise<api.SessionResponse> {
  const { db, now } = c.var.services;
  const issuedAt = now();
  const refreshToken = newRefreshToken();
  const refreshExpiresAt = new Date(issuedAt.getTime() + REFRESH_TOKEN_TTL_SECS * 1000);
  const [created] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      walletAddress,
      familyId: previous?.familyId ?? crypto.randomUUID(),
      refreshHash: await sha256Hex(refreshToken),
      expiresAt: refreshExpiresAt,
      userAgent: c.req.header("user-agent")?.slice(0, 256) ?? null,
      ipCountry: countryOf(c),
    })
    .returning({ id: sessions.id });
  if (!created) throw new Error("session insert returned no row");
  if (previous) {
    await db
      .update(sessions)
      .set({ revokedAt: issuedAt, replacedBy: created.id })
      .where(eq(sessions.id, previous.id));
  }
  const access = await signAccessToken(
    c.env.SESSION_SIGNING_KEY,
    { userId: user.id, wallet: walletAddress },
    issuedAt,
  );
  const secure = new URL(c.req.url).protocol === "https:" || c.env.APP_ORIGIN.startsWith("https:");
  setCookie(c, ACCESS_COOKIE, access.token, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    expires: access.expiresAt,
  });
  setCookie(c, REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/auth",
    expires: refreshExpiresAt,
  });
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken,
    refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
    user: {
      id: user.id,
      eligibilityStatus: user.eligibilityStatus,
      locale: user.locale,
      refCurrency: user.refCurrency,
    },
    wallet: walletAddress,
  };
}
