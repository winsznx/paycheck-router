/**
 * PRD 14.7 and 17.3. Every number goes through Intl in the reader's locale. Amounts arrive
 * as decimal strings so base-unit values never pass through a float.
 */

const MINUS = "−";

type Decimal = number | bigint | `${number}`;

const trueMinus = (text: string): string => text.replace(/-/g, MINUS);

/** Converts an integer base-unit amount (e.g. "1850000000" with 6 decimals) to a decimal string. */
export function fromBaseUnits(raw: string | bigint, decimals: number): `${number}` {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? `.${digits.slice(digits.length - decimals)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}` as `${number}`;
}

export const USDC_DECIMALS = 6;

export function formatUsd(value: Decimal, locale: string): string {
  return trueMinus(
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value),
  );
}

/** Whole-dollar display for copy lines such as "Buying $370 of stocks" (PRD 13.5). */
export function formatUsdWhole(value: Decimal, locale: string): string {
  return trueMinus(
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
      trailingZeroDisplay: "stripIfInteger",
    }).format(value),
  );
}

export function formatUsdcAmount(value: Decimal, locale: string): string {
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${trueMinus(number)} USDC`;
}

/** Shares are the Scaled UI amount: 4 decimals in lists, full precision on demand. */
export function formatShares(
  uiAmount: Decimal,
  locale: string,
  precision: "list" | "full" = "list",
): string {
  return trueMinus(
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: precision === "list" ? 4 : 0,
      maximumFractionDigits: precision === "list" ? 4 : 12,
    }).format(uiAmount),
  );
}

/** Prices: 2 decimals, 4 under $1. */
export function formatPrice(value: number, locale: string): string {
  const digits = Math.abs(value) < 1 ? 4 : 2;
  return trueMinus(
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value),
  );
}

/** Premium in basis points rendered as a signed percent with a true minus sign: −0.02%, +30.40%. */
export function formatPremiumBps(bps: number, locale: string): string {
  return trueMinus(
    new Intl.NumberFormat(locale, {
      style: "percent",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      signDisplay: "exceptZero",
    }).format(bps / 10_000),
  );
}

/** Proof drawer form: "+3,040 bps". */
export function formatBps(bps: number, locale: string): string {
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  }).format(bps);
  return `${trueMinus(number)} bps`;
}

export function formatPercent(bps: number, locale: string, fractionDigits = 0): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(bps / 10_000);
}

/** Local currency reference (PRD 7.7): display-only, 0 decimals above 1,000 units. */
export function formatLocalReference(value: number, currency: string, locale: string): string {
  const digits = Math.abs(value) >= 1000 ? 0 : 2;
  return trueMinus(
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value),
  );
}

const DAY_MS = 86_400_000;

const RELATIVE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1_000],
];

/** Relative within 24 h ("2 min ago"), absolute after ("25 Sep, 14:32 GMT+1"). */
export function formatTime(
  at: Date | string,
  locale: string,
  timeZone?: string,
  now: Date = new Date(),
): string {
  const date = typeof at === "string" ? new Date(at) : at;
  const delta = date.getTime() - now.getTime();
  if (Math.abs(delta) < DAY_MS) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
    for (const [unit, ms] of RELATIVE_UNITS) {
      if (Math.abs(delta) >= ms || unit === "second") {
        return rtf.format(Math.trunc(delta / ms), unit);
      }
    }
  }
  return formatTimestamp(date, locale, timeZone);
}

/** Exact timestamp with timezone, used on hover and after 24 h. */
export function formatTimestamp(at: Date | string, locale: string, timeZone?: string): string {
  const date = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

/** Addresses, slots and signatures: mono, truncated middle (7Yq3…9Kd2). */
export function truncateMiddle(value: string, head = 4, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
