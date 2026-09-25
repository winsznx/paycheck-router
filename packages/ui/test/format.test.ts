import { describe, expect, it } from "vitest";
import {
  formatBps,
  formatLocalReference,
  formatPremiumBps,
  formatPrice,
  formatShares,
  formatTime,
  formatUsd,
  formatUsdcAmount,
  fromBaseUnits,
  truncateMiddle,
} from "../src/format/index.ts";

describe("PRD 14.7 formatting", () => {
  it("converts base units without floats", () => {
    expect(fromBaseUnits("1850000000", 6)).toBe("1850.000000");
    expect(fromBaseUnits(41130000n, 8)).toBe("0.41130000");
    expect(fromBaseUnits("5", 6)).toBe("0.000005");
    expect(fromBaseUnits("-370000000", 6)).toBe("-370.000000");
  });

  it("formats USD and USDC with two decimals in the reader's locale", () => {
    expect(formatUsd("1850.000000", "en")).toBe("$1,850.00");
    expect(formatUsd(1850, "pt-BR")).toBe("US$ 1.850,00");
    expect(formatUsdcAmount("370.000000", "en")).toBe("370.00 USDC");
  });

  it("formats shares at four decimals in lists", () => {
    expect(formatShares("0.41130000", "en")).toBe("0.4113");
    expect(formatShares("0.411312345", "en", "full")).toBe("0.411312345");
  });

  it("formats prices at 2 decimals, 4 under $1", () => {
    expect(formatPrice(629.86, "en")).toBe("$629.86");
    expect(formatPrice(0.12345, "en")).toBe("$0.1235");
  });

  it("formats premium with a true minus sign", () => {
    expect(formatPremiumBps(-2, "en")).toBe("−0.02%");
    expect(formatPremiumBps(3040, "en")).toBe("+30.40%");
    expect(formatBps(3040, "en")).toBe("+3,040 bps");
  });

  it("formats the local reference with 0 decimals above 1,000 units", () => {
    expect(formatLocalReference(2812400, "NGN", "en-NG")).toBe("₦2,812,400");
    expect(formatLocalReference(512.5, "BRL", "pt-BR")).toBe("R$ 512,50");
  });

  it("uses relative time within 24 h and absolute after", () => {
    const now = new Date("2026-09-25T13:34:00Z");
    expect(formatTime(new Date("2026-09-25T13:32:00Z"), "en", "Africa/Lagos", now)).toBe(
      "2 min. ago",
    );
    expect(formatTime(new Date("2026-09-23T13:32:00Z"), "en-NG", "Africa/Lagos", now)).toBe(
      "23 Sept, 14:32 WAT",
    );
  });

  it("truncates the middle of addresses", () => {
    expect(truncateMiddle("7Yq3aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9Kd2")).toBe("7Yq3…9Kd2");
    expect(truncateMiddle("short")).toBe("short");
  });
});
