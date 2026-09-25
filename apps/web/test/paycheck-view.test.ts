import { describe, expect, it } from "vitest";
import { investProgress, paycheckNumber } from "@/lib/paycheck-view.ts";

describe("investProgress", () => {
  it("counts waiting slices as still to buy and settled ones as bought", () => {
    // #given the rehearsal's paycheck: Anthropic bought, three slices waiting
    const legs = [
      { status: "waiting", amountIn: "222000000" },
      { status: "waiting", amountIn: "74000000" },
      { status: "verified", amountIn: "37000000" },
      { status: "waiting", amountIn: "37000000" },
    ] as const;
    // #then
    expect(investProgress(legs)).toEqual({ open: 333_000_000n, bought: 37_000_000n });
  });

  it("leaves expired and cancelled slices out of both", () => {
    const legs = [
      { status: "expired", amountIn: "222000000" },
      { status: "cancelled", amountIn: "74000000" },
      { status: "executed", amountIn: "37000000" },
    ] as const;
    expect(investProgress(legs)).toEqual({ open: 0n, bought: 37_000_000n });
  });
});

describe("paycheckNumber", () => {
  it("numbers the first onchain paycheck (seq 0) as 1", () => {
    expect(paycheckNumber("0")).toBe("1");
    expect(paycheckNumber("41")).toBe("42");
  });
});
