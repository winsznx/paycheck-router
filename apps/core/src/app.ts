import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { ConfigError } from "./config.ts";
import type { Env } from "./env.ts";
import type { AppEnv, Services } from "./http/context.ts";
import { ApiError, notFound, problemResponse } from "./http/problem.ts";
import { log } from "./log.ts";
import { authRoutes } from "./routes/auth.ts";
import { meRoutes } from "./routes/me.ts";
import { publicRoutes } from "./routes/public.ts";
import { realtimeRoutes } from "./routes/realtime.ts";

export type ServicesFactory = (env: Env) => Services;

export function createApp(makeServices: ServicesFactory): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(requestId({ headerName: "x-request-id" }));
  app.use(async (c, next) => {
    c.set("services", makeServices(c.env));
    c.set("session", null);
    await next();
  });
  app.use(
    secureHeaders({
      strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
      xFrameOptions: "DENY",
      referrerPolicy: "strict-origin-when-cross-origin",
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    }),
  );
  app.use(
    cors({
      origin: (origin, c) => (origin === c.env.APP_ORIGIN ? origin : null),
      credentials: true,
      allowHeaders: ["authorization", "content-type", "idempotency-key"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      exposeHeaders: ["x-request-id"],
      maxAge: 600,
    }),
  );

  app.onError((error, c) => {
    const id = c.var.requestId ?? "unknown";
    if (error instanceof ApiError) return problemResponse(error, id);
    if (error instanceof ConfigError) {
      log.error("configuration error", { requestId: id, error });
      return problemResponse(new ApiError(503, "not_configured", error.message), id);
    }
    log.error("unhandled error", { requestId: id, path: c.req.path, error });
    return problemResponse(new ApiError(500, "internal", "Something went wrong"), id);
  });
  app.notFound((c) => problemResponse(notFound(`${c.req.method} ${c.req.path}`), c.var.requestId));

  app.route("/auth", authRoutes);
  app.route("/", meRoutes);
  app.route("/", publicRoutes);
  app.route("/", realtimeRoutes);

  return app;
}
