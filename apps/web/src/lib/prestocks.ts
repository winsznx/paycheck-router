import "server-only";
import { z } from "zod";

/** The fields this site reads from the public PreStocks API (PRD 7.5). */
const PreStocksToken = z.object({
  name: z.string(),
  symbol: z.string(),
  contract_address: z.string(),
  markPrice: z.number().positive(),
  tokenPrice: z.number().positive(),
  external_url: z.string().url().optional(),
});

export type PreStocksQuote = {
  name: string;
  mint: string;
  markPrice: number;
  tokenPrice: number;
  /** Token price over the mark, in basis points. */
  premiumBps: number;
  url: string | undefined;
};

export type PreStocksSnapshot = { quotes: PreStocksQuote[]; fetchedAt: string };

const PRESTOCKS_URL = "https://prestocks.com/api/prestocks";

/** Live marks and token prices, cached for a minute; null when the upstream is unreachable. */
export async function fetchPreStocks(): Promise<PreStocksSnapshot | null> {
  try {
    const response = await fetch(PRESTOCKS_URL, {
      headers: { accept: "application/json" },
      next: { revalidate: 60 },
    });
    if (!response.ok) return null;
    const tokens = z.array(PreStocksToken).parse(await response.json());
    return {
      fetchedAt: new Date().toISOString(),
      quotes: tokens.map((token) => ({
        name: token.name,
        mint: token.contract_address,
        markPrice: token.markPrice,
        tokenPrice: token.tokenPrice,
        premiumBps: Math.round((token.tokenPrice / token.markPrice - 1) * 10_000),
        url: token.external_url,
      })),
    };
  } catch {
    return null;
  }
}
