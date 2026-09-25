import { AssetKind, REGISTRY, USDC_FEED_ID } from "@paycheck-router/shared";

/**
 * Pyth symbols for the feeds we can name with certainty: each xStock's regular-session US equity
 * feed (SPYx → Equity.US.SPY/USD) and USDC. Other feeds (24/7, pre-IPO monitors) are copy-only.
 */
const SYMBOLS: ReadonlyMap<string, string> = new Map([
  [USDC_FEED_ID, "Crypto.USDC/USD"],
  ...REGISTRY.flatMap(
    (asset): Array<[string, string]> =>
      asset.kind === AssetKind.listedEquity && asset.feedId
        ? [[asset.feedId, `Equity.US.${asset.symbol.replace(/x$/, "")}/USD`]]
        : [],
  ),
]);

export function feedSymbol(feedId: string): string | null {
  return SYMBOLS.get(feedId.replace(/^0x/, "").toLowerCase()) ?? null;
}
