/**
 * Reference model of the program's price guard. Values are unsigned integers held in bigints
 * and range-checked against the program's Rust types. Each formula is one numerator over one
 * denominator, each checked against 256 bits, floored once, and the result must fit a u64: a
 * value here is exactly what the program computes and a `GuardMathError` here is its
 * `MathOverflow`.
 *
 * Fixed point: prices at 1e9, Scaled UI multipliers at 1e12, bands in basis points.
 */

export const U256_MAX = (1n << 256n) - 1n;
export const U128_MAX = (1n << 128n) - 1n;
export const U64_MAX = (1n << 64n) - 1n;
export const U16_MAX = 65_535;
export const U8_MAX = 255;
export const PRICE_SCALE = 1_000_000_000n;
export const MULTIPLIER_SCALE = 1_000_000_000_000n;
export const BPS = 10_000n;
/** 10^6 USDC base units times 10^12 / 10^6 of multiplier scale folded into one factor. */
const TEN_POW_10 = 10_000_000_000n;

export class GuardMathError extends Error {
  readonly code = "MathOverflow";
  constructor(detail: string) {
    super(`MathOverflow: ${detail}`);
    this.name = "GuardMathError";
  }
}

function product(...factors: bigint[]): bigint {
  let acc = 1n;
  for (const factor of factors) {
    acc *= factor;
    if (acc > U256_MAX) throw new GuardMathError("256-bit product overflow");
  }
  return acc;
}

function floorDivToU64(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new GuardMathError("zero denominator");
  const quotient = numerator / denominator;
  if (quotient > U64_MAX) throw new GuardMathError("result exceeds u64");
  return quotient;
}

function pow10(exponent: number): bigint {
  return product(10n ** BigInt(exponent));
}

function requireUint(name: string, value: bigint, max: bigint): void {
  if (value < 0n || value > max) throw new RangeError(`${name} out of range: ${value}`);
}

