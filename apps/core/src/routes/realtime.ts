import { api } from "@paycheck-router/shared";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { userHubFor } from "../do/stubs.ts";
import type { AppEnv } from "../http/context.ts";
import { ApiError, unauthorized } from "../http/problem.ts";
import { ACCESS_COOKIE, readSession } from "../http/session.ts";

export const realtimeRoutes = new Hono<AppEnv>();

function bearerFromProtocols(header: string | undefined): string | undefined {
  const bearer = header
    ?.split(",")
    .map((value) => value.trim())
    .find((value) => value.startsWith(api.REALTIME_BEARER_PREFIX));
  return bearer?.slice(api.REALTIME_BEARER_PREFIX.length);
}

/** WebSocket upgrade into the signed-in user's UserHub (section 11.4). */
realtimeRoutes.get("/realtime", async (c) => {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
    throw new ApiError(426, "bad_request", "Connect with a WebSocket upgrade");
  }
  const token = bearerFromProtocols(c.req.header("sec-websocket-protocol"));
  const session = await readSession(
    c.env.SESSION_SIGNING_KEY,
    token ? `Bearer ${token}` : undefined,
    getCookie(c, ACCESS_COOKIE),
    c.var.services.now(),
  );
  if (!session) throw unauthorized();
  const headers = new Headers(c.req.raw.headers);
  headers.set("x-user-id", session.userId);
  return userHubFor(c.env, session.userId).fetch(new Request(c.req.raw, { headers }));
});
