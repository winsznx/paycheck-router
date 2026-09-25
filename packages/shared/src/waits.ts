/** Reason codes a leg can wait (or stop) with, as shown to the owner. */
export const WaitReason = {
  MARKET_CLOSED: "MARKET_CLOSED",
  PREMIUM_TOO_HIGH: "PREMIUM_TOO_HIGH",
  PRICE_UNCERTAIN: "PRICE_UNCERTAIN",
  USDC_OFF_PEG: "USDC_OFF_PEG",
  ALLOWANCE_LOW: "ALLOWANCE_LOW",
  ALLOWANCE_REVOKED: "ALLOWANCE_REVOKED",
  FUNDS_MOVED: "FUNDS_MOVED",
  ASSET_PAUSED: "ASSET_PAUSED",
  LANDING: "LANDING",
  EXPIRED: "EXPIRED",
  PROTOCOL_PAUSED: "PROTOCOL_PAUSED",
  ROUTER_PAUSED: "ROUTER_PAUSED",
  BELOW_MINIMUM: "BELOW_MINIMUM",
  CONVERSION_CLOSED: "CONVERSION_CLOSED",
  /** Hermes refused the reference feed (for example, the key isn't entitled to it). */
  PRICE_UNAVAILABLE: "PRICE_UNAVAILABLE",
} as const;
export type WaitReason = (typeof WaitReason)[keyof typeof WaitReason];

export type RetrySchedule =
  /** Retry after each delay in turn, then every `thenEverySecs`. */
  | { kind: "backoff"; delaysSecs: readonly number[]; thenEverySecs: number }
  /** Retry at the next session open from the feed's Pyth schedule, plus an offset. */
  | { kind: "session_open"; offsetSecs: number }
  /** Retry when the named event arrives, or on the fallback interval. */
  | { kind: "on_event"; event: "allowance_change" | "inflow"; fallbackEverySecs: number }
  /** No retry: the leg or router is final until something outside the crank changes it. */
  | { kind: "none" };

const MINUTE = 60;
const HOUR = 60 * MINUTE;

export const RETRY_SCHEDULES: Readonly<Record<WaitReason, RetrySchedule>> = {
  MARKET_CLOSED: { kind: "session_open", offsetSecs: MINUTE },
  PREMIUM_TOO_HIGH: {
    kind: "backoff",
    delaysSecs: [1, 2, 5, 10, 15, 30].map((m) => m * MINUTE),
    thenEverySecs: 30 * MINUTE,
  },
  PRICE_UNCERTAIN: { kind: "backoff", delaysSecs: [], thenEverySecs: 5 * MINUTE },
  USDC_OFF_PEG: { kind: "backoff", delaysSecs: [], thenEverySecs: 15 * MINUTE },
  ALLOWANCE_LOW: { kind: "on_event", event: "allowance_change", fallbackEverySecs: 6 * HOUR },
  ALLOWANCE_REVOKED: { kind: "on_event", event: "allowance_change", fallbackEverySecs: 6 * HOUR },
  FUNDS_MOVED: { kind: "on_event", event: "inflow", fallbackEverySecs: HOUR },
  ASSET_PAUSED: { kind: "backoff", delaysSecs: [], thenEverySecs: HOUR },
  LANDING: { kind: "backoff", delaysSecs: [0, 0, 0, 0, 0], thenEverySecs: MINUTE },
  EXPIRED: { kind: "none" },
  PROTOCOL_PAUSED: { kind: "none" },
  ROUTER_PAUSED: { kind: "none" },
  BELOW_MINIMUM: { kind: "none" },
  CONVERSION_CLOSED: { kind: "none" },
  PRICE_UNAVAILABLE: { kind: "backoff", delaysSecs: [], thenEverySecs: 15 * MINUTE },
};

/** What the owner sees while a slice waits on PRICE_UNAVAILABLE. */
export function priceUnavailableMessage(symbol: string, amount: string): string {
  return `Pyth's price for ${symbol} isn't available to the router right now. Your ${amount} waits in your wallet.`;
}

/**
 * Seconds until the next attempt for time-based schedules, where `attempt` counts prior
 * attempts that ended in this reason (0 for the first retry). Returns null when the schedule
 * depends on a market session or has no retry.
 */
export function retryDelaySecs(reason: WaitReason, attempt: number): number | null {
  const schedule = RETRY_SCHEDULES[reason];
  switch (schedule.kind) {
    case "backoff":
      return schedule.delaysSecs[attempt] ?? schedule.thenEverySecs;
    case "on_event":
      return schedule.fallbackEverySecs;
    case "session_open":
    case "none":
      return null;
  }
}
