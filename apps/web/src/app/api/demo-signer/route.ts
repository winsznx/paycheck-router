import { getBase58Decoder } from "@solana/kit";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const LOOPBACK = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

/** Accepts a base58 64-byte secret or a Solana CLI keypair JSON array. */
function toBase58(secret: string): string | null {
  const trimmed = secret.trim();
  if (!trimmed.startsWith("[")) return trimmed;
  const parsed: unknown = JSON.parse(trimmed);
  if (!Array.isArray(parsed) || parsed.length !== 64) return null;
  if (!parsed.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return null;
  return getBase58Decoder().decode(Uint8Array.from(parsed as number[]));
}

/**
 * Dev-only: hands the fork-only demo-worker secret to the in-app demo signer. Returns 404
 * unless this is a demo build served on a loopback host. The branch below is inlined at build
 * time, so non-demo builds contain no reference to DEMO_SIGNER_SECRET.
 */
export function GET(request: NextRequest): Response {
  if (process.env.NEXT_PUBLIC_ENVIRONMENT !== "demo") return notFound();
  if (!LOOPBACK.test(request.headers.get("host") ?? "")) return notFound();
  const secret = process.env.DEMO_SIGNER_SECRET;
  if (!secret) return notFound();
  const secretKey = toBase58(secret);
  if (!secretKey) return new Response("DEMO_SIGNER_SECRET is malformed", { status: 500 });
  return Response.json({ secretKey }, { headers: { "cache-control": "no-store" } });
}
