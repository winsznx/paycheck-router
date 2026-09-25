import { type api, assetByMint } from "@paycheck-router/shared";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { signExportToken, verifyExportToken } from "../auth/tokens.ts";
import { fixedToDecimal, sharesUi } from "../chain/shares.ts";
import { binding } from "../config.ts";
import { legs, paychecks, routers } from "../db/schema.ts";
import type { AppEnv } from "../http/context.ts";
import { notFound, unauthorized } from "../http/problem.ts";
import { rateLimit } from "../http/rate-limit.ts";
import { requireSession, sessionOf } from "../http/session.ts";

export const exportRoutes = new Hono<AppEnv>();

const LINK_TTL_SECS = 15 * 60;

const COLUMNS = [
  "recorded_at",
  "paycheck_seq",
  "inflow_usdc",
  "invest_total_usdc",
  "asset",
  "mint",
  "status",
  "wait_reason",
  "amount_in_usdc",
  "fee_usdc",
  "shares",
  "shares_raw",
  "premium_bps",
  "executed_at",
  "executed_signature",
  "record_signature",
] as const;

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CSV of every slice of the user's paychecks, stored in R2 and served by a 15-minute link. */
exportRoutes.post("/exports", requireSession, rateLimit("TX_LIMITER", "user"), async (c) => {
  const { db, now } = c.var.services;
  const { userId } = sessionOf(c);
  const rows = await db
    .select({ leg: legs, paycheck: paychecks })
    .from(legs)
    .innerJoin(paychecks, eq(paychecks.id, legs.paycheckId))
    .innerJoin(routers, eq(routers.id, paychecks.routerId))
    .where(eq(routers.userId, userId))
    .orderBy(asc(paychecks.recordedAt), asc(legs.idx));
  const usdc = (raw: bigint | null) => (raw === null ? null : fixedToDecimal(raw, 6));
  const lines = [COLUMNS.join(",")];
  for (const { leg, paycheck } of rows) {
    const decimals = assetByMint(leg.assetMint)?.decimals ?? 0;
    lines.push(
      [
        paycheck.recordedAt.toISOString(),
        paycheck.seq.toString(),
        usdc(paycheck.inflow),
        usdc(paycheck.investTotal),
        assetByMint(leg.assetMint)?.symbol ?? null,
        leg.assetMint,
        leg.status,
        leg.waitReason,
        usdc(leg.amountIn),
        usdc(leg.fee),
        leg.outAmount !== null ? sharesUi(leg.outAmount, decimals, leg.uiMultiplier ?? "1") : null,
        leg.outAmount?.toString() ?? null,
        leg.premiumBps,
        leg.executedAt?.toISOString() ?? null,
        leg.executedSig,
        paycheck.recordedSig,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  const key = `exports/${userId}/${crypto.randomUUID()}.csv`;
  await binding(c.env.EXPORTS, "EXPORTS").put(key, `${lines.join("\n")}\n`, {
    httpMetadata: { contentType: "text/csv; charset=utf-8" },
  });
  const issuedAt = now();
  const token = await signExportToken(
    c.env.SESSION_SIGNING_KEY,
    { userId, key },
    issuedAt,
    LINK_TTL_SECS,
  );
  const body: api.ExportResponse = {
    url: `${new URL(c.req.url).origin}/exports/download?token=${encodeURIComponent(token)}`,
    rows: rows.length,
    expiresAt: new Date(issuedAt.getTime() + LINK_TTL_SECS * 1000).toISOString(),
  };
  return c.json(body, 201);
});

exportRoutes.get("/exports/download", async (c) => {
  const token = c.req.query("token");
  if (!token) throw unauthorized("Missing export token");
  const claims = await verifyExportToken(c.env.SESSION_SIGNING_KEY, token, c.var.services.now());
  if (!claims || !claims.key.startsWith(`exports/${claims.userId}/`)) {
    throw unauthorized("This export link is invalid or has expired");
  }
  const object = await binding(c.env.EXPORTS, "EXPORTS").get(claims.key);
  if (!object) throw notFound("Export");
  return new Response(object.body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="paycheck-router-history.csv"',
      "cache-control": "private, no-store",
    },
  });
});
