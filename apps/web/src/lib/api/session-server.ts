import { api } from "@paycheck-router/shared";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { type ClientSession, REFRESH_COOKIE } from "@/lib/api/session-contract.ts";

export function forwardHeaders(request: NextRequest): Headers {
  const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
  for (const name of ["user-agent", "cf-connecting-ip", "cf-ipcountry", "x-forwarded-for"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export function problemResponse(status: number, code: string, detail: string): Response {
  return Response.json(
    { type: "about:blank", title: detail, status, detail, code, requestId: crypto.randomUUID() },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/** Moves the refresh token into an HttpOnly cookie and returns the rest to the browser. */
export async function issueClientSession(upstream: Response): Promise<Response> {
  const body: unknown = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    return Response.json(body, {
      status: upstream.status,
      headers: { "content-type": "application/problem+json" },
    });
  }
  const parsed = api.SessionResponse.safeParse(body);
  if (!parsed.success) {
    return problemResponse(502, "upstream_unavailable", "The session service answered oddly");
  }
  const { refreshToken, refreshTokenExpiresAt, ...session } = parsed.data;
  const store = await cookies();
  store.set(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/session",
    expires: new Date(refreshTokenExpiresAt),
  });
  const client: ClientSession = session;
  return Response.json(client, { headers: { "cache-control": "no-store" } });
}
