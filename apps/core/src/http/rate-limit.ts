import { createMiddleware } from "hono/factory";
import type { Env } from "../env.ts";
import type { AppEnv } from "./context.ts";
import { ApiError } from "./problem.ts";

type LimiterName = Exclude<
  { [K in keyof Env]-?: Env[K] extends RateLimit ? K : never }[keyof Env],
  undefined
>;

/**
 * Workers Rate Limiting, keyed by the caller's IP or signed-in user (section 11.6 limits live
 * on the bindings in wrangler.jsonc).
 */
export function rateLimit(binding: LimiterName, scope: "ip" | "user") {
  return createMiddleware<AppEnv>(async (c, next) => {
    const key =
      scope === "user" && c.var.session
        ? `user:${c.var.session.userId}`
        : `ip:${c.req.header("cf-connecting-ip") ?? "local"}`;
    const { success } = await c.env[binding].limit({ key });
    if (!success) {
      c.header("retry-after", "60");
      throw new ApiError(429, "rate_limited", "Slow down and try again in a minute");
    }
    await next();
  });
}