function requireSmallUint(name: string, value: number, max: number): bigint {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${name} out of range: ${value}`);
  }
  return BigInt(value);
}

/** BPS − band, which the program computes with `checked_sub`. */
function bandBelow(bandBps: number): bigint {
  const band = requireSmallUint("bandBps", bandBps, U16_MAX);
  if (band > BPS) throw new GuardMathError("band above 100%");
  return BPS - band;
}

export type BuyInputs = {
  /** USDC swapped in (leg amount less the fee), base units. u64. */
  usdcIn: bigint;
  /** Pyth Crypto.USDC/USD price at 1e9. u64. */
  usdcPriceE9: bigint;
  /** Pyth price per share in USD at 1e9. u64. */
  priceE9: bigint;
  /** u16. */
  bandBps: number;
  /** Effective Scaled UI multiplier at 1e12, rounded down. u128. */
  multiplierE12: bigint;
  /** u8. */
  decimals: number;
};

/** floor(U · u · 10^d / (10^6 · P · (1 + b/10^4) · m)): smallest raw amount the owner receives. */
export function buyMinOut(inputs: BuyInputs): bigint {
  requireUint("usdcIn", inputs.usdcIn, U64_MAX);
  requireUint("usdcPriceE9", inputs.usdcPriceE9, U64_MAX);
  requireUint("priceE9", inputs.priceE9, U64_MAX);
  requireUint("multiplierE12", inputs.multiplierE12, U128_MAX);
  const decimals = requireSmallUint("decimals", inputs.decimals, U8_MAX);
  const band = requireSmallUint("bandBps", inputs.bandBps, U16_MAX);
  const numerator = product(inputs.usdcIn, inputs.usdcPriceE9, pow10(Number(decimals)), TEN_POW_10);
  const denominator = product(inputs.priceE9, BPS + band, inputs.multiplierE12);
  return floorDivToU64(numerator, denominator);
}

export type SellInputs = {
  /** Raw token amount sold. u64. */
  sharesIn: bigint;
  usdcPriceE9: bigint;
  priceE9: bigint;
  bandBps: number;
  /** Effective Scaled UI multiplier at 1e12, rounded up. u128. */
  multiplierE12: bigint;
  decimals: number;
};

/** floor(S · m · P · (1 − b/10^4) · 10^6 / (10^d · u)): smallest USDC the owner receives. */
export function sellMinUsdc(inputs: SellInputs): bigint {
  requireUint("sharesIn", inputs.sharesIn, U64_MAX);
  requireUint("usdcPriceE9", inputs.usdcPriceE9, U64_MAX);
  requireUint("priceE9", inputs.priceE9, U64_MAX);
  requireUint("multiplierE12", inputs.multiplierE12, U128_MAX);
  const decimals = requireSmallUint("decimals", inputs.decimals, U8_MAX);
  const numerator = product(
    inputs.sharesIn,
    inputs.multiplierE12,
    inputs.priceE9,
    bandBelow(inputs.bandBps),
  );
  const denominator = product(pow10(Number(decimals)), inputs.usdcPriceE9, TEN_POW_10);
  return floorDivToU64(numerator, denominator);
}

export type ConvertInputs = {
  /** Raw pre-IPO token amount converted. u64. */
  sharesIn: bigint;
  /** Pre-IPO multiplier at 1e12, rounded up. u128. */
  preMultiplierE12: bigint;
  preDecimals: number;
  /** Target UI units per pre-IPO UI unit, as numerator over denominator. u64 each. */
  ratioNum: bigint;
  ratioDen: bigint;
  bandBps: number;
  /** Target multiplier at 1e12, rounded down. u128. */
  targetMultiplierE12: bigint;
  targetDecimals: number;
};

/** floor(S · m_pre / 10^d_pre · r · (1 − b/10^4) · 10^d_t / m_t). */
export function convertMinTarget(inputs: ConvertInputs): bigint {
  requireUint("sharesIn", inputs.sharesIn, U64_MAX);
  requireUint("preMultiplierE12", inputs.preMultiplierE12, U128_MAX);
  requireUint("ratioNum", inputs.ratioNum, U64_MAX);
  requireUint("ratioDen", inputs.ratioDen, U64_MAX);
  requireUint("targetMultiplierE12", inputs.targetMultiplierE12, U128_MAX);
  const preDecimals = requireSmallUint("preDecimals", inputs.preDecimals, U8_MAX);
  const targetDecimals = requireSmallUint("targetDecimals", inputs.targetDecimals, U8_MAX);
  const numerator = product(
    inputs.sharesIn,
    inputs.preMultiplierE12,
    inputs.ratioNum,
    bandBelow(inputs.bandBps),
    pow10(Number(targetDecimals)),
  );
  const denominator = product(
    pow10(Number(preDecimals)),
    inputs.ratioDen,
    BPS,
    inputs.targetMultiplierE12,
  );
  return floorDivToU64(numerator, denominator);
}

/** floor(amount × bps / 10,000), used for the protocol fee. */
export function bpsOf(amount: bigint, bps: number): bigint {
  requireUint("amount", amount, U64_MAX);
  return (amount * requireSmallUint("bps", bps, U16_MAX)) / BPS;
}

/**
 * Converts a Pyth price (mantissa and base-10 exponent) to 1e9 fixed point, flooring when the
 * exponent is finer than 1e-9. Non-positive prices and results that leave u64 or floor to zero
 * are rejected, as in the program.
 */
export function pythPriceToE9(price: bigint, exponent: number): bigint {
  if (price <= 0n) throw new GuardMathError(`non-positive price ${price}`);
  const shift = 9 + exponent;
  const scaled = shift >= 0 ? product(price, pow10(shift)) : price / pow10(-shift);
  if (scaled === 0n || scaled > U64_MAX) throw new GuardMathError("price out of range");
  return scaled;
}

export type Rounding = "down" | "up";

/**
 * Converts the mint's f64 multiplier to 1e12 fixed point. Round down where the multiplier
 * divides the minimum (buy, convert target) and up where it multiplies it (sell, convert source),
 * so the minimum always favours the owner.
 */
export function multiplierToE12(multiplier: number, rounding: Rounding): bigint {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new GuardMathError(`invalid multiplier ${multiplier}`);
  }
  const scaled = multiplier * 1e12;
  const rounded = rounding === "down" ? Math.floor(scaled) : Math.ceil(scaled);
  if (rounded < 1 || rounded >= 2 ** 64) throw new GuardMathError("multiplier out of range");
  return BigInt(rounded);
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

/** conf / price ≤ maxConfBps / 10^4. */
export function confidenceWithin(price: bigint, conf: bigint, maxConfBps: number): boolean {
  return conf * BPS <= price * BigInt(maxConfBps);
}

/** USDC/USD at 1e9 within `pegBps` of 1.00. */
export function usdcWithinPeg(usdcPriceE9: bigint, pegBps: number): boolean {
  const deviation =
    usdcPriceE9 > PRICE_SCALE ? usdcPriceE9 - PRICE_SCALE : PRICE_SCALE - usdcPriceE9;
  return deviation <= (PRICE_SCALE / BPS) * BigInt(pegBps);
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
 * Premium paid over the reference price for a buy, in basis points, floored toward negative
 * infinity. Positive means the owner paid more per share than the reference. Offchain metric.
 */
export function buyPremiumBps(fill: FillInputs): bigint {
  if (fill.sharesOut <= 0n) throw new RangeError("sharesOut must be positive");
  const paid = fill.usdcIn * fill.usdcPriceE9 * 10n ** BigInt(fill.decimals) * TEN_POW_10;
  const reference = fill.sharesOut * fill.multiplierE12 * fill.priceE9;
  return paid / reference - BPS;
}
