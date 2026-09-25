import { RETRY_SCHEDULES, type WaitReason } from "@paycheck-router/shared";
import { type MarketSchedule, nextOpen } from "./schedule.ts";

export type NextAttempt =
  | { kind: "at"; unixMs: number }
  | { kind: "on_event"; event: "allowance_change" | "inflow"; fallbackUnixMs: number }
  | { kind: "never" };

/**
 * When a waiting leg is next tried. `attempt` counts earlier attempts that ended in the same
 * reason. MARKET_CLOSED needs the feed's Pyth schedule.
 */
export function nextAttempt(
  reason: WaitReason,
  attempt: number,
  nowMs: number,
  schedule: MarketSchedule | null = null,
): NextAttempt {
  const rule = RETRY_SCHEDULES[reason];
  switch (rule.kind) {
    case "backoff": {
      const delay = rule.delaysSecs[attempt] ?? rule.thenEverySecs;
      return { kind: "at", unixMs: nowMs + delay * 1000 };
    }
    case "on_event":
      return {
        kind: "on_event",
        event: rule.event,
        fallbackUnixMs: nowMs + rule.fallbackEverySecs * 1000,
      };
    case "session_open": {
      if (!schedule) throw new Error(`${reason} needs the feed's market schedule`);
      const open = nextOpen(schedule, nowMs);
      if (open === null) throw new Error("no session opens in the next 14 days");
      return { kind: "at", unixMs: open + rule.offsetSecs * 1000 };
    }
    case "none":
      return { kind: "never" };
  }
}
