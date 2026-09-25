/** `value / 10^scale` as a decimal string, exact, with trailing zeros trimmed. */
export function fixedToDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** The Scaled UI multiplier the program used, from `LegExecuted.multiplier_e12`. */
export function multiplierFromE12(multiplierE12: bigint): string {
  return fixedToDecimal(multiplierE12, 12);
}

/**
 * Shares as the wallet shows them: raw × multiplier / 10^decimals, computed exactly from the
 * multiplier's decimal form (the only rounding is the multiplier's own f64).
 */
export function sharesUi(raw: bigint, decimals: number, multiplier: string): string {
  if (!/^\d+(\.\d+)?$/.test(multiplier)) throw new Error(`bad multiplier ${multiplier}`);
  const [whole = "0", fraction = ""] = multiplier.split(".");
  return fixedToDecimal(raw * BigInt(`${whole}${fraction}`), decimals + fraction.length);
}
