import { USDC_FEED_ID } from "@paycheck-router/shared";
import { z } from "zod";
import { forkHostHeaders, prestocksEndpoint } from "../config.ts";
import type { Env } from "../env.ts";
import { log } from "../log.ts";
import { HermesError, type HermesPrice, latestPrices, priceE9 } from "./hermes.ts";

/** A regular-session price older than this means the market is closed (section 7.3). */
const FRESH_SECS = 60;

export type AssetForPricing = {
  mint: string;
  kind: "listed_equity" | "pre_ipo";
  feedId: string | null;
  feedId247: string | null;
};

export type Reference = {
  source: "pyth" | "pyth247" | "mark";
  priceE9: bigint;
  publishTime: Date;
  pyth: HermesPrice | null;
};

export type MarketState = "open" | "extended" | "closed" | "always_open" | "unknown";

/** Why a reference price is missing: the key lacks the feed grant, or Hermes failed. */
export type ReferenceError = "not_entitled" | "upstream_error";

export type PriceBoard = {
  asOf: Date;
  usdc: HermesPrice | null;
  reference: Map<string, Reference>;
  market: Map<string, MarketState>;
  onchainE9: Map<string, bigint>;
  markE9: Map<string, bigint>;
  referenceError: Map<string, ReferenceError>;
};

const PreStocksEntry = z.object({ contract_address: z.string(), markPrice: z.number().positive() });

function decimalToE9(value: number): bigint {
  const [whole = "0", fraction = ""] = value.toFixed(9).split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0").slice(0, 9));
}

/** PreStocks marks in USD × 1e9 by mint, from the public PreStocks API. */
export async function prestocksMarks(env: Env): Promise<Map<string, bigint>> {
  const { url, headers } = prestocksEndpoint(env);
  const response = await fetch(url, { headers: { accept: "application/json", ...headers } });
  if (!response.ok) throw new Error(`PreStocks API failed with ${response.status}`);
  const entries = z.array(PreStocksEntry).parse(await response.json());
  return new Map(entries.map((entry) => [entry.contract_address, decimalToE9(entry.markPrice)]));
}

const JupiterPrice = z.record(z.string(), z.object({ usdPrice: z.number().positive() }).nullable());

/** Jupiter Price V3 USD price per whole token, × 1e9. Display only; never feeds a guard. */
export async function jupiterPrices(
  env: Env,
  mints: readonly string[],
): Promise<Map<string, bigint>> {
  if (mints.length === 0) return new Map();
  const url = new URL("/price/v3", env.JUPITER_BASE_URL);
  url.searchParams.set("ids", mints.join(","));
  const headers: Record<string, string> = { accept: "application/json" };
  if (env.JUPITER_API_KEY) headers["x-api-key"] = env.JUPITER_API_KEY;
  const response = await fetch(url, { headers: { ...headers, ...forkHostHeaders(env, url.href) } });
  if (!response.ok) throw new Error(`Jupiter price failed with ${response.status}`);
  const body = JupiterPrice.parse(await response.json());
  const out = new Map<string, bigint>();
  for (const [mint, entry] of Object.entries(body)) {
    if (entry) out.set(mint, decimalToE9(entry.usdPrice));
  }
  return out;
}

async function settle<T>(label: string, promise: Promise<T>, empty: T): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    log.warn(`${label} unavailable`, { error });
    return empty;
  }
}

/**
 * Reference, onchain and market state for every asset, read live. An upstream that fails leaves
 * its prices out rather than guessing them.
 */
