import { WaitReason } from "@paycheck-router/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ForkPaycheck, forkWithPaycheck, legsOf, readPaycheck, runLegs } from "../helpers.ts";

const TWO_HOURS_MS = 2 * 3_600_000;

describe("a price older than the guard allows", () => {
  let fork: ForkPaycheck;

  beforeAll(async () => {
    fork = await forkWithPaycheck([{ symbol: "Anthropic", weightBps: 10_000, bandBps: 300 }]);
  });

  afterAll(async () => {
    await fork?.surfnet.stop();
  });

  it("parks the slice on MARKET_CLOSED once the chain clock runs two hours past Pyth", async () => {
    await fork.surfnet.cheat.timeTravelTo(Date.now() + TWO_HOURS_MS);
    // The attester signs at the chain's time, so only the Pyth price is stale.
    const run = await runLegs(fork, await legsOf(fork), {
      config: { now: () => Date.now() + TWO_HOURS_MS },
    });
    const attempts = run.legs[0]?.attempts ?? [];
    const last = attempts.at(-1);
    expect(last?.waitReason, last?.error ?? undefined).toBe(WaitReason.MARKET_CLOSED);
    expect(last?.failure?.kind === "program" && last.failure.error.name).toBe("PriceStale");
    expect(attempts.every((a) => a.signature === null)).toBe(true);
    expect((await readPaycheck(fork)).legs[0]?.status).toBe(0);
  });
});
