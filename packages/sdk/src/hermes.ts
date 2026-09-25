import { z } from "zod";
import type { FetchLike } from "./json-rpc.ts";

export const HERMES_URL = "https://hermes.pyth.network";

const HermesPrice = z.object({
  price: z.string(),
  conf: z.string(),
  expo: z.number().int(),
  publish_time: z.number().int(),
});

export const HermesParsedUpdate = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  price: HermesPrice,
  ema_price: HermesPrice,
  metadata: z
    .object({
      slot: z.number().int().nullish(),
      proof_available_time: z.number().int().nullish(),
      prev_publish_time: z.number().int().nullish(),
    })
    .nullish(),
});
export type HermesParsedUpdate = z.infer<typeof HermesParsedUpdate>;

export const HermesUpdateResponse = z.object({
  binary: z.object({ encoding: z.literal("base64"), data: z.array(z.string()) }),
  parsed: z.array(HermesParsedUpdate),
});
export type HermesUpdateResponse = z.infer<typeof HermesUpdateResponse>;

export type HermesUpdate = {
  response: HermesUpdateResponse;
  raw: string;
  url: string;
};

/** Hermes has required an API key, sent as a bearer token, since 2026-08-26. */
export type HermesOptions = { apiKey?: string; baseUrl?: string; fetch?: FetchLike };

function stripHex(feedId: string): string {
  return feedId.startsWith("0x") ? feedId.slice(2) : feedId;
}

function idsQuery(feedIds: readonly string[]): string {
  const unique = [...new Set(feedIds.map(stripHex))];
  return unique.map((id) => `ids[]=${id}`).join("&");
}

async function fetchUpdate(url: string, options: HermesOptions): Promise<HermesUpdate> {
  const headers: Record<string, string> = {};
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
  const res = await (options.fetch ?? fetch)(url, { headers });
  const raw = await res.text();
  if (!res.ok) throw new HermesError(res.status, url, raw);
  return { response: HermesUpdateResponse.parse(JSON.parse(raw)), raw, url };
}

/** One accumulator update carrying the latest price of every feed. */
export function fetchLatestUpdate(
  feedIds: readonly string[],
  options: HermesOptions = {},
): Promise<HermesUpdate> {
  const base = options.baseUrl ?? HERMES_URL;
  return fetchUpdate(
    `${base}/v2/updates/price/latest?${idsQuery(feedIds)}&encoding=base64&parsed=true`,
    options,
  );
}

/** The update Hermes serves for the given publish time: the verifier's history source. */
export function fetchUpdateAt(
  publishTime: number,
  feedIds: readonly string[],
  options: HermesOptions = {},
): Promise<HermesUpdate> {
  const base = options.baseUrl ?? HERMES_URL;
  return fetchUpdate(
    `${base}/v2/updates/price/${publishTime}?${idsQuery(feedIds)}&encoding=base64&parsed=true`,
    options,
  );
}

export class HermesError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`Hermes ${status} for ${url}: ${body.slice(0, 300)}`);
    this.name = "HermesError";
  }
}

export function parsedPriceFor(
  update: HermesUpdateResponse,
  feedId: string,
): HermesParsedUpdate | undefined {
  const id = stripHex(feedId);
  return update.parsed.find((entry) => entry.id === id);
}
