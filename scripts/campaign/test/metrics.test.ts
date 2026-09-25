import { describe, expect, it } from "vitest";
import { CASES, caseByName } from "../cases/index.ts";
import { probe } from "../lib/manifest.ts";
import {
  fillCost,
  median,
  per100,
  quoteVersusReference,
  referenceValueUsdc,
  transferFeeBps,
} from "../lib/metrics.ts";
import {
  readScaledUiAmount,
  SCALED_UI_AMOUNT_EXTENSION,
  withPendingMultiplier,
} from "../lib/mint.ts";

describe("fillCost", () => {
  // $100 of USDC at $1.00 for 0.5 shares of a $199.60 stock, 8 decimals, no issuer fee.
  const fill = {
    amountIn: 100_000_000n,
    fee: 200_000n,
    swappedIn: 99_800_000n,
    outAmount: 50_000_000n,
    issuerFee: 0n,
    usdcPriceE9: 1_000_000_000n,
    refPriceE9: 199_600_000_000n,
    multiplierE12: 1_000_000_000_000n,
    decimals: 8,
  };

  it("prices a fill at the reference as zero premium and the fee as the all-in cost", () => {
    const cost = fillCost(fill);
    expect(cost.premiumBps).toBe(0);
    expect(cost.protocolFeeBps).toBe(20);
    expect(cost.allInCostBps).toBe(20);
    expect(cost.issuerFeeBps).toBe(0);
  });

  it("counts the issuer fee in all-in cost but not in the premium", () => {
    const cost = fillCost({ ...fill, outAmount: 49_500_000n, issuerFee: 500_000n });
    expect(cost.premiumBps).toBe(0);
    expect(cost.issuerFeeBps).toBe(100);
    expect(cost.allInCostBps).toBe(121);
  });
});

describe("quoteVersusReference", () => {
  const reference = {
    usdcPriceE9: 1_000_000_000n,
    priceE9: 1_000_000_000_000n,
    multiplierE12: 1_000_000_000_000n,
    decimals: 9,
  };

  it("measures a quote 30% over the reference", () => {
    // 100 USDC buys 0.076923 tokens of a $1,000 mark: the owner pays $100 for $76.92.
    const quote = { inAmount: 100_000_000n, outAmount: 76_923_077n };
    const result = quoteVersusReference(quote, reference);
    expect(result.premiumBps).toBe(2999);
    expect(result.overpaymentUsdc).toBe(100_000_000n - 76_923_077n);
  });

  it("reports no overpayment for a quote under the reference", () => {
    const result = quoteVersusReference(
      { inAmount: 100_000_000n, outAmount: 110_000_000n },
      reference,
    );
    expect(result.premiumBps).toBeLessThan(0);
    expect(result.overpaymentUsdc).toBe(0n);
  });

  it("values shares with the Scaled UI multiplier", () => {
    const value = referenceValueUsdc(
      1_000_000_000n,
      1_486_134_700_000n,
      1_000_000_000_000n,
      1_000_000_000n,
      9,
    );
    expect(value).toBe(1_486_134_700n);
  });
});

describe("median and per100", () => {
  it("takes the middle value or the mean of the two middles", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(per100(45)).toBe(0.45);
  });
});

describe("transferFeeBps", () => {
  const mint = {
    response: {
      result: {
        value: {
          data: {
            parsed: {
              info: {
                extensions: [
                  {
                    extension: "transferFeeConfig",
                    state: {
                      olderTransferFee: { epoch: 1039, transferFeeBasisPoints: 100 },
                      newerTransferFee: { epoch: 1043, transferFeeBasisPoints: 300 },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  };

  it("uses the older fee until the newer one's epoch", () => {
    expect(transferFeeBps(mint, 1042)).toBe(100);
    expect(transferFeeBps(mint, 1043)).toBe(300);
  });
});

describe("Scaled UI multiplier patch", () => {
  function mintWithScaledUi(multiplier: number): Uint8Array {
    const data = new Uint8Array(166 + 4 + 56);
    data[165] = 1;
    const view = new DataView(data.buffer);
    view.setUint16(166, SCALED_UI_AMOUNT_EXTENSION, true);
    view.setUint16(168, 56, true);
    view.setFloat64(170 + 32, multiplier, true);
    view.setFloat64(170 + 48, multiplier, true);
    return data;
  }

  it("sets the pending multiplier and its timestamp and leaves the current one", () => {
    const patched = withPendingMultiplier(mintWithScaledUi(1), 1.05, 1_790_000_000n);
    expect(readScaledUiAmount(patched)).toEqual({
      multiplier: 1,
      newMultiplier: 1.05,
      newMultiplierEffectiveTimestamp: 1_790_000_000n,
    });
  });

  it("rejects a mint without the extension", () => {
    expect(() => withPendingMultiplier(new Uint8Array(170), 1.05, 0n)).toThrow(/no ScaledUiAmount/);
  });
});

describe("cases", () => {
  it("registers every PRD 23.4 case once, P7 last", () => {
    expect(CASES.map((c) => c.module)).toEqual([
      "p1-positive",
      "p2-control",
      "p3-closed-market",
      "p4-harmful",
      "p4-real-market",
      "p5-stale-context",
      "p6-replay",
      "p8-breadth",
      "p7-ablations",
    ]);
    expect(caseByName("P1").module).toBe("p1-positive");
    expect(caseByName("p4-real-market").module).toBe("p4-real-market");
    expect(() => caseByName("P4")).toThrow(/ambiguous/);
  });

  it("passes a probe only when the observation is one it expected", () => {
    const source = { kind: "computed" as const, artifacts: [] };
    expect(
      probe({ name: "a", description: "", expected: ["x", "y"], observed: "y", source }).pass,
    ).toBe(true);
    expect(probe({ name: "a", description: "", expected: ["x"], observed: "z", source }).pass).toBe(
      false,
    );
  });
});
