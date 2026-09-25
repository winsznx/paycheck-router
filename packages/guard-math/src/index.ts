/**
 * Reference model of the program's price guard. Every value is an unsigned integer held in a
 * bigint and every product is checked against u128, so a result here is exactly what the
 * program computes and an overflow here is a `MathOverflow` there.
 *
 * Fixed point: prices at 1e9, Scaled UI multipliers at 1e12, bands in basis points.
 * Each formula is reduced to one numerator over one denominator and floored once.
 */

export const U128_MAX = (1n << 128n) - 1n;
export const U64_MAX = (1n << 64n) - 1n;
export const PRICE_SCALE = 1_000_000_000n;
export const MULTIPLIER_SCALE = 1_000_000_000_000n;
export const BPS = 10_000n;
const USDC_SCALE = 1_000_000n;

export class GuardMathError extends Error {
  readonly code = "MathOverflow";
  constructor(detail: string) {
    super(`MathOverflow: ${detail}`);
    this.name = "GuardMathError";
  }
}

function checkedMul(...factors: bigint[]): bigint {
  let acc = 1n;
  for (const factor of factors) {
    acc *= factor;
    if (acc > U128_MAX) throw new GuardMathError("u128 product overflow");
  }
  return acc;
}

function checkedDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new GuardMathError("division by zero");
  return numerator / denominator;
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function requireUint(name: string, value: bigint, max: bigint): void {
  if (value < 0n || value > max) throw new RangeError(`${name} out of range: ${value}`);
}

function requireDecimals(name: string, decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new RangeError(`${name} out of range: ${decimals}`);
  }
}

function requireBand(bandBps: number, allowFull: boolean): bigint {
  const max = allowFull ? 65_535 : 9_999;
  if (!Number.isInteger(bandBps) || bandBps < 0 || bandBps > max) {
    throw new RangeError(`bandBps out of range: ${bandBps}`);
  }
  return BigInt(bandBps);
}

export type BuyInputs = {
  /** USDC swapped in, base units (6 decimals). */
  usdcIn: bigint;
  /** Pyth Crypto.USDC/USD price at 1e9. */
  usdcPriceE9: bigint;
  /** Pyth price per share in USD at 1e9. */
  priceE9: bigint;
  bandBps: number;
  /** Effective Scaled UI multiplier at 1e12. */
  multiplierE12: bigint;
  decimals: number;
};

/** Smallest raw token amount the owner must receive for `usdcIn`. */
export function buyMinOut(inputs: BuyInputs): bigint {
  const { usdcIn, usdcPriceE9, priceE9, multiplierE12, decimals } = inputs;
  requireUint("usdcIn", usdcIn, U64_MAX);
  requireUint("usdcPriceE9", usdcPriceE9, U128_MAX);
  requireUint("priceE9", priceE9, U128_MAX);
  requireUint("multiplierE12", multiplierE12, U128_MAX);
  requireDecimals("decimals", decimals);
  const band = requireBand(inputs.bandBps, true);
  const numerator = checkedMul(
    usdcIn,
    usdcPriceE9,
    pow10(decimals),
    BPS,
    MULTIPLIER_SCALE / USDC_SCALE,
  );
  const denominator = checkedMul(priceE9, BPS + band, multiplierE12);
  return checkedDiv(numerator, denominator);
}

export type SellInputs = {
  /** Raw token amount sold. */
  sharesIn: bigint;
  usdcPriceE9: bigint;
  priceE9: bigint;
  bandBps: number;
  multiplierE12: bigint;
  decimals: number;
};

/** Smallest USDC base-unit amount the owner must receive for `sharesIn`. */
export function sellMinUsdc(inputs: SellInputs): bigint {
  const { sharesIn, usdcPriceE9, priceE9, multiplierE12, decimals } = inputs;
  requireUint("sharesIn", sharesIn, U64_MAX);
  requireUint("usdcPriceE9", usdcPriceE9, U128_MAX);
  requireUint("priceE9", priceE9, U128_MAX);
  requireUint("multiplierE12", multiplierE12, U128_MAX);
  requireDecimals("decimals", decimals);
  const band = requireBand(inputs.bandBps, false);
  const numerator = checkedMul(sharesIn, multiplierE12, priceE9, BPS - band);
  const denominator = checkedMul(pow10(decimals), usdcPriceE9, BPS, MULTIPLIER_SCALE / USDC_SCALE);
  return checkedDiv(numerator, denominator);
}

