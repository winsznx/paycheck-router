import { api } from "@paycheck-router/shared";
import type { z } from "zod";

/** What the web session routes hand the browser: the access token only, never the refresh token. */
export const ClientSession = api.SessionResponse.omit({
  refreshToken: true,
  refreshTokenExpiresAt: true,
});
export type ClientSession = z.infer<typeof ClientSession>;

export const REFRESH_COOKIE = "pr_refresh";
export const SESSION_ROUTE = "/api/session";
