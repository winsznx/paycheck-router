import { WaitReason } from "@paycheck-router/shared";
import { describe, expect, it } from "vitest";
import { isOpen, nextOpen, parseSchedule } from "../src/schedule.ts";
import { nextAttempt } from "../src/waits.ts";

const SPY = parseSchedule(
  "America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;0907/C,1126/C,1127/0930-1300,1224/0930-1300,1225/C",
);
const at = (iso: string) => Date.parse(iso);

describe("Pyth market schedule", () => {
  it("opens at 09:30 New York time, 13:30 UTC in September", () => {
    expect(nextOpen(SPY, at("2026-09-25T10:00:00Z"))).toBe(at("2026-09-25T13:30:00Z"));
    expect(isOpen(SPY, at("2026-09-25T14:00:00Z"))).toBe(true);
  });

  it("skips the weekend after Friday's close", () => {
    expect(isOpen(SPY, at("2026-09-26T15:00:00Z"))).toBe(false);
    expect(nextOpen(SPY, at("2026-09-25T21:00:00Z"))).toBe(at("2026-09-28T13:30:00Z"));
  });

  it("skips Thanksgiving and follows the end of daylight saving", () => {
    expect(nextOpen(SPY, at("2026-11-25T22:00:00Z"))).toBe(at("2026-11-27T14:30:00Z"));
    expect(isOpen(SPY, at("2026-11-27T18:30:00Z"))).toBe(false);
  });

  it("rejects malformed schedules", () => {
    expect(() => parseSchedule("America/New_York;C,C")).toThrow();
    expect(() => parseSchedule("America/New_York;9-5,C,C,C,C,C,C")).toThrow();
  });
});

describe("nextAttempt", () => {
  const now = at("2026-09-25T21:00:00Z");

  it("waits for the next open plus 60 s when the market is closed", () => {
    expect(nextAttempt(WaitReason.MARKET_CLOSED, 0, now, SPY)).toEqual({
      kind: "at",
      unixMs: at("2026-09-28T13:31:00Z"),
    });
    expect(() => nextAttempt(WaitReason.MARKET_CLOSED, 0, now)).toThrow(/schedule/);
  });

  it("backs off premium waits and waits for allowance changes", () => {
    expect(nextAttempt(WaitReason.PREMIUM_TOO_HIGH, 2, now)).toEqual({
      kind: "at",
      unixMs: now + 300_000,
    });
    expect(nextAttempt(WaitReason.ALLOWANCE_REVOKED, 0, now)).toEqual({
      kind: "on_event",
      event: "allowance_change",
      fallbackUnixMs: now + 6 * 3_600_000,
    });
    expect(nextAttempt(WaitReason.EXPIRED, 0, now)).toEqual({ kind: "never" });
  });
});
