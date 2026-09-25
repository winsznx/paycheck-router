import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { REFRESH_COOKIE } from "@/lib/api/session-contract.ts";
import { forwardHeaders, issueClientSession, problemResponse } from "@/lib/api/session-server.ts";
import { apiUrl } from "@/lib/env.ts";

export const dynamic = "force-dynamic";

/** Rotates the refresh cookie and returns a fresh access token (PRD 12.2). */
export async function POST(request: NextRequest): Promise<Response> {
  const store = await cookies();
  const refreshToken = store.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return problemResponse(401, "unauthorized", "Not signed in");
  const upstream = await fetch(`${apiUrl}/auth/refresh`, {
    method: "POST",
    headers: forwardHeaders(request),
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
  });
  if (upstream.status === 401) store.delete(REFRESH_COOKIE);
  return issueClientSession(upstream);
}
