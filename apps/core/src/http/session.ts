import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { verifyAccessToken } from "../auth/tokens.ts";
import type { AppEnv, Session } from "./context.ts";
import { unauthorized } from "./problem.ts";

export const ACCESS_COOKIE = "pr_access";
export const REFRESH_COOKIE = "pr_refresh";

function bearer(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

/** Resolves the session from the bearer header or the web's HttpOnly cookie. */
export async function readSession(
  secret: string,
  authorization: string | undefined,
  cookieToken: string | undefined,
  now: Date,
): Promise<Session | null> {
  const token = bearer(authorization) ?? cookieToken ?? null;
  if (!token) return null;
  return verifyAccessToken(secret, token, now);
}

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await readSession(
    c.env.SESSION_SIGNING_KEY,
    c.req.header("authorization"),
    getCookie(c, ACCESS_COOKIE),
    c.var.services.now(),
  );
  if (!session) throw unauthorized();
  c.set("session", session);
  await next();
});

export function sessionOf(c: { var: { session: Session | null } }): Session {
  const session = c.var.session;
  if (!session) throw unauthorized();
  return session;
}
