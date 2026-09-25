import { describe, expect, it } from "vitest";
import {
  buyMinOut,
  buyPremiumBps,
  confidenceWithin,
  convertMinTarget,
  effectiveMultiplier,
  GuardMathError,
  legFee,
  multiplierToE12,
  pythPriceToE9,
  sellMinUsdc,
  U64_MAX,
  usdcWithinPeg,
} from "../src/index.ts";

/** Exact rational arithmetic, used to evaluate the formulas literally as written. */
class Q {
  constructor(
    readonly n: bigint,
    readonly d: bigint = 1n,
  ) {}
  static of(value: bigint | number, scale = 1n): Q {
    return new Q(BigInt(value), scale);
  }
  mul(o: Q): Q {
    return new Q(this.n * o.n, this.d * o.d);
  }
  div(o: Q): Q {
    return new Q(this.n * o.d, this.d * o.n);
  }
  add(o: Q): Q {
    return new Q(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o: Q): Q {
    return this.add(new Q(-o.n, o.d));
  }
  floor(): bigint {
    return this.n / this.d;
  }
}

const one = Q.of(1);
const e9 = 1_000_000_000n;
const e12 = 1_000_000_000_000n;

function literalBuy(U: bigint, uE9: bigint, pE9: bigint, b: number, mE12: bigint, d: number) {
  const numerator = Q.of(U)
    .mul(Q.of(uE9, e9))
    .mul(Q.of(10n ** BigInt(d)));
  const denominator = Q.of(1_000_000n)
    .mul(Q.of(pE9, e9))
    .mul(one.add(Q.of(b, 10_000n)))
    .mul(Q.of(mE12, e12));
  return numerator.div(denominator).floor();
}

function literalSell(S: bigint, uE9: bigint, pE9: bigint, b: number, mE12: bigint, d: number) {
  const numerator = Q.of(S)
    .mul(Q.of(mE12, e12))
    .mul(Q.of(pE9, e9))
    .mul(one.sub(Q.of(b, 10_000n)))
    .mul(Q.of(1_000_000n));
  return numerator.div(Q.of(10n ** BigInt(d)).mul(Q.of(uE9, e9))).floor();
}

function literalConvert(
  S: bigint,
  mPre: bigint,
  dPre: number,
  num: bigint,
  den: bigint,
  b: number,
  mT: bigint,
  dT: number,
) {
  return Q.of(S)
    .mul(Q.of(mPre, e12))
    .div(Q.of(10n ** BigInt(dPre)))
    .mul(new Q(num, den))
    .mul(one.sub(Q.of(b, 10_000n)))
    .mul(Q.of(10n ** BigInt(dT)).div(Q.of(mT, e12)))
    .floor();
}

/** Deterministic xorshift so failures reproduce. */
function rng(seed: bigint) {
  let state = seed;
  return (bound: bigint): bigint => {
    state ^= (state << 13n) & U64_MAX;
    state ^= state >> 7n;
    state ^= (state << 17n) & U64_MAX;
    return state % bound;
  };
}

describe("buyMinOut", () => {
  it("prices 100 USDC of a $180 share at a 50 bps band", () => {
    expect(
      buyMinOut({
        usdcIn: 100_000_000n,
        usdcPriceE9: e9,
        priceE9: 180n * e9,
        bandBps: 50,
        multiplierE12: e12,
        decimals: 8,
      }),
    ).toBe(55_279_159n);
  });

  it("divides by the Scaled UI multiplier and USDC below peg", () => {
    expect(
      buyMinOut({
        usdcIn: 250_000_000n,
        usdcPriceE9: 999_870_000n,
        priceE9: 182_123_450_000n,
        bandBps: 50,
        multiplierE12: 1_003_909_240_011n,
        decimals: 8,
      }),
    ).toBe(136_037_037n);
  });

  it("handles the 5,000 USDC leg cap at the widest equity band", () => {
    expect(
      buyMinOut({
        usdcIn: 5_000_000_000n,
        usdcPriceE9: 1_000_132_000n,
        priceE9: 657_123_000_000n,
        bandBps: 300,
        multiplierE12: 1_002_725_029_655n,
        decimals: 8,
      }),
    ).toBe(736_820_293n);
  });

  it("matches the formula evaluated literally over random inputs", () => {
    const next = rng(0x9e3779b97f4a7c15n);
    for (let i = 0; i < 2_000; i++) {
      const U = 1_000_000n + next(10_000_000_000n);
      const uE9 = 990_000_000n + next(20_000_000n);
      const pE9 = 1_000_000n + next(5_000_000_000_000n);
      const b = Number(next(1_001n));
      const mE12 = 500_000_000_000n + next(5_000_000_000_000n);
      const d = Number(next(10n));
      const got = buyMinOut({
        usdcIn: U,
        usdcPriceE9: uE9,
        priceE9: pE9,
        bandBps: b,
        multiplierE12: mE12,
        decimals: d,
      });
      expect(got).toBe(literalBuy(U, uE9, pE9, b, mE12, d));
    }
  });

  it("never grows as the band widens", () => {
    let previous = U64_MAX;
    for (const bandBps of [0, 10, 50, 100, 300, 1_000]) {
      const minOut = buyMinOut({
        usdcIn: 1_234_567_890n,
        usdcPriceE9: e9,
        priceE9: 431_990_000_000n,
        bandBps,
        multiplierE12: e12,
        decimals: 8,
      });
      expect(minOut <= previous).toBe(true);
      previous = minOut;
    }
  });

  it("reports MathOverflow when the product leaves u128", () => {
    expect(() =>
      buyMinOut({
        usdcIn: U64_MAX,
        usdcPriceE9: e9,
        priceE9: e9,
        bandBps: 0,
        multiplierE12: e12,
        decimals: 8,
      }),
    ).toThrow(GuardMathError);
  });

  it("reports MathOverflow on a zero price or multiplier", () => {
    const base = {
      usdcIn: 1_000_000n,
      usdcPriceE9: e9,
      priceE9: e9,
      bandBps: 0,
      multiplierE12: e12,
      decimals: 8,
    };
    expect(() => buyMinOut({ ...base, priceE9: 0n })).toThrow(/MathOverflow/);
    expect(() => buyMinOut({ ...base, multiplierE12: 0n })).toThrow(/MathOverflow/);
  });

  it("rejects inputs outside their onchain types", () => {
    const base = {
      usdcIn: 1_000_000n,
      usdcPriceE9: e9,
      priceE9: e9,
      bandBps: 0,
      multiplierE12: e12,
      decimals: 8,
    };
    expect(() => buyMinOut({ ...base, usdcIn: -1n })).toThrow(RangeError);
    expect(() => buyMinOut({ ...base, usdcIn: U64_MAX + 1n })).toThrow(RangeError);
    expect(() => buyMinOut({ ...base, bandBps: 70_000 })).toThrow(RangeError);
    expect(() => buyMinOut({ ...base, decimals: 1.5 })).toThrow(RangeError);
  });
});

describe("sellMinUsdc", () => {
  it("prices one $180 share at a 50 bps band", () => {
    expect(
      sellMinUsdc({
        sharesIn: 100_000_000n,
        usdcPriceE9: e9,
        priceE9: 180n * e9,
        bandBps: 50,
        multiplierE12: e12,
        decimals: 8,
      }),
    ).toBe(179_100_000n);
  });

  it("matches the formula evaluated literally over random inputs", () => {
    const next = rng(0x2545f4914f6cdd1dn);
    for (let i = 0; i < 2_000; i++) {
      const S = 1n + next(10_000_000_000n);
      const uE9 = 990_000_000n + next(20_000_000n);
      const pE9 = 1_000_000n + next(1_000_000_000_000n);
      const b = Number(next(1_001n));
      const mE12 = 500_000_000_000n + next(1_500_000_000_000n);
      const d = Number(next(10n));
      const got = sellMinUsdc({
        sharesIn: S,
        usdcPriceE9: uE9,
        priceE9: pE9,
        bandBps: b,
        multiplierE12: mE12,
        decimals: d,
      });
      expect(got).toBe(literalSell(S, uE9, pE9, b, mE12, d));
    }
  });

  it("rejects a band of 100% or more", () => {
    expect(() =>
      sellMinUsdc({
        sharesIn: 1n,
        usdcPriceE9: e9,
        priceE9: e9,
        bandBps: 10_000,
        multiplierE12: e12,
        decimals: 8,
      }),
    ).toThrow(RangeError);
  });
});

describe("convertMinTarget", () => {
  it("converts one pre-IPO token with a 5x multiplier at 5:1 and a 300 bps band", () => {
    expect(
      convertMinTarget({
        sharesIn: 1_000_000_000n,
        preMultiplierE12: 5n * e12,
        preDecimals: 9,
        ratioNum: 5n,
        ratioDen: 1n,
        bandBps: 300,
        targetMultiplierE12: e12,
        targetDecimals: 8,
      }),
    ).toBe(2_425_000_000n);
  });

  it("matches the formula evaluated literally over random inputs", () => {
    const next = rng(0xda3e39cb94b95bdbn);
    for (let i = 0; i < 2_000; i++) {
      const S = 1n + next(100_000_000_000n);
      const mPre = 500_000_000_000n + next(5_000_000_000_000n);
      const dPre = Number(next(10n));
      const num = 1n + next(10n);
      const den = 1n + next(10n);
      const b = Number(next(1_001n));
      const mT = 500_000_000_000n + next(5_000_000_000_000n);
      const dT = Number(next(10n));
      const got = convertMinTarget({
        sharesIn: S,
        preMultiplierE12: mPre,
        preDecimals: dPre,
        ratioNum: num,
        ratioDen: den,
        bandBps: b,
        targetMultiplierE12: mT,
        targetDecimals: dT,
      });
      expect(got).toBe(literalConvert(S, mPre, dPre, num, den, b, mT, dT));
    }
  });

  it("reports MathOverflow on a zero ratio denominator", () => {
    expect(() =>
      convertMinTarget({
        sharesIn: 1n,
        preMultiplierE12: e12,
        preDecimals: 9,
        ratioNum: 1n,
        ratioDen: 0n,
        bandBps: 0,
        targetMultiplierE12: e12,
        targetDecimals: 8,
      }),
    ).toThrow(GuardMathError);
  });
});

describe("helpers", () => {
  it("floors the fee", () => {
    expect(legFee(1_000_000n, 20)).toBe(2_000n);
    expect(legFee(999n, 20)).toBe(1n);
    expect(legFee(49n, 20)).toBe(0n);
  });

  it("scales Pyth prices to 1e9", () => {
    expect(pythPriceToE9(18_212_345n, -5)).toBe(182_123_450_000n);
    expect(pythPriceToE9(99_987_000n, -8)).toBe(999_870_000n);
    expect(pythPriceToE9(123_456_789_012n, -11)).toBe(1_234_567_890n);
    expect(() => pythPriceToE9(-1n, -8)).toThrow(RangeError);
  });

  it("truncates the multiplier to 1e12 like a Rust cast", () => {
    expect(multiplierToE12(1)).toBe(e12);
    expect(multiplierToE12(1.003909240011759)).toBe(1_003_909_240_011n);
    expect(multiplierToE12(1.4861347)).toBe(1_486_134_700_000n);
    expect(() => multiplierToE12(0)).toThrow(RangeError);
    expect(() => multiplierToE12(Number.NaN)).toThrow(RangeError);
  });

  it("switches to the new multiplier once its timestamp passes", () => {
    const config = {
      multiplier: 1.0027,
      newMultiplier: 1.0034,
      newMultiplierEffectiveTimestamp: 1_789_858_800n,
    };
    expect(effectiveMultiplier(config, 1_789_858_799n)).toBe(1.0027);
    expect(effectiveMultiplier(config, 1_789_858_800n)).toBe(1.0034);
    expect(effectiveMultiplier(null, 0n)).toBe(1);
  });

  it("checks confidence and the USDC peg in basis points", () => {
    expect(confidenceWithin(18_000_000n, 90_000n, 50)).toBe(true);
    expect(confidenceWithin(18_000_000n, 90_001n, 50)).toBe(false);
    expect(confidenceWithin(0n, 0n, 50)).toBe(false);
    expect(usdcWithinPeg(995_000_000n, 50)).toBe(true);
    expect(usdcWithinPeg(994_999_999n, 50)).toBe(false);
    expect(usdcWithinPeg(1_005_000_000n, 50)).toBe(true);
    expect(usdcWithinPeg(1_005_000_001n, 50)).toBe(false);
  });

  it("measures the premium of a fill over the reference", () => {
    const atReference = {
      usdcIn: 180_000_000n,
      sharesOut: 100_000_000n,
      usdcPriceE9: e9,
      priceE9: 180n * e9,
      multiplierE12: e12,
      decimals: 8,
    };
    expect(buyPremiumBps(atReference)).toBe(0n);
    expect(buyPremiumBps({ ...atReference, usdcIn: 234_000_000n })).toBe(3_000n);
    expect(buyPremiumBps({ ...atReference, usdcIn: 178_200_000n })).toBe(-100n);
  });
});
