import { AssetKind, assetByMint, USDC_DECIMALS } from "@paycheck-router/shared";
import { fromBaseUnits } from "@paycheck-router/ui/format";

/** USDC base units (u64 string) to a decimal string for Intl. */
export const usdc = (raw: string | bigint): `${number}` => fromBaseUnits(raw, USDC_DECIMALS);

/** USD × 1e9 (the API's price scale) to a number for display. */
export const priceE9 = (raw: string | null | undefined): number | null =>
  raw == null ? null : Number(fromBaseUnits(raw, 9));

/**
 * Raw token amount in whole tokens, before the Token-2022 Scaled UI multiplier. Proof views use
 * it because the program's minimum and delivered amounts are raw; decimals come from the
 * registry (8 xStocks, 9 PreStocks).
 */
export function shares(mint: string, raw: string | null | undefined, decimals?: number) {
  if (raw == null) return null;
  const places = decimals ?? assetByMint(mint)?.decimals ?? 0;
  return fromBaseUnits(raw, places);
}

const DECIMAL = /^\d+(?:\.\d+)?$/;

function decimalString(value: string | null | undefined): `${number}` | null {
  return value != null && DECIMAL.test(value) ? (value as `${number}`) : null;
}

/** raw × multiplier / 10^decimals, exact: the amount a wallet shows for a Scaled UI mint. */
export function scaledShares(raw: string, decimals: number, multiplier: string): `${number}` {
  const [whole = "0", fraction = ""] = multiplier.split(".");
  return fromBaseUnits(BigInt(raw) * BigInt(`${whole}${fraction}`), decimals + fraction.length);
}

type ShareSource = {
  mint: string;
  sharesUi?: string | null | undefined;
  uiMultiplier?: string | null | undefined;
};

/**
 * Shares as the wallet shows them (PRD 14.7, F-16). The API's exact `sharesUi` wins; a raw
 * amount with a known multiplier is scaled here; a raw amount without one is shown unscaled.
 */
export function walletShares(
  source: ShareSource,
  raw: string | null | undefined,
  decimals?: number,
): `${number}` | null {
  const fromApi = decimalString(source.sharesUi);
  if (fromApi) return fromApi;
  if (raw == null) return null;
  const places = decimals ?? assetByMint(source.mint)?.decimals ?? 0;
  const multiplier = decimalString(source.uiMultiplier);
  return multiplier ? scaledShares(raw, places, multiplier) : fromBaseUnits(raw, places);
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
