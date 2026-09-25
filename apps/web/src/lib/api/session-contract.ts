import { api } from "@paycheck-router/shared";
import type { z } from "zod";

/** What the web session routes hand the browser: the access token only, never the refresh token. */
export const ClientSession = api.SessionResponse.omit({
  refreshToken: true,
  refreshTokenExpiresAt: true,
});
export type ClientSession = z.infer<typeof ClientSession>;

export const REFRESH_COOKIE = "pr_refresh";
/**
 * Readable by scripts and set beside the HttpOnly refresh cookie, with the same lifetime, so a
 * visitor who never signed in makes no refresh call at all.
 */
export const SESSION_MARKER_COOKIE = "pr_signed_in";
export const SESSION_ROUTE = "/api/session";