export type ConvertInputs = {
  /** Raw pre-IPO token amount converted. */
  sharesIn: bigint;
  preMultiplierE12: bigint;
  preDecimals: number;
  /** Target UI units per pre-IPO UI unit, as numerator over denominator. */
  ratioNum: bigint;
  ratioDen: bigint;
  bandBps: number;
  targetMultiplierE12: bigint;
  targetDecimals: number;
};

/** Smallest raw target-token amount the owner must receive for `sharesIn`. */
export function convertMinTarget(inputs: ConvertInputs): bigint {
  const { sharesIn, preMultiplierE12, ratioNum, ratioDen, targetMultiplierE12 } = inputs;
  requireUint("sharesIn", sharesIn, U64_MAX);
  requireUint("preMultiplierE12", preMultiplierE12, U128_MAX);
  requireUint("ratioNum", ratioNum, U64_MAX);
  requireUint("ratioDen", ratioDen, U64_MAX);
  requireUint("targetMultiplierE12", targetMultiplierE12, U128_MAX);
  requireDecimals("preDecimals", inputs.preDecimals);
  requireDecimals("targetDecimals", inputs.targetDecimals);
  const band = requireBand(inputs.bandBps, false);
  const numerator = checkedMul(
    sharesIn,
    preMultiplierE12,
    ratioNum,
    BPS - band,
    pow10(inputs.targetDecimals),
  );
  const denominator = checkedMul(pow10(inputs.preDecimals), ratioDen, BPS, targetMultiplierE12);
  return checkedDiv(numerator, denominator);
}

/** Fee taken from a leg before the swap: floor(amount × feeBps / 10,000). */
export function legFee(amountIn: bigint, feeBps: number): bigint {
  requireUint("amountIn", amountIn, U64_MAX);
  return (amountIn * BigInt(feeBps)) / BPS;
}

/**
 * Converts a Pyth price (mantissa and base-10 exponent) to 1e9 fixed point, flooring when the
 * exponent is finer than 1e-9.
 */
export function pythPriceToE9(price: bigint, exponent: number): bigint {
  if (price < 0n) throw new RangeError(`negative price ${price}`);
  const shift = 9 + exponent;
  return shift >= 0 ? price * pow10(shift) : price / pow10(-shift);
}

/** Converts the mint's f64 multiplier to 1e12 fixed point the way Rust's `as u128` does. */
export function multiplierToE12(multiplier: number): bigint {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError(`invalid multiplier ${multiplier}`);
  }
  return BigInt(Math.trunc(multiplier * 1e12));
}

export type ScaledUiAmountConfig = {
  multiplier: number;
  newMultiplier: number;
  newMultiplierEffectiveTimestamp: bigint;
};

/** The multiplier in force at `now`: the new one once its timestamp passes, else the current. */
export function effectiveMultiplier(config: ScaledUiAmountConfig | null, now: bigint): number {
  if (!config) return 1;
  return now >= config.newMultiplierEffectiveTimestamp ? config.newMultiplier : config.multiplier;
}

/** Confidence / price within `maxConfBps`. */
export function confidenceWithin(price: bigint, conf: bigint, maxConfBps: number): boolean {
  if (price <= 0n) return false;
  return conf * BPS <= price * BigInt(maxConfBps);
}

/** USDC/USD within `pegBps` of 1.00, with the price at 1e9. */
export function usdcWithinPeg(usdcPriceE9: bigint, pegBps: number): boolean {
  const deviation =
    usdcPriceE9 > PRICE_SCALE ? usdcPriceE9 - PRICE_SCALE : PRICE_SCALE - usdcPriceE9;
  return deviation * BPS <= PRICE_SCALE * BigInt(pegBps);
}

export type FillInputs = {
  usdcIn: bigint;
  sharesOut: bigint;
  usdcPriceE9: bigint;
  priceE9: bigint;
  multiplierE12: bigint;
  decimals: number;
};

/**
 * Premium paid over the reference price for a buy, in basis points, floored. Positive means
 * the owner paid more per share than the reference. Offchain metric: no u128 bound.
 */
export function buyPremiumBps(fill: FillInputs): bigint {
  if (fill.sharesOut <= 0n) throw new RangeError("sharesOut must be positive");
  const paid = fill.usdcIn * fill.usdcPriceE9 * pow10(fill.decimals) * MULTIPLIER_SCALE * BPS;
  const reference = USDC_SCALE * fill.sharesOut * fill.multiplierE12 * fill.priceE9;
  return paid / reference - BPS;
}
