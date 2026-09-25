import { AssetKind, assetByMint, USDC_DECIMALS } from "@paycheck-router/shared";
import { fromBaseUnits } from "@paycheck-router/ui/format";

/** USDC base units (u64 string) to a decimal string for Intl. */
export const usdc = (raw: string | bigint): `${number}` => fromBaseUnits(raw, USDC_DECIMALS);

/** USD × 1e9 (the API's price scale) to a number for display. */
export const priceE9 = (raw: string | null | undefined): number | null =>
  raw == null ? null : Number(fromBaseUnits(raw, 9));

/** Share amount in whole tokens; decimals come from the registry (8 xStocks, 9 PreStocks). */
export function shares(mint: string, raw: string | null | undefined, decimals?: number) {
  if (raw == null) return null;
  const places = decimals ?? assetByMint(mint)?.decimals ?? 0;
  return fromBaseUnits(raw, places);
}

export function isPreIpo(mint: string): boolean {
  return assetByMint(mint)?.kind === AssetKind.preIpo;
}

/** Display name for copy lines: "OpenAI PreStocks", or the ticker for xStocks. */
export function assetLabel(mint: string, symbol: string): string {
  const asset = assetByMint(mint);
  return asset && asset.kind === AssetKind.preIpo ? asset.name : symbol;
}

/** Whole-dollar view of a USDC amount for copy lines ("$370"). */
export function usdcNumber(raw: string): number {
  return Number(usdc(raw));
}
