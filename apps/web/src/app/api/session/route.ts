import { api } from "@paycheck-router/shared";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { REFRESH_COOKIE } from "@/lib/api/session-contract.ts";
import {
  clearSessionCookies,
  forwardHeaders,
  issueClientSession,
  problemResponse,
} from "@/lib/api/session-server.ts";
import { apiUrl } from "@/lib/env.ts";

export const dynamic = "force-dynamic";

/**
 * Exchanges a signed SIWS message for a session. The refresh token stays in an HttpOnly cookie
 * on this origin (PRD 12.2); the browser keeps only the 15-minute access token in memory.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const parsed = api.SiwsRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return problemResponse(400, "validation_failed", "Expected a signed sign-in message");
  }
  const upstream = await fetch(`${apiUrl}/auth/siws`, {
    method: "POST",
    headers: forwardHeaders(request),
    body: JSON.stringify(parsed.data),
    cache: "no-store",
  });
  return issueClientSession(upstream);
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const store = await cookies();
  const refreshToken = store.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    await fetch(`${apiUrl}/auth/logout`, {
      method: "POST",
      headers: forwardHeaders(request),
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    }).catch(() => undefined);
  }
  await clearSessionCookies();
  return new Response(null, { status: 204 });
}
