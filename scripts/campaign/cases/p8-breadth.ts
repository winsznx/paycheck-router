import { newMarkState } from "@paycheck-router/sdk";
import { PRESTOCKS, XSTOCKS } from "@paycheck-router/shared";
import type { CaseDefinition } from "../lib/case.ts";
import { ephemeralWorker, type LegSpec, runPaycheck, setupRouter } from "../lib/paycheck.ts";
import { deliveryProbe, expectLegs } from "../lib/probes.ts";

const USDC = 1_000_000n;
/** Waiting legs get the first retries of the product's backoff (1 and 2 min) inside the case. */
const RETRY_WINDOW_MS = 4 * 60_000;

function split(symbols: readonly string[], bandBps: number): LegSpec[] {
  const base = Math.floor(10_000 / symbols.length);
  return symbols.map((symbol, i) => ({
    symbol,
    weightBps: i === 0 ? 10_000 - base * (symbols.length - 1) : base,
    bandBps,
  }));
}

/** SpaceX is converting: its PreStocks token is conversion-only, so no router buys it. */
const BUYABLE_PRESTOCKS = PRESTOCKS.filter((a) => a.symbol !== "SpaceX").map((a) => a.symbol);
const XSTOCK_SYMBOLS = XSTOCKS.map((a) => a.symbol);

/** PRD 23.4 P8 as run on the fork (23.9): 16 names, 3 employers, $20 to $5,000. */
export const p8Breadth: CaseDefinition = {
  module: "p8-breadth",
  caseId: "P8",
  title: "Breadth",
  scenario:
    "9 xStocks and 7 PreStocks names (SpaceX excluded: conversion only) across three routers, " +
    "six paychecks from three employer wallets between $20 and $5,000, fully invested, regular " +
    "session only",
  expected:
    "Same guarantees across all: every fill in band and Verified, every other slice waits with a reason",
  needsFork: true,
  async run(ctx) {
    ctx.notes.push("SpaceX PreStocks is conversion-only (status converting) and is not bought");
    const xsA = await setupRouter(ctx, {
      name: "worker-xstocks-a",
      owner: await ephemeralWorker(ctx, "worker-xstocks-a"),
      legs: split(XSTOCK_SYMBOLS.slice(0, 5), 50),
      investBps: 10_000,
    });
    const xsB = await setupRouter(ctx, {
      name: "worker-xstocks-b",
      owner: await ephemeralWorker(ctx, "worker-xstocks-b"),
      legs: split(XSTOCK_SYMBOLS.slice(5), 50),
      investBps: 10_000,
    });
    const pre = await setupRouter(ctx, {
      name: "worker-prestocks",
      owner: await ephemeralWorker(ctx, "worker-prestocks"),
      legs: split(BUYABLE_PRESTOCKS, 300),
      investBps: 10_000,
    });
    const plan = [
      { router: pre, employer: "employer-2", usdc: 20n },
      { router: xsA, employer: "employer-1", usdc: 5_000n },
      { router: pre, employer: "employer-3", usdc: 2_500n },
      { router: xsB, employer: "employer-3", usdc: 1_000n },
      { router: xsA, employer: "employer-2", usdc: 250n },
      { router: xsB, employer: "employer-1", usdc: 20n },
    ] as const;
    const marks = newMarkState();
    for (const { router, employer, usdc } of plan) {
      const result = await runPaycheck(
        ctx,
        router,
        {
          label: `$${usdc} from ${employer} to ${router.name}`,
          employer,
          employerSigner: ctx.signers[employer],
          amount: usdc * USDC,
          retryUntilMs: Date.now() + RETRY_WINDOW_MS,
        },
        marks,
      );
      expectLegs(
        ctx,
        result,
        router.legs.map((l) => l.symbol),
        ["leg:VERIFIED", "leg:WAITING:PREMIUM_TOO_HIGH"],
        "The slice fills in band and is Verified, or waits because the fill would be over the band",
      );
      for (const outcome of result.legs) deliveryProbe(ctx, result, outcome);
    }
  },
};
