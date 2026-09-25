import type { CaseDefinition } from "../lib/case.ts";
import { ephemeralWorker, runPaycheck, setupRouter } from "../lib/paycheck.ts";
import { deliveryProbe, expectLegs } from "../lib/probes.ts";

const USDC = 1_000_000n;

/** PRD 23.4 P1: a regular-session paycheck into a liquid asset executes, in band, Verified. */
export const p1Positive: CaseDefinition = {
  module: "p1-positive",
  caseId: "P1",
  title: "Positive",
  scenario:
    "Two $200 paychecks in the regular session, half invested: one router buys NVDAx " +
    "(xStocks, Pyth guard), the other Anthropic PreStocks (attested mark guard)",
  expected: "Executes; delivered at least the minimum; Verified",
  needsFork: true,
  async run(ctx) {
    const prestock = await setupRouter(ctx, {
      name: "demo-worker",
      legs: [{ symbol: "Anthropic", weightBps: 10_000, bandBps: 300 }],
      investBps: 5_000,
    });
    const xstock = await setupRouter(ctx, {
      name: "worker-xstock",
      owner: await ephemeralWorker(ctx, "worker-xstock"),
      legs: [{ symbol: "NVDAx", weightBps: 10_000, bandBps: 50 }],
      investBps: 5_000,
    });
    for (const [router, employer] of [
      [prestock, "employer-1"],
      [xstock, "employer-2"],
    ] as const) {
      const result = await runPaycheck(ctx, router, {
        label: `${router.legs.map((l) => l.symbol).join("+")} paycheck`,
        employer,
        employerSigner: ctx.signers[employer],
        amount: 200n * USDC,
      });
      expectLegs(
        ctx,
        result,
        router.legs.map((l) => l.symbol),
        ["leg:VERIFIED"],
        "The slice executes and is Verified",
      );
      for (const outcome of result.legs) deliveryProbe(ctx, result, outcome);
    }
  },
};
