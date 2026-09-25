import type { CaseDefinition } from "../lib/case.ts";
import { runPaycheck, setupRouter } from "../lib/paycheck.ts";
import { balancesProbe, expectLegs, firstAttemptProbe } from "../lib/probes.ts";

const USDC = 1_000_000n;
/** One hour, so the slice meets its expiry inside the session on the product's own backoff. */
const MAX_WAIT_SECS = 3_600;
const RETRY_MARGIN_MS = 3 * 60_000;

/**
 * PRD 23.4 P4 real market: OpenAI and Neuralink PreStocks trade far over their marks. The crank
 * retries on the product's PREMIUM_TOO_HIGH backoff (1, 2, 5, 10, 15, 30 min) against fresh
 * pool state and, if the premium persists, expires the slice with `expire_leg`.
 */
export const p4RealMarket: CaseDefinition = {
  module: "p4-real-market",
  caseId: "P4",
  title: "Real market",
  scenario:
    "A $200 paycheck, fully invested, split between OpenAI and Neuralink PreStocks with the " +
    "default 300 bps band and a one-hour maximum wait",
  expected: "OutputBelowMinimum; waits; expires if the premium persists",
  needsFork: true,
  async run(ctx) {
    const router = await setupRouter(ctx, {
      name: "demo-worker",
      legs: [
        { symbol: "OpenAI", weightBps: 5_000, bandBps: 300 },
        { symbol: "Neuralink", weightBps: 5_000, bandBps: 300 },
      ],
      investBps: 10_000,
      maxWaitSecs: MAX_WAIT_SECS,
    });
    const result = await runPaycheck(ctx, router, {
      label: "OpenAI+Neuralink paycheck",
      employer: "employer-1",
      employerSigner: ctx.signers["employer-1"],
      amount: 200n * USDC,
      retryUntilMs: Date.now() + MAX_WAIT_SECS * 1000 + RETRY_MARGIN_MS,
    });
    for (const outcome of result.legs) {
      firstAttemptProbe(
        ctx,
        result,
        outcome,
        ["wait:PREMIUM_TOO_HIGH"],
        "The first attempt meets OutputBelowMinimum and waits",
      );
    }
    expectLegs(
      ctx,
      result,
      ["OpenAI", "Neuralink"],
      ["leg:EXPIRED", "leg:VERIFIED"],
      "The slice expires if the premium persists, or fills in band and is Verified",
    );
    if (result.legs.every((l) => l.record.state === "EXPIRED")) {
      balancesProbe(
        ctx,
        result,
        200n * USDC,
        "Expired slices leave the USDC in the owner's wallet",
      );
    }
    const waits = result.legs.map(
      (l) => `${l.record.symbol}: ${l.record.attempts.length} attempts, ${l.record.state}`,
    );
    ctx.notes.push(`attempts: ${waits.join("; ")}`);
  },
};
