/**
 * Numbers derived from raw artifacts only: node responses, Jupiter build responses, Hermes
 * updates and mint reads. Shared by P7 (which publishes them) and `pnpm verify:campaign` (which
 * re-derives them). Guard arithmetic comes from `packages/guard-math`; nothing here is crank code.
 */
import {
  BPS,
  buyPremiumBps,
  effectiveMultiplier,
  multiplierToE12,
  pythPriceToE9,
} from "@paycheck-router/guard-math";

export type FillCost = {
  /** Gross delivery (owner's shares plus the withheld issuer fee) against the reference. */
  premiumBps: number;
  /** USDC in, protocol fee included, against the shares the owner kept. */
  allInCostBps: number;
  protocolFeeBps: number;
  issuerFeeBps: number;
};

export type Fill = {
  amountIn: bigint;
  fee: bigint;
  swappedIn: bigint;
  outAmount: bigint;
  issuerFee: bigint;
  usdcPriceE9: bigint;
  refPriceE9: bigint;
  multiplierE12: bigint;
  decimals: number;
};

export function fillCost(fill: Fill): FillCost {
  const reference = {
    usdcPriceE9: fill.usdcPriceE9,
    priceE9: fill.refPriceE9,
    multiplierE12: fill.multiplierE12,
    decimals: fill.decimals,
  };
  const gross = fill.outAmount + fill.issuerFee;
  return {
    premiumBps: Number(buyPremiumBps({ ...reference, usdcIn: fill.swappedIn, sharesOut: gross })),
    allInCostBps: Number(
      buyPremiumBps({ ...reference, usdcIn: fill.amountIn, sharesOut: fill.outAmount }),
    ),
    protocolFeeBps: Number((fill.fee * BPS) / fill.amountIn),
    issuerFeeBps: gross > 0n ? Number((fill.issuerFee * BPS) / gross) : 0,
  };
}

/** USDC base units the shares are worth at the reference: shares · m · P / (10^d · u), floored. */
export function referenceValueUsdc(
  shares: bigint,
  multiplierE12: bigint,
  priceE9: bigint,
  usdcPriceE9: bigint,
  decimals: number,
): bigint {
  return (
    (shares * multiplierE12 * priceE9 * 1_000_000n) /
    (10n ** BigInt(decimals) * 1_000_000_000_000n * usdcPriceE9)
  );
}

export type Quote = { inAmount: bigint; outAmount: bigint };

export type QuoteVersusReference = {
  premiumBps: number;
  /** USDC paid above the reference value of the quoted shares; zero when the quote is cheaper. */
  overpaymentUsdc: bigint;
};

/** A Jupiter quote priced against the independent reference at the same moment. */
export function quoteVersusReference(
  quote: Quote,
  reference: { usdcPriceE9: bigint; priceE9: bigint; multiplierE12: bigint; decimals: number },
): QuoteVersusReference {
  const value = referenceValueUsdc(
    quote.outAmount,
    reference.multiplierE12,
    reference.priceE9,
    reference.usdcPriceE9,
    reference.decimals,
  );
  return {
    premiumBps: Number(
      buyPremiumBps({ ...reference, usdcIn: quote.inAmount, sharesOut: quote.outAmount }),
    ),
    overpaymentUsdc: quote.inAmount > value ? quote.inAmount - value : 0n,
  };
}

type ParsedMint = {
  extensions?: {
    extension: string;
    state?: {
      multiplier?: string;
      newMultiplier?: string;
      newMultiplierEffectiveTimestamp?: number;
      olderTransferFee?: { epoch: number; transferFeeBasisPoints: number };
      newerTransferFee?: { epoch: number; transferFeeBasisPoints: number };
    };
  }[];
};

/** The parsed mint inside a stored `getAccountInfo` (jsonParsed) response. */
export function parsedMint(snapshot: unknown): ParsedMint {
  const value = (snapshot as { response?: { result?: { value?: unknown } } }).response?.result
    ?.value as { data?: { parsed?: { info?: ParsedMint } } } | null | undefined;
  const info = value?.data?.parsed?.info;
  if (!info) throw new Error("not a jsonParsed mint read");
  return info;
}

/** The buy-side multiplier at 1e12 (rounded down) the mint puts in force at `unixSecs`. */
export function buyMultiplierE12(snapshot: unknown, unixSecs: number): bigint {
  const scaled = parsedMint(snapshot).extensions?.find(
    (e) => e.extension === "scaledUiAmountConfig",
  );
  const state = scaled?.state;
  const multiplier = effectiveMultiplier(
    state?.multiplier
      ? {
          multiplier: Number(state.multiplier),
          newMultiplier: Number(state.newMultiplier ?? state.multiplier),
          newMultiplierEffectiveTimestamp: BigInt(state.newMultiplierEffectiveTimestamp ?? 0),
        }
      : null,
    BigInt(unixSecs),
  );
  return multiplierToE12(multiplier, "down");
}

/** The multipliers a mint read names: the current one and the pending one, both at 1e12. */
export function multiplierPairE12(snapshot: unknown): { current: bigint; pending: bigint } {
  const state = parsedMint(snapshot).extensions?.find(
    (e) => e.extension === "scaledUiAmountConfig",
  )?.state;
  const current = Number(state?.multiplier ?? 1);
  const pending = Number(state?.newMultiplier ?? current);
  return { current: multiplierToE12(current, "down"), pending: multiplierToE12(pending, "down") };
}

/** The issuer's Token-2022 transfer fee in force at `epoch`, in basis points. */
export function transferFeeBps(snapshot: unknown, epoch: number): number {
  const state = parsedMint(snapshot).extensions?.find(
    (e) => e.extension === "transferFeeConfig",
  )?.state;
  if (!state?.olderTransferFee || !state.newerTransferFee) return 0;
  return epoch >= state.newerTransferFee.epoch
    ? state.newerTransferFee.transferFeeBasisPoints
    : state.olderTransferFee.transferFeeBasisPoints;
}

type HermesParsed = { id: string; price: { price: string; expo: number; publish_time: number } };

/** A feed's price at 1e9 and its publish time from a stored Hermes response. */
export function hermesPriceE9(
  hermes: unknown,
  feedId: string,
): { priceE9: bigint; publishTime: number } | null {
  const parsed = (hermes as { parsed?: HermesParsed[] }).parsed ?? [];
  const entry = parsed.find((p) => p.id === feedId.replace(/^0x/, ""));
  if (!entry) return null;
  return {
    priceE9: pythPriceToE9(BigInt(entry.price.price), entry.price.expo),
    publishTime: entry.price.publish_time,
  };
}

/** Median of integers; the mean of the two middle values for an even count. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] as number;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] as number) + upper) / 2;
}

/** Dollars per $100 from basis points. */
export function per100(bps: number | null): number | null {
  return bps === null ? null : bps / 100;
}
