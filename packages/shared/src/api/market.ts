import { z } from "zod";
import {
  AddressString,
  AssetKind,
  Bps,
  IsoDateTime,
  U64String,
  WaitReasonSchema,
} from "./common.ts";

/** A Pyth price as published: `price × 10^exponent` USD, confidence in the same units. */
export const PythPrice = z.object({
  feedId: z.string().regex(/^[0-9a-f]{64}$/),
  price: z.string().regex(/^-?\d+$/),
  conf: z.string().regex(/^\d+$/),
  exponent: z.number().int(),
  publishTime: IsoDateTime,
});
export type PythPrice = z.infer<typeof PythPrice>;

export const MarketStatus = z.object({
  /** `open` when the regular-session feed is fresh, `extended` when only the 24/7 feed is. */
  state: z.enum(["open", "extended", "closed", "always_open", "unknown"]),
  nextOpen: IsoDateTime.nullable(),
});
export type MarketStatus = z.infer<typeof MarketStatus>;

/** `GET /assets` item. Prices are null when the upstream could not be reached. */
export const Asset = z.object({
  mint: AddressString,
  symbol: z.string(),
  name: z.string(),
  kind: AssetKind,
  issuer: z.enum(["xstocks", "prestocks", "other"]),
  decimals: z.number().int(),
  tokenProgram: AddressString,
  status: z.enum(["active", "buys_paused", "converting", "delisted"]),
  defaultBandBps: Bps,
  maxBandBps: Bps,
  feedId: z.string().nullable(),
  feedId247: z.string().nullable(),
  market: MarketStatus,
  reference: PythPrice.nullable(),
  /**
   * Why `reference` (or `markPriceE9`) is missing: `not_entitled` when the Pyth key lacks the
   * feed grant, `upstream_error` when the source failed. Never replaced by another price.
   */
  referenceError: z.enum(["not_entitled", "upstream_error"]).nullable(),
  /** PreStocks mark in USD × 1e9, for pre-IPO assets. */
  markPriceE9: U64String.nullable(),
  /** USD price of one whole token on Jupiter right now, × 1e9. */
  onchainPriceE9: U64String.nullable(),
  /** Onchain price over reference, in bps; negative is a discount. */
  premiumBps: z.number().int().nullable(),
});
export type Asset = z.infer<typeof Asset>;

export const AssetsResponse = z.object({ assets: z.array(Asset), asOf: IsoDateTime });

/** `GET /assets/:mint`: the asset plus its daily reference closes over 30 days. */
export const AssetDetail = Asset.extend({
  series: z.array(
    z.object({
      day: z.iso.date(),
      /** Last Pyth price published that day, USD × 1e9 per whole token. */
      closeE9: U64String,
      publishTime: IsoDateTime,
    }),
  ),
});
export type AssetDetail = z.infer<typeof AssetDetail>;
export type AssetsResponse = z.infer<typeof AssetsResponse>;

export const LegSpec = z.object({
  mint: AddressString,
  weightBps: Bps.min(1),
  bandBps: Bps,
});
export type LegSpec = z.infer<typeof LegSpec>;

/**
 * `GET /quote/preview?amount=1850000000&investBps=2000&legs=<mint>:<weightBps>:<bandBps>,...`
 * Prices a hypothetical paycheck now without sending anything.
 */
export const QuotePreviewQuery = z.object({
  amount: U64String,
  investBps: z.coerce.number().int().min(100).max(10_000),
  legs: z
    .string()
    .transform((raw, ctx) => {
      const legs: LegSpec[] = [];
      for (const part of raw.split(",")) {
        const [mint, weight, band] = part.split(":");
        const parsed = LegSpec.safeParse({
          mint,
          weightBps: Number(weight),
          bandBps: Number(band),
        });
        if (!parsed.success) {
          ctx.addIssue({ code: "custom", message: `invalid leg "${part}"` });
          return z.NEVER;
        }
        legs.push(parsed.data);
      }
      return legs;
    })
    .pipe(z.array(LegSpec).min(1).max(8)),
});
export type QuotePreviewQuery = z.infer<typeof QuotePreviewQuery>;

export const QuotePreviewLeg = z.object({
  mint: AddressString,
  symbol: z.string(),
  amountIn: U64String,
  fee: U64String,
  /** Reference price (Pyth or PreStocks mark) in USD × 1e9 per whole token. */
  referencePriceE9: U64String.nullable(),
  /** Shares the program would require at minimum, in base units. */
  minOut: U64String.nullable(),
  /** Shares Jupiter quotes for this slice right now, in base units. */
  quotedOut: U64String.nullable(),
  premiumBps: z.number().int().nullable(),
  /** Set when no reference price could be read; the slice cannot be priced right now. */
  referenceError: z.enum(["not_entitled", "upstream_error"]).nullable(),
  wouldWait: WaitReasonSchema.nullable(),
});
export type QuotePreviewLeg = z.infer<typeof QuotePreviewLeg>;

export const QuotePreviewResponse = z.object({
  inflow: U64String,
  investTotal: U64String,
  feeBps: Bps,
  legs: z.array(QuotePreviewLeg),
  asOf: IsoDateTime,
});
export type QuotePreviewResponse = z.infer<typeof QuotePreviewResponse>;
