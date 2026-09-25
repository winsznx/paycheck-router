import { assetBySymbol, USDC_FEED_ID } from "@paycheck-router/shared";
import { describe, expect, it } from "vitest";
import { measureQuote } from "../../../src/engine/premium.ts";

// The OpenAI attempt in evidence/stocklana-fork: Jupiter quoted 46,536,649 raw for 92.315 USDC,
// the attested mark was $1,023.667475142, USDC/USD 0.99994461, Scaled UI multiplier 1.4861347.
const OPENAI_ATTEMPT = {
  parsed: [{ id: USDC_FEED_ID, price: { price: "99994461", expo: -8 } }],
  markPriceE9: 1_023_667_475_142n,
  quotedIn: 92_315_000n,
  quotedOut: 46_536_649n,
};

describe("measureQuote", () => {
  it("prices a waiting PreStocks attempt against its signed mark", () => {
    const measured = measureQuote(assetBySymbol("OpenAI"), OPENAI_ATTEMPT, 1_486_134_700_000n);
    expect(measured).toMatchObject({ source: "mark", refPriceE9: 1_023_667_475_142n });
    // About $1,334.7 per share against a $1,023.67 mark: the +30% premium the guard refuses.
    expect(measured?.premiumBps).toBe(3038);
  });

  it("uses the regular Pyth price for a listed equity, and 24/7 only when regular is absent", () => {
    const nvdax = assetBySymbol("NVDAx");
    const base = { markPriceE9: null, quotedIn: 100_000_000n, quotedOut: 55_000_000n };
    const regular = measureQuote(
      nvdax,
      {
        ...base,
        parsed: [
          { id: USDC_FEED_ID, price: { price: "100000000", expo: -8 } },
          { id: nvdax.feedId ?? "", price: { price: "18150000", expo: -5 } },
        ],
      },
      1_000_000_000_000n,
    );
    expect(regular).toMatchObject({ source: "pyth", refPriceE9: 181_500_000_000n });
    expect(regular?.premiumBps).toBe(17);
    const allDay = measureQuote(
      nvdax,
      {
        ...base,
        parsed: [
          { id: USDC_FEED_ID, price: { price: "100000000", expo: -8 } },
          { id: nvdax.feedId247 ?? "", price: { price: "18150000", expo: -5 } },
        ],
      },
      1_000_000_000_000n,
    );
    expect(allDay?.source).toBe("pyth247");
  });

  it("returns null without a quote, a reference or USDC/USD", () => {
    const openai = assetBySymbol("OpenAI");
    expect(measureQuote(openai, { ...OPENAI_ATTEMPT, quotedOut: null }, 1_000_000_000_000n)).toBe(
      null,
    );
    expect(measureQuote(openai, { ...OPENAI_ATTEMPT, markPriceE9: null }, 1_000_000_000_000n)).toBe(
      null,
    );
    expect(measureQuote(openai, { ...OPENAI_ATTEMPT, parsed: [] }, 1_000_000_000_000n)).toBe(null);
  });
});
