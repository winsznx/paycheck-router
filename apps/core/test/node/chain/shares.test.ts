import { describe, expect, it } from "vitest";
import { fixedToDecimal, multiplierFromE12, sharesUi } from "../../../src/chain/shares.ts";

describe("UI shares", () => {
  it("applies the Scaled UI multiplier exactly", () => {
    // 0.4113 raw SPYx-style (8 decimals) at OpenAI's 1.4861347 multiplier
    expect(sharesUi(41_130_000n, 8, "1.4861347")).toBe("0.61124720211");
    expect(sharesUi(41_130_000n, 8, "1")).toBe("0.4113");
    expect(sharesUi(0n, 9, "1.25")).toBe("0");
    expect(sharesUi(1_000_000_000n, 9, "2")).toBe("2");
  });

  it("renders the program's 1e12 multiplier as a decimal", () => {
    expect(multiplierFromE12(1_486_134_700_000n)).toBe("1.4861347");
    expect(multiplierFromE12(1_000_000_000_000n)).toBe("1");
  });

  it("formats fixed-point values without float drift", () => {
    expect(fixedToDecimal(12_345n, 2)).toBe("123.45");
    expect(fixedToDecimal(5n, 3)).toBe("0.005");
    expect(fixedToDecimal(-2_500n, 3)).toBe("-2.5");
  });

  it("rejects a malformed multiplier", () => {
    expect(() => sharesUi(1n, 0, "1e5")).toThrow("bad multiplier");
  });
});
