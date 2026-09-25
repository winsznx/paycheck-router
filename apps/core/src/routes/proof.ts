import { api, assetByMint } from "@paycheck-router/shared";
import { and, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { sharesUi } from "../chain/shares.ts";
import { environment, explorerTxUrl } from "../config.ts";
import { attempts, legs, paychecks, verifications } from "../db/schema.ts";
import type { AppEnv } from "../http/context.ts";
import { notFound, parseOrThrow } from "../http/problem.ts";
import { rateLimit } from "../http/rate-limit.ts";
import { verificationApi } from "./paychecks.ts";

export const proofRoutes = new Hono<AppEnv>();

proofRoutes.use("/proof", rateLimit("PUBLIC_LIMITER", "ip"));
proofRoutes.use("/proof/*", rateLimit("PUBLIC_LIMITER", "ip"));

type Row = {
  leg: typeof legs.$inferSelect;
  paycheck: typeof paychecks.$inferSelect;
  verification: typeof verifications.$inferSelect | null;
};

function proofLeg(env: AppEnv["Bindings"], row: Row): api.ProofLeg | null {
  const { leg, paycheck, verification } = row;
  if (!leg.executedSig || !leg.executedAt) return null;
  return {
    signature: leg.executedSig,
    mint: leg.assetMint,
    symbol: assetByMint(leg.assetMint)?.symbol ?? leg.assetMint.slice(0, 4),
    amountIn: leg.amountIn.toString(),
    outAmount: (leg.outAmount ?? 0n).toString(),
    fee: (leg.fee ?? 0n).toString(),
    issuerFee: (leg.issuerFee ?? 0n).toString(),
    uiMultiplier: leg.uiMultiplier,
    sharesUi:
      leg.outAmount !== null && leg.uiMultiplier !== null
        ? sharesUi(leg.outAmount, assetByMint(leg.assetMint)?.decimals ?? 0, leg.uiMultiplier)
        : null,
    refPriceE9: leg.refPriceE9?.toString() ?? null,
    execPriceE9: leg.execPriceE9?.toString() ?? null,
    premiumBps: leg.premiumBps,
    executedAt: leg.executedAt.toISOString(),
    paycheck: {
      seq: paycheck.seq.toString(),
      inflow: paycheck.inflow.toString(),
      investTotal: paycheck.investTotal.toString(),
      recordedSig: paycheck.recordedSig,
      recordedAt: paycheck.recordedAt.toISOString(),
    },
    verification: verification ? verificationApi(verification) : null,
    links: [
      { label: "execute_leg", url: explorerTxUrl(env, leg.executedSig) },
      { label: "record_paycheck", url: explorerTxUrl(env, paycheck.recordedSig) },
    ],
  };
}

/** Public proof: the campaign totals and the latest executed slices, with no personal data. */
proofRoutes.get("/proof", async (c) => {
  const { db, now } = c.var.services;
  // One statement at a time: the demo database (PGlite behind a wire server) cannot interleave
  // pipelined statements on a connection.
  const [paycheckCount] = await db.select({ n: count() }).from(paychecks);
  const [executedCount] = await db
    .select({ n: count() })
    .from(legs)
    .where(inArray(legs.status, ["executed", "verified", "unverified"]));
  const [verifiedCount] = await db
    .select({ n: count() })
    .from(legs)
    .where(eq(legs.status, "verified"));
  const waits = await db
    .select({ reason: attempts.reason, n: count() })
    .from(attempts)
    .where(and(isNotNull(attempts.reason), eq(attempts.outcome, "waiting")))
    .groupBy(attempts.reason);
  const medians = await db
    .select({
      median: sql<
        string | null
      >`percentile_cont(0.5) within group (order by extract(epoch from ${legs.executedAt} - ${paychecks.recordedAt}))`,
    })
    .from(legs)
    .innerJoin(paychecks, eq(paychecks.id, legs.paycheckId))
    .where(isNotNull(legs.executedAt));
  const recent = await db
    .select({ leg: legs, paycheck: paychecks, verification: verifications })
    .from(legs)
    .innerJoin(paychecks, eq(paychecks.id, legs.paycheckId))
    .leftJoin(verifications, eq(verifications.legId, legs.id))
    .where(isNotNull(legs.executedSig))
    .orderBy(desc(legs.executedAt))
    .limit(20);
  const median = medians[0]?.median;
  const body: api.ProofResponse = {
    environment: environment(c.env),
    fork: Boolean(c.env.SURFNET_RPC_URL),
    programId: c.env.PROGRAM_ID,
    campaign: {
      paychecks: paycheckCount?.n ?? 0,
      slicesExecuted: executedCount?.n ?? 0,
      slicesVerified: verifiedCount?.n ?? 0,
      waitsByReason: Object.fromEntries(
        waits.filter((row) => row.reason !== null).map((row) => [row.reason as string, row.n]),
      ),
      medianSecondsToShares: median == null ? null : Number(median),
    },
    recentLegs: recent.map((row) => proofLeg(c.env, row)).filter((leg) => leg !== null),
    asOf: now().toISOString(),
  };
  return c.json(body);
});

proofRoutes.get("/proof/legs/:signature", async (c) => {
  const { db } = c.var.services;
  const signature = parseOrThrow(api.SignatureString, c.req.param("signature"));
  const [row] = await db
    .select({ leg: legs, paycheck: paychecks, verification: verifications })
    .from(legs)
    .innerJoin(paychecks, eq(paychecks.id, legs.paycheckId))
    .leftJoin(verifications, eq(verifications.legId, legs.id))
    .where(eq(legs.executedSig, signature))
    .limit(1);
  const proof = row ? proofLeg(c.env, row) : null;
  if (!proof) throw notFound("Executed slice");
  return c.json(proof);
});
