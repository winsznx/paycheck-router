import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buyMinOut,
  convertMinTarget,
  GuardMathError,
  multiplierToE12,
  sellMinUsdc,
} from "../src/index.ts";

/** Golden vectors the program's Rust tests also run: both sides must agree on every one. */
type Vector = {
  name: string;
  kind: "buy" | "sell" | "convert";
  inputs: Record<string, string>;
  expected: string | { error: "MathOverflow" };
};

const file = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "..", "..", "..", "tests", "vectors", "guard.json"),
    "utf8",
  ),
) as { version: number; vectors: Vector[] };

function input(vector: Vector, key: string): string {
  const value = vector.inputs[key];
  if (value === undefined) throw new Error(`${vector.name} has no ${key}`);
  return value;
}

function evaluate(vector: Vector): bigint {
  const int = (key: string) => BigInt(input(vector, key));
  const small = (key: string) => Number(input(vector, key));
  const multiplier = (key: string) => multiplierToE12(Number(input(vector, key)));
  switch (vector.kind) {
    case "buy":
      return buyMinOut({
        usdcIn: int("usdc_in"),
        usdcPriceE9: int("usdc_price_e9"),
        priceE9: int("price_e9"),
        bandBps: small("band_bps"),
        multiplierE12: multiplier("multiplier"),
        decimals: small("decimals"),
      });
    case "sell":
      return sellMinUsdc({
        sharesIn: int("amount_in"),
        usdcPriceE9: int("usdc_price_e9"),
        priceE9: int("price_e9"),
        bandBps: small("band_bps"),
        multiplierE12: multiplier("multiplier"),
        decimals: small("decimals"),
      });
    case "convert":
      return convertMinTarget({
        sharesIn: int("amount_in"),
        preMultiplierE12: multiplier("multiplier_pre"),
        preDecimals: small("decimals_pre"),
        ratioNum: int("ratio_num"),
        ratioDen: int("ratio_den"),
        bandBps: small("band_bps"),
        targetMultiplierE12: multiplier("multiplier_target"),
        targetDecimals: small("decimals_target"),
      });
  }
}

describe("golden vectors shared with the program", () => {
  it("reads version 1 with vectors of every kind", () => {
    expect(file.version).toBe(1);
    expect(new Set(file.vectors.map((v) => v.kind))).toEqual(new Set(["buy", "sell", "convert"]));
  });

  for (const vector of file.vectors) {
    it(`${vector.kind} ${vector.name}`, () => {
      if (typeof vector.expected === "string") {
        expect(evaluate(vector)).toBe(BigInt(vector.expected));
      } else {
        expect(() => evaluate(vector)).toThrow(GuardMathError);
      }
    });
  }
});
