import { buyMinOut } from "@paycheck-router/guard-math";
import { api, LAUNCH_CONFIG } from "@paycheck-router/shared";
import { asc, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { mintTerms } from "../chain/mints.ts";
import { assets } from "../db/schema.ts";
import type { AppEnv } from "../http/context.ts";
import { ApiError, parseOrThrow } from "../http/problem.ts";
import { rateLimit } from "../http/rate-limit.ts";
import { requireSession } from "../http/session.ts";
import { priceE9 } from "../pricing/hermes.ts";
import { premiumBps, priceBoard } from "../pricing/reference.ts";

export const marketRoutes = new Hono<AppEnv>();

marketRoutes.use("/assets", rateLimit("PUBLIC_LIMITER", "ip"));
marketRoutes.use("/quote/*", requireSession, rateLimit("QUOTE_LIMITER", "user"));

marketRoutes.get("/assets", async (c) => {
  const { db, now } = c.var.services;
  const rows = await db.select().from(assets).orderBy(asc(assets.sortOrder));
  const board = await priceBoard(c.env, rows, now());
  const body: api.AssetsResponse = {
    assets: rows.map((row) => {
      const reference = board.reference.get(row.mint);
      const onchain = board.onchainE9.get(row.mint);
      const state = board.market.get(row.mint) ?? "unknown";
      return {
        mint: row.mint,
        symbol: row.symbol,
        name: row.name,
        kind: row.kind,
        issuer: row.issuer,
        decimals: row.decimals,
        tokenProgram: row.tokenProgram,
        status: row.status,
        defaultBandBps: row.defaultBandBps,
        maxBandBps: row.maxBandBps,
        feedId: row.feedId,
        feedId247: row.feedId247,
        market: { state, nextOpen: null },
        reference:
          reference?.pyth != null
            ? {
                feedId: reference.pyth.feedId,
                price: reference.pyth.price.toString(),
                conf: reference.pyth.conf.toString(),
                exponent: reference.pyth.exponent,
                publishTime: reference.pyth.publishTime.toISOString(),
              }
            : null,
        markPriceE9: board.markE9.get(row.mint)?.toString() ?? null,
        onchainPriceE9: onchain?.toString() ?? null,
        premiumBps: premiumBps(onchain, reference?.priceE9),
      };
    }),
    asOf: board.asOf.toISOString(),
  };
  return c.json(body);
});

marketRoutes.get("/quote/preview", async (c) => {
  const { db, chain, now } = c.var.services;
  const query = parseOrThrow(api.QuotePreviewQuery, c.req.query());
  const weightSum = query.legs.reduce((sum, leg) => sum + leg.weightBps, 0);
  if (weightSum !== 10_000) {
    throw new ApiError(400, "validation_failed", "leg weights must sum to 10000 bps");
  }
  const rows = await db
    .select()
    .from(assets)
    .where(
      inArray(
        assets.mint,
        query.legs.map((leg) => leg.mint),
      ),
    );
  const byMint = new Map(rows.map((row) => [row.mint, row]));
  const [board, terms] = await Promise.all([
    priceBoard(c.env, rows, now()),
    mintTerms(
      chain,
      rows.map((row) => row.mint),
      now(),
    ),
  ]);
  const inflow = BigInt(query.amount);
  const investTotal = (inflow * BigInt(query.investBps)) / 10_000n;
  const usdcE9 = board.usdc ? priceE9(board.usdc) : null;

  const legs = query.legs.map((leg): api.QuotePreviewLeg => {
    const asset = byMint.get(leg.mint);
    if (!asset) throw new ApiError(400, "validation_failed", `unknown asset ${leg.mint}`);
    const amountIn = (investTotal * BigInt(leg.weightBps)) / 10_000n;
    const fee = (amountIn * BigInt(LAUNCH_CONFIG.feeBps)) / 10_000n;
    const reference = board.reference.get(leg.mint);
    const onchain = board.onchainE9.get(leg.mint);
    const premium = premiumBps(onchain, reference?.priceE9);
    const state = board.market.get(leg.mint) ?? "unknown";
    const multiplierE12 = terms.get(leg.mint)?.multiplierE12;
    const minOut =
      reference && usdcE9 !== null && multiplierE12 !== undefined && amountIn > fee
        ? buyMinOut({
            usdcIn: amountIn - fee,
            usdcPriceE9: usdcE9,
            priceE9: reference.priceE9,
            bandBps: leg.bandBps,
            multiplierE12,
            decimals: asset.decimals,
          })
        : null;
    let wouldWait: api.QuotePreviewLeg["wouldWait"] = null;
    if (asset.status !== "active") wouldWait = "ASSET_PAUSED";
    else if (state === "closed" || state === "unknown") wouldWait = "MARKET_CLOSED";
    else if (premium !== null && premium > leg.bandBps) wouldWait = "PREMIUM_TOO_HIGH";
    return {
      mint: leg.mint,
      symbol: asset.symbol,
      amountIn: amountIn.toString(),
      fee: fee.toString(),
      referencePriceE9: reference?.priceE9.toString() ?? null,
      minOut: minOut?.toString() ?? null,
      quotedOut: null,
      premiumBps: premium,
      wouldWait,
    };
  });
  const body: api.QuotePreviewResponse = {
    inflow: inflow.toString(),
    investTotal: investTotal.toString(),
    feeBps: LAUNCH_CONFIG.feeBps,
    legs,
    asOf: board.asOf.toISOString(),
  };
  return c.json(body);
});
