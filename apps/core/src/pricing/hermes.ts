export type HermesPrice = {
  feedId: string;
  price: bigint;
  conf: bigint;
  exponent: number;
  publishTime: Date;
};

type ParsedUpdate = {
  id: string;
  price: { price: string; conf: string; expo: number; publish_time: number };
};

export type HermesConfig = { url: string; apiKey: string | undefined };

/**
 * Latest parsed Pyth prices for display; the execution path posts signed updates via the SDK.
 * Hermes price updates need `PYTH_API_KEY` as a bearer token; the key stays server-side.
 */
export async function latestPrices(
  hermes: HermesConfig,
  feedIds: readonly string[],
): Promise<HermesPrice[]> {
  if (feedIds.length === 0) return [];
  if (!hermes.apiKey) throw new Error("PYTH_API_KEY is not set");
  const url = new URL("/v2/updates/price/latest", hermes.url);
  for (const id of feedIds) url.searchParams.append("ids[]", id);
  url.searchParams.set("parsed", "true");
  url.searchParams.set("ignore_invalid_price_ids", "true");
  const response = await fetch(url, {
    headers: { accept: "application/json", authorization: `Bearer ${hermes.apiKey}` },
  });
  if (!response.ok) throw new Error(`Hermes latest prices failed with ${response.status}`);
  const body = (await response.json()) as { parsed?: ParsedUpdate[] };
  return (body.parsed ?? []).map((update) => ({
    feedId: update.id.replace(/^0x/, ""),
    price: BigInt(update.price.price),
    conf: BigInt(update.price.conf),
    exponent: update.price.expo,
    publishTime: new Date(update.price.publish_time * 1000),
  }));
}

/** USD × 1e9 per whole unit from a Pyth price, rounded down. */
export function priceE9(price: HermesPrice): bigint {
  const shift = 9 + price.exponent;
  return shift >= 0 ? price.price * 10n ** BigInt(shift) : price.price / 10n ** BigInt(-shift);
}
