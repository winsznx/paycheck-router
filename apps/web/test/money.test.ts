import { assetBySymbol } from "@paycheck-router/shared";
import { formatShares } from "@paycheck-router/ui/format";
import { describe, expect, it } from "vitest";
import { scaledShares, walletShares } from "../src/lib/money.ts";

/** OpenAI PreStocks' Scaled UI multiplier on Sep 25, 2026. */
const OPENAI_MULTIPLIER = "1.4861347";
const OPENAI = assetBySymbol("OpenAI");

describe("wallet shares (Scaled UI amount)", () => {
  it("scales OpenAI raw units by 1.4861347 / 1e9 exactly", () => {
    // #given 0.0247 raw OpenAI tokens (9 decimals)
    const raw = "24700000";
    // #when
    const ui = scaledShares(raw, OPENAI.decimals, OPENAI_MULTIPLIER);
    // #then raw × 1.4861347 / 1e9, with no float rounding
    expect(ui).toBe("0.0367075270900000");
  });

  it("prefers the API's exact sharesUi over local scaling", () => {
    // #given an API leg that already carries the wallet amount
    const leg = { mint: OPENAI.mint, sharesUi: "0.03670752709", uiMultiplier: OPENAI_MULTIPLIER };
    // #then
    expect(walletShares(leg, "24700000")).toBe("0.03670752709");
  });

  it("scales locally when only the multiplier is known", () => {
    // #given
    const leg = { mint: OPENAI.mint, sharesUi: null, uiMultiplier: OPENAI_MULTIPLIER };
    // #then the list view shows 0.0367, not the raw 0.0247
    expect(formatShares(walletShares(leg, "24700000") ?? "0", "en")).toBe("0.0367");
  });

  it("shows raw units when the mint has no multiplier", () => {
    // #given
    const leg = { mint: assetBySymbol("SPYx").mint, sharesUi: null, uiMultiplier: null };
    // #then
    expect(walletShares(leg, "41130000")).toBe("0.41130000");
  });

  it("has nothing to show before a leg executes", () => {
    expect(walletShares({ mint: OPENAI.mint }, null)).toBeNull();
  });
});
