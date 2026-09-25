/**
 * `evidence/campaign/summary.json`, built only from raw artifacts through `slices.ts` and the P7
 * bundle's Ethereum reads. The same function rebuilds it in `pnpm verify:campaign`, so the file
 * holds nothing that a run's artifacts cannot reproduce: no timestamps of its own, no estimates.
 */
import { resolve } from "node:path";
import { BPS } from "@paycheck-router/guard-math";
import { FORK_KEYS } from "@paycheck-router/shared";
import { type ChainIndex, chainCosts, chainIndexRef } from "./ethereum.ts";
import { median, per100 } from "./metrics.ts";
import {
  type CaseRun,
  INFRASTRUCTURE_FAILURE,
  loadCampaign,
  readArtifactJson,
  type Slice,
  slicesOf,
} from "./slices.ts";

/** Cases whose fills ran on unmodified fork state through the product's own crank. */
export const HEADLINE_MODULES = [
  "p1-positive",
  "p4-harmful",
  "p4-real-market",
  "p6-replay",
  "p8-breadth",
] as const;

export const PUBLISHED_FEES = {
  cexLuno: {
    bps: 200,
    source: "Luno Nigeria published 2% per trade fee, as registered in PRD 23.2",
  },
  jupiterRecurring: {
    bps: 10,
    source: 'https://developers.jup.ag/docs/recurring (FAQ: "Recurring API takes 0.1% as fees.")',
  },
} as const;

/**
 * Scripted step counts per payday (not timed with testers). A = CEX: deposit, then one buy per
 * asset. B = manual Jupiter: open wallet, connect, then choose asset, enter amount, review and
 * sign per asset. C = Jupiter Recurring: one deposit into the recurring order.
 */
export function scriptedSteps(assets: number) {
  return {
    cex: { steps: 1 + assets, script: ["deposit USDC", ...Array(assets).fill("buy one asset")] },
    manualJupiter: {
      steps: 2 + 4 * assets,
      script: ["open wallet", "connect to jup.ag", "per asset: choose, enter amount, review, sign"],
    },
    jupiterRecurring: { steps: 1, script: ["deposit the paycheck into the recurring order"] },
  };
}

const str = (v: bigint) => v.toString();

function caseStatus(run: CaseRun): "pass" | "fail" | "blocked" | "infrastructure" {
  const m = run.manifest;
  if (m.observed.pass) return "pass";
  const failing = m.probes.filter((p) => !p.pass);
  if (m.error && INFRASTRUCTURE_FAILURE.test(m.error)) return "infrastructure";
  if (
    failing.length > 0 &&
    failing.every((p) => /PRICE_UNAVAILABLE|hermes:refused/.test(p.observed))
  ) {
    return "blocked";
  }
  if (failing.length > 0 && failing.every((p) => INFRASTRUCTURE_FAILURE.test(p.observed))) {
    return "infrastructure";
  }
  return "fail";
}

type TxView = {
  result: {
    transaction: { message: { accountKeys: { pubkey: string; signer: boolean }[] } };
  } | null;
};

/** Owner-signed transactions after setup, per recorded paycheck of the headline cases. */
function manualSteps(runs: readonly CaseRun[]) {
  let paychecks = 0;
  let ownerSigned = 0;
  for (const run of runs) {
    if (!(HEADLINE_MODULES as readonly string[]).includes(run.manifest.module)) continue;
    for (const pc of run.paychecks) {
      if (!pc.manifest.paycheck || !pc.manifest.router) continue;
      paychecks++;
      const owner = pc.manifest.router.owner;
      for (const tx of pc.manifest.transactions) {
        if (!tx.raw) continue;
        const view = readArtifactJson<TxView>(pc.dir, tx.raw);
        const keys = view.result?.transaction.message.accountKeys ?? [];
        if (keys.some((k) => k.pubkey === owner && k.signer)) ownerSigned++;
      }
    }
  }
  return { paychecks, ownerSigned };
}

