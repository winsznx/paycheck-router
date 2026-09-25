import { and, eq, lte } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { sha256Hex } from "../auth/tokens.ts";
import { idempotencyKeys } from "../db/schema.ts";
import type { AppEnv } from "./context.ts";
import { ApiError } from "./problem.ts";
import { ACCESS_COOKIE, readSession } from "./session.ts";

const TTL_MS = 24 * 60 * 60 * 1000;
/** A reservation that never completed (a crashed request) frees its key after this long. */
const IN_FLIGHT_MS = 2 * 60 * 1000;
const IN_FLIGHT_STATUS = 0;
const KEY = /^[A-Za-z0-9_\-:.]{8,128}$/;

/**
 * Section 11.1: a POST with `Idempotency-Key` runs once per caller and key for 24 h; a repeat
 * with the same body gets the stored response, a repeat with a different body is refused.
 */
export const idempotency = createMiddleware<AppEnv>(async (c, next) => {
  const key = c.req.header("idempotency-key");
  if (c.req.method !== "POST" || !key) return next();
  if (!KEY.test(key)) {
    throw new ApiError(400, "bad_request", "Idempotency-Key must be 8-128 URL-safe characters");
  }
  const { db, now } = c.var.services;
  const session = await readSession(
    c.env.SESSION_SIGNING_KEY,
    c.req.header("authorization"),
    getCookie(c, ACCESS_COOKIE),
    now(),
  );
  const scope = session
    ? `user:${session.userId}`
    : `ip:${c.req.header("cf-connecting-ip") ?? "local"}`;
  const requestHash = await sha256Hex(`${c.req.method} ${c.req.path}\n${await c.req.text()}`);
  const at = now();

  await db
    .delete(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.scope, scope),
        eq(idempotencyKeys.key, key),
        lte(idempotencyKeys.expiresAt, at),
      ),
    );
  const reserved = await db
    .insert(idempotencyKeys)
    .values({
      scope,
      key,
      requestHash,
      statusCode: IN_FLIGHT_STATUS,
      response: {},
      expiresAt: new Date(at.getTime() + IN_FLIGHT_MS),
    })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });

  if (reserved.length === 0) {
    const [stored] = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
      .limit(1);
    if (!stored) throw new ApiError(409, "conflict", "Retry the request");
    if (stored.requestHash !== requestHash) {
      throw new ApiError(
        422,
        "idempotency_conflict",
        "This Idempotency-Key was used with a different request",
      );
    }
    if (stored.statusCode === IN_FLIGHT_STATUS) {
      throw new ApiError(409, "conflict", "The first request with this key is still running");
    }
    c.header("idempotent-replayed", "true");
    return c.json(stored.response, stored.statusCode as 200);
  }

  try {
    await next();
  } finally {
    const res = c.res;
    const cacheable = res.status < 500 && res.headers.get("content-type")?.includes("json");
    if (cacheable) {
      const body = (await res.clone().json()) as Record<string, unknown>;
      await db
        .update(idempotencyKeys)
        .set({ statusCode: res.status, response: body, expiresAt: new Date(at.getTime() + TTL_MS) })
        .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
    } else {
      await db
        .delete(idempotencyKeys)
        .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
    }
  }
});
