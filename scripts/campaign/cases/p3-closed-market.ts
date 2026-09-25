import { toJson } from "../../lib/bundle.ts";
import { type CaseDefinition, requireFork } from "../lib/case.ts";
import { ephemeralWorker, runPaycheck, setupRouter } from "../lib/paycheck.ts";
import { expectLegs } from "../lib/probes.ts";

const USDC = 1_000_000n;
/** Fri Sep 25, 22:00 ET: the regular session closed six hours earlier. */
const OVERNIGHT_MS = Date.parse("2026-09-26T02:00:00Z");
/** Sat Sep 26, 12:00 ET: no regular session, and SPY has no 24/7 feed. */
const WEEKEND_MS = Date.parse("2026-09-26T16:00:00Z");

/**
 * PRD 23.4 P3 as adapted in 23.9: the clock moves to the night and the weekend with
 * `surfnet_timeTravel` after the paycheck is recorded. Hermes can only serve prices published
 * up to now, so the posted price is hours older than the moved clock and the leg waits.
 */
export const p3ClosedMarket: CaseDefinition = {
  module: "p3-closed-market",
  caseId: "P3",
  title: "Insufficient evidence",
  scenario:
    "NVDAx slice with the clock at Fri 22:00 ET (it has a 24/7 feed), then SPYx slice with the " +
    "clock at Sat 12:00 ET (no 24/7 feed), both moved by surfnet_timeTravel",
  expected: "PriceStale; waits for the open (the next-open fill is shown only on mainnet)",
  needsFork: true,
  async run(ctx) {
    const fork = requireFork(ctx);
    for (const [symbol, at, label] of [
      ["NVDAx", OVERNIGHT_MS, "overnight"],
      ["SPYx", WEEKEND_MS, "weekend"],
    ] as const) {
      const router = await setupRouter(ctx, {
        name: `worker-${symbol}`,
        owner: await ephemeralWorker(ctx, `worker-${symbol}`),
        legs: [{ symbol, weightBps: 10_000, bandBps: 50 }],
        investBps: 5_000,
      });
      const result = await runPaycheck(ctx, router, {
        label: `${symbol} ${label}`,
        employer: "employer-1",
        employerSigner: ctx.signers["employer-1"],
        amount: 200n * USDC,
        beforeExecute: async () => {
          const moved = await fork.surfnet.cheat.timeTravelTo(at);
          ctx.bundle.write(
            `raw/time-travel/${label}.json`,
            toJson({ absoluteTimestampMs: at, iso: new Date(at).toISOString(), response: moved }),
          );
          ctx.log(`clock moved to ${new Date(at).toISOString()}`);
        },
      });
      expectLegs(
        ctx,
        result,
        [symbol],
        ["leg:WAITING:MARKET_CLOSED"],
        "The posted price is stale against the moved clock: PriceStale, wait for the open",
      );
    }
  },
};