/** Final state of every headline slice, with stops split by cause. */
function tally(slices: readonly Slice[]) {
  const count = (values: string[]) =>
    Object.fromEntries(
      [...new Set(values)].sort().map((v) => [v, values.filter((x) => x === v).length]),
    );
  const cause = (failure: string) =>
    failure.startsWith("program:") ? failure : (failure.split(":")[0] ?? failure);
  return {
    environment: "fork" as const,
    slices: slices.length,
    executed: slices.filter((s) => s.executed).length,
    verified: slices.filter((s) => s.executed?.verified).length,
    waiting: count(slices.filter((s) => s.state === "WAITING").map((s) => s.waitReason ?? "none")),
    expired: slices.filter((s) => s.state === "EXPIRED").length,
    stopped: count(slices.flatMap((s) => (s.failure ? [cause(s.failure)] : []))),
    stoppedDetail: slices.flatMap((s) =>
      s.failure ? [{ slice: sliceKey(s), failure: s.failure }] : [],
    ),
  };
}

function sliceKey(s: Slice): string {
  return `${s.module}/${s.runId}/${s.paycheck}/${s.legIndex}`;
}

export function buildSummary(root: string) {
  const runs = loadCampaign(root);
  const slices = slicesOf(runs);
  const headline = slices.filter((s) => (HEADLINE_MODULES as readonly string[]).includes(s.module));
  const executed = slices.filter((s) => s.executed);
  const headlineExecuted = headline.filter((s) => s.executed);
  const costs = headlineExecuted.map((s) => s.executed?.cost.allInCostBps ?? 0);
  const byKind = (kind: Slice["kind"]) => {
    const values = headlineExecuted
      .filter((s) => s.kind === kind)
      .map((s) => s.executed?.cost.allInCostBps ?? 0);
    return { medianBps: median(values), medianPer100Usd: per100(median(values)), n: values.length };
  };
  const component = (pick: (s: NonNullable<Slice["executed"]>) => number) =>
    median(headlineExecuted.map((s) => pick(s.executed as NonNullable<Slice["executed"]>)));

  const waitedThenFilled = headline.filter(
    (s) =>
      s.executed &&
      s.firstAttempt?.outcome === "waiting" &&
      s.firstAttempt.waitReason === "PREMIUM_TOO_HIGH" &&
      s.firstAttempt.quote,
  );
  const avoided = waitedThenFilled.map((s) => {
    const quote = s.firstAttempt?.quote as { inAmount: bigint; outAmount: bigint };
    const fill = s.executed as NonNullable<Slice["executed"]>;
    const shares = fill.grossOut;
    const firstCost = (quote.inAmount * shares) / quote.outAmount;
    return {
      slice: sliceKey(s),
      symbol: s.symbol,
      overpaymentAvoidedUsdc: str(firstCost - fill.swappedIn),
    };
  });
  const expired = headline.filter((s) => s.state === "EXPIRED" && s.firstAttempt?.versusReference);
  const expiredAvoided = expired.map((s) => ({
    slice: sliceKey(s),
    symbol: s.symbol,
    firstAttemptPremiumBps: s.firstAttempt?.versusReference?.premiumBps ?? null,
    premiumAvoidedUsdc: str(s.firstAttempt?.versusReference?.overpaymentUsdc ?? 0n),
  }));
  const steps = manualSteps(runs);

  const quoted = headline.filter((s) => s.firstAttempt?.versusReference && s.firstAttempt.quote);
  const armD = quoted.map((s) => {
    const first = s.firstAttempt as NonNullable<Slice["firstAttempt"]>;
    const naive = first.versusReference as NonNullable<typeof first.versusReference>;
    const guardFill = s.executed ? s.executed.cost.premiumBps : null;
    const prevented =
      first.outcome === "waiting" && first.waitReason === "PREMIUM_TOO_HIGH"
        ? naive.overpaymentUsdc
        : 0n;
    return {
      slice: sliceKey(s),
      symbol: s.symbol,
      bandBps: s.bandBps,
      naivePremiumBps: naive.premiumBps,
      naiveOverpaymentUsdc: str(naive.overpaymentUsdc),
      guardFirstAttempt: first.waitReason ? `wait:${first.waitReason}` : first.outcome,
      guardFillPremiumBps: guardFill,
      overpaymentPreventedUsdc: str(prevented),
    };
  });
  const outOfBand = armD.filter((row) => row.naivePremiumBps > row.bandBps);

  const baselineRows = quoted.map((s) => {
    const first = s.firstAttempt as NonNullable<Slice["firstAttempt"]>;
    const premium = (first.versusReference as NonNullable<typeof first.versusReference>).premiumBps;
    return {
      slice: sliceKey(s),
      symbol: s.symbol,
      at: first.at,
      amountIn: str(s.amountIn),
      cexBps: PUBLISHED_FEES.cexLuno.bps,
      manualJupiterBps: premium + first.issuerFeeBps,
      jupiterRecurringBps: PUBLISHED_FEES.jupiterRecurring.bps + premium + first.issuerFeeBps,
      productBps: s.executed ? s.executed.cost.allInCostBps : null,
    };
  });
  const recorded = runs.flatMap((r) => r.paychecks.filter((p) => p.manifest.paycheck));
  const legsPerPayday = recorded.map((p) => p.manifest.legs.length);
  const typicalLegs = median(legsPerPayday) ?? 0;

  const p7 = runs.filter((r) => r.manifest.module === "p7-ablations");
  const chainRuns = p7.flatMap((r) => {
    const ref = chainIndexRef(r.manifest);
    if (!ref) return [];
    const index = readArtifactJson<ChainIndex>(r.dir, ref);
    return [{ runId: r.manifest.runId, ...chainCosts(r.dir, r.manifest.artifacts, index) }];
  });

  const medianCost = median(costs);
  const costRule =
    medianCost === null
      ? "not_evaluated"
      : medianCost <= 50
        ? "pass"
        : medianCost > 100
          ? "fail"
          : "inconclusive";
  const verified = executed.filter((s) => s.executed?.verified).length;
  const guardRule = avoided.length > 0 ? "pass" : "fail";
  const integrityRule =
    executed.length === 0 ? "not_evaluated" : verified === executed.length ? "pass" : "fail";

  return {
    schemaVersion: 1,
    environment: "fork" as const,
    label: "Surfpool fork of Solana mainnet, US regular session, Sep 25, 2026. Not mainnet.",
    runs: runs.map((r) => ({
      module: r.manifest.module,
      caseId: r.manifest.caseId,
      runId: r.manifest.runId,
      startSlot: r.manifest.fork?.startSlot ?? null,
      programSha256: r.manifest.programSha256,
      programExecutableHash: r.manifest.programExecutableHash,
    })),
    cases: runs.map((r) => ({
      caseId: r.manifest.caseId,
      module: r.manifest.module,
      runId: r.manifest.runId,
      environment: "fork" as const,
      title: r.manifest.title,
      forkStartSlot: r.manifest.fork?.startSlot ?? null,
      programSha256: r.manifest.programSha256,
      programSource: r.manifest.programSource,
      expected: r.manifest.expected,
      observed: r.manifest.observed.outcome,
      status: caseStatus(r),
      probes: {
        total: r.manifest.probes.length,
        passed: r.manifest.probes.filter((p) => p.pass).length,
      },
      error: r.manifest.error ? r.manifest.error.split("\n")[0] : null,
    })),
    outcomes: tally(headline),
    population: {
      headlineModules: [...HEADLINE_MODULES],
      note:
        "Headline cost uses fills on unmodified fork state from the product crank. P5 fills trade " +
        "against a cheatcode-modified mint and P3 moves the clock, so both are left out; every " +
        "executed slice still counts toward the verified rate.",
      slices: slices.length,
      headlineSlices: headline.length,
    },
    metrics: {
      allInCostPer100: {
        environment: "fork" as const,
        definition:
          "Per executed slice: USDC in (protocol fee included) against the reference value of the " +
          "shares the owner kept (issuer transfer fee excluded from shares), per $100",
        medianBps: medianCost,
        medianPer100Usd: per100(medianCost),
        n: costs.length,
        components: {
          protocolFeeBpsMedian: component((e) => e.cost.protocolFeeBps),
          issuerFeeBpsMedian: component((e) => e.cost.issuerFeeBps),
          premiumBpsMedian: component((e) => e.cost.premiumBps),
        },
        byKind: { listedEquity: byKind("listed_equity"), preIpo: byKind("pre_ipo") },
        provenance:
          "LegExecuted decoded from each fill's getTransaction logs; guard-math buyPremiumBps",
      },
      verifiedRate: {
        environment: "fork" as const,
        verified,
        executed: executed.length,
        rate: executed.length ? verified / executed.length : null,
        provenance: "Fork verifier: surfnet readback and Hermes history per slice",
      },
      overpaymentAvoided: {
        environment: "fork" as const,
        n: avoided.length,
        totalUsdc: str(avoided.reduce((sum, a) => sum + BigInt(a.overpaymentAvoidedUsdc), 0n)),
        slices: avoided,
        definition:
          "(price at first attempt - executed price) x shares, for slices that waited and later filled",
      },
      expiredAvoidedPremium: {
        environment: "fork" as const,
        n: expiredAvoided.length,
        totalUsdc: str(expiredAvoided.reduce((sum, a) => sum + BigInt(a.premiumAvoidedUsdc), 0n)),
        slices: expiredAvoided,
        note: "Reported separately; never counted as savings",
      },
      manualStepsPerPayday: {
        environment: "fork" as const,
        value: steps.paychecks ? steps.ownerSigned / steps.paychecks : null,
        ownerSignedTransactionsAfterSetup: steps.ownerSigned,
        paychecks: steps.paychecks,
        provenance: "Signer flags in every stored transaction after setup",
      },
      networkCost: {
        environment: "fork" as const,
        note: "Execute-transaction fees the crank pays; borne by the protocol, not in all-in cost",
        medianLamportsPerSlice: median(
          headlineExecuted.flatMap((s) =>
            s.executed?.networkFeeLamports == null ? [] : [s.executed.networkFeeLamports],
          ),
        ),
        n: headlineExecuted.filter((s) => s.executed?.networkFeeLamports != null).length,
      },
      speed: {
        environment: "fork" as const,
        claimed: false,
        reason: "A fork has no network contention (PRD 23.9)",
      },
    },
    baselines: {
      environment: "fork" as const,
      note: "Computed at the product arm's first-attempt timestamps and amounts, not executed",
      medians: {
        cexBps: median(baselineRows.map((r) => r.cexBps)),
        manualJupiterBps: median(baselineRows.map((r) => r.manualJupiterBps)),
        jupiterRecurringBps: median(baselineRows.map((r) => r.jupiterRecurringBps)),
        productBps: medianCost,
      },
      n: baselineRows.length,
      stepsPerPayday: {
        product: steps.paychecks ? steps.ownerSigned / steps.paychecks : null,
        typicalLegs,
        ...scriptedSteps(typicalLegs),
      },
      fees: PUBLISHED_FEES,
      rows: baselineRows,
    },
    ablations: {
      guard: {
        environment: "fork" as const,
        label: "Arm D, replayed from the recorded first-attempt quotes, not executed",
        n: armD.length,
        overpaymentPreventedUsdc: str(
          armD.reduce((sum, r) => sum + BigInt(r.overpaymentPreventedUsdc), 0n),
        ),
        rows: armD,
      },
      oracle: {
        environment: "fork" as const,
        label: "Jupiter's own quote as the only reference, replayed, not executed",
        wouldExecuteOutOfBand: outOfBand.length,
        n: armD.length,
        slices: outOfBand.map((r) => r.slice),
      },
      chain: {
        environment: "computed" as const,
        label: "Computed, not executed: Ethereum mainnet gas at the same timestamps",
        runs: chainRuns,
      },
    },
    decisionRules: [
      {
        claim: "cost",
        rule: "Median all-in cost per $100 <= $0.50 passes; above $1.00 withdraws the claim",
        value: per100(medianCost),
        n: costs.length,
        outcome: costRule,
      },
      {
        claim: "guard",
        rule: "At least one slice waited and later filled in band with measured overpayment avoided",
        value: avoided.length,
        outcome: guardRule,
        consequence:
          guardRule === "pass"
            ? null
            : "Describe the guard only as protection, with the live PreStocks premium as its evidence",
      },
      {
        claim: "integrity",
        rule: "100% of executed slices Verified",
        value: executed.length ? `${verified}/${executed.length}` : null,
        outcome: integrityRule,
      },
      { claim: "speed", rule: "Not evaluated on a fork", value: null, outcome: "not_evaluated" },
    ],
    keys: FORK_KEYS,
    bpsDenominator: Number(BPS),
  };
}

export type Summary = ReturnType<typeof buildSummary>;

export function summaryPath(root: string): string {
  return resolve(root, "summary.json");
}
