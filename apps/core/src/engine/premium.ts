import { buyPremiumBps, pythPriceToE9 } from "@paycheck-router/guard-math";
import { AssetKind, type RegistryAsset, USDC_FEED_ID } from "@paycheck-router/shared";

export type ReferencePrice = { priceE9: bigint; source: "mark" | "pyth" | "pyth247" };

export type MeasuredQuote = {
  source: ReferencePrice["source"];
  refPriceE9: bigint;
  usdcPriceE9: bigint;
  quotedIn: bigint;
  quotedOut: bigint;
  multiplierE12: bigint;
  /** Quoted fill over the reference, gross of the issuer's transfer fee, like the guard. */
  premiumBps: number;
};

type ParsedPrice = { id: string; price: { price: string; expo: number } };

/** What one attempt priced against, from its posted Hermes update or its signed mark. */
export type AttemptPricing = {
  parsed: readonly ParsedPrice[];
  markPriceE9: bigint | null;
  quotedIn: bigint | null;
  quotedOut: bigint | null;
};

function parsedE9(parsed: readonly ParsedPrice[], feedId: string | null): bigint | null {
  if (!feedId) return null;
  const entry = parsed.find((update) => update.id.replace(/^0x/, "") === feedId);
  if (!entry) return null;
  const price = BigInt(entry.price.price);
  return price > 0n ? pythPriceToE9(price, entry.price.expo) : null;
}

/** The reference the program would guard with: the signed mark, else Pyth regular, else 24/7. */
export function referenceFor(asset: RegistryAsset, pricing: AttemptPricing): ReferencePrice | null {
  if (asset.kind === AssetKind.preIpo) {
    return pricing.markPriceE9 !== null ? { priceE9: pricing.markPriceE9, source: "mark" } : null;
  }
  const regular = parsedE9(pricing.parsed, asset.feedId);
  if (regular !== null) return { priceE9: regular, source: "pyth" };
  const allDay = parsedE9(pricing.parsed, asset.feedId247);
  return allDay !== null ? { priceE9: allDay, source: "pyth247" } : null;
}

/**
 * The premium a waiting attempt measured: the Jupiter quote it simulated against the reference
 * it simulated with, per whole share after the Scaled UI multiplier. Null when any input is
 * missing (no quote, a refused price, no USDC/USD).
 */
export function measureQuote(
  asset: RegistryAsset,
  pricing: AttemptPricing,
  multiplierE12: bigint,
): MeasuredQuote | null {
  const reference = referenceFor(asset, pricing);
  const usdcPriceE9 = parsedE9(pricing.parsed, USDC_FEED_ID);
  if (!reference || usdcPriceE9 === null || !pricing.quotedIn || !pricing.quotedOut) return null;
  const premium = buyPremiumBps({
    usdcIn: pricing.quotedIn,
    sharesOut: pricing.quotedOut,
    usdcPriceE9,
    priceE9: reference.priceE9,
    multiplierE12,
    decimals: asset.decimals,
  });
  return {
    source: reference.source,
    refPriceE9: reference.priceE9,
    usdcPriceE9,
    quotedIn: pricing.quotedIn,
    quotedOut: pricing.quotedOut,
    multiplierE12,
    premiumBps: Number(premium),
  };
}