export async function priceBoard(
  env: Env,
  assets: readonly AssetForPricing[],
  now: Date,
): Promise<PriceBoard> {
  const equityFeeds = new Set<string>();
  for (const asset of assets) {
    if (asset.feedId) equityFeeds.add(asset.feedId);
    if (asset.feedId247) equityFeeds.add(asset.feedId247);
  }
  const hermes = { url: env.HERMES_URL, apiKey: env.PYTH_API_KEY };
  const hasPreIpo = assets.some((asset) => asset.kind === "pre_ipo");
  // USDC/USD (crypto) and the equity feeds are separate Hermes grants, so each group is asked
  // for on its own and a refusal of one never hides the other.
  const readGroup = async (
    feeds: readonly string[],
  ): Promise<{ prices: HermesPrice[]; error: ReferenceError | null }> => {
    if (feeds.length === 0) return { prices: [], error: null };
    try {
      return { prices: await latestPrices(hermes, feeds), error: null };
    } catch (error) {
      log.warn("Hermes unavailable", { error });
      const refused =
        error instanceof HermesError && (error.status === 401 || error.status === 403);
      return { prices: [], error: refused ? "not_entitled" : "upstream_error" };
    }
  };
  const [usdcGroup, equityGroup, marks, onchain] = await Promise.all([
    readGroup([USDC_FEED_ID]),
    readGroup([...equityFeeds]),
    hasPreIpo
      ? settle("PreStocks", prestocksMarks(env), new Map<string, bigint>())
      : new Map<string, bigint>(),
    settle(
      "Jupiter price",
      jupiterPrices(
        env,
        assets.map((asset) => asset.mint),
      ),
      new Map<string, bigint>(),
    ),
  ]);
  const pyth = [...usdcGroup.prices, ...equityGroup.prices];
  const byFeed = new Map(pyth.map((price) => [price.feedId, price]));
  const fresh = (price: HermesPrice | undefined) =>
    price !== undefined && (now.getTime() - price.publishTime.getTime()) / 1000 <= FRESH_SECS;

  const reference = new Map<string, Reference>();
  const market = new Map<string, MarketState>();
  const referenceError = new Map<string, ReferenceError>();
  for (const asset of assets) {
    if (asset.kind === "pre_ipo") {
      market.set(asset.mint, "always_open");
      const mark = marks.get(asset.mint);
      if (mark !== undefined) {
        reference.set(asset.mint, { source: "mark", priceE9: mark, publishTime: now, pyth: null });
      } else {
        referenceError.set(asset.mint, "upstream_error");
      }
      continue;
    }
    if (equityGroup.error) {
      market.set(asset.mint, "unknown");
      referenceError.set(asset.mint, equityGroup.error);
      continue;
    }
    const regular = asset.feedId ? byFeed.get(asset.feedId) : undefined;
    const allDay = asset.feedId247 ? byFeed.get(asset.feedId247) : undefined;
    if (fresh(regular) && regular) {
      market.set(asset.mint, "open");
      reference.set(asset.mint, {
        source: "pyth",
        priceE9: priceE9(regular),
        publishTime: regular.publishTime,
        pyth: regular,
      });
    } else if (fresh(allDay) && allDay) {
      market.set(asset.mint, "extended");
      reference.set(asset.mint, {
        source: "pyth247",
        priceE9: priceE9(allDay),
        publishTime: allDay.publishTime,
        pyth: allDay,
      });
    } else {
      market.set(asset.mint, regular || allDay ? "closed" : "unknown");
      const last = regular ?? allDay;
      if (last) {
        reference.set(asset.mint, {
          source: regular ? "pyth" : "pyth247",
          priceE9: priceE9(last),
          publishTime: last.publishTime,
          pyth: last,
        });
      }
    }
  }
  return {
    asOf: now,
    usdc: byFeed.get(USDC_FEED_ID) ?? null,
    reference,
    market,
    onchainE9: onchain,
    markE9: marks,
    referenceError,
  };
}

/** Onchain over reference in bps, floored toward zero; negative is a discount. */
export function premiumBps(
  onchainE9: bigint | undefined,
  referenceE9: bigint | undefined,
): number | null {
  if (onchainE9 === undefined || referenceE9 === undefined || referenceE9 === 0n) return null;
  return Number(((onchainE9 - referenceE9) * 10_000n) / referenceE9);
}
