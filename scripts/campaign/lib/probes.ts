import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyFailure } from "@paycheck-router/sdk";
import type { ArtifactRef, LegRecord } from "@paycheck-router/shared";
import type { Address } from "@solana/kit";
import type { CaseContext } from "./case.ts";
import { type Probe, probe } from "./manifest.ts";
import type { LegOutcome, PaycheckResult } from "./paycheck.ts";
import type { ProbeRun } from "./test-crank.ts";

/** A paycheck-bundle artifact as a path relative to the case bundle. */
export function caseRef(result: PaycheckResult, ref: ArtifactRef): ArtifactRef {
  return { path: `${result.subdir}/${ref.path}`, sha256: ref.sha256 };
}

/** `VERIFIED`, `WAITING:PREMIUM_TOO_HIGH`, `EXPIRED`, ... */
export function legState(record: LegRecord): string {
  if (record.state === "WAITING" || record.state === "EXPIRED") {
    return record.waitReason && record.state === "WAITING"
      ? `leg:WAITING:${record.waitReason}`
      : `leg:${record.state}`;
  }
  return `leg:${record.state}`;
}

export function legProbe(
  ctx: CaseContext,
  result: PaycheckResult,
  outcome: LegOutcome,
  expected: string[],
  description: string,
): Probe {
  const p = probe({
    name: `${result.entry.label} / ${outcome.record.symbol}`,
    description,
    expected,
    observed: legState(outcome.record),
    source: { kind: "leg", bundle: result.entry.bundle.path, legIndex: outcome.record.index },
    signature: outcome.record.executed?.signature ?? null,
  });
  ctx.probes.push(p);
  return p;
}

/**
 * One probe per leg the router configures. A leg that never ran (the paycheck stopped before
 * the pipeline, e.g. Hermes refused the feed) still gets a probe, observed as the stop reason.
 */
export function expectLegs(
  ctx: CaseContext,
  result: PaycheckResult,
  symbols: readonly string[],
  expected: string[],
  description: string,
): void {
  for (const symbol of symbols) {
    const outcome = result.legs.find((l) => l.record.symbol === symbol);
    if (outcome) {
      legProbe(ctx, result, outcome, expected, description);
      continue;
    }
    const refused = result.bundle.artifacts.find((a) => a.path === "raw/hermes/refused.json");
    ctx.probes.push(
      probe({
        name: `${result.entry.label} / ${symbol}`,
        description,
        expected,
        observed: refused
          ? `hermes:refused`
          : `paycheck:${result.entry.error ?? result.entry.classification ?? "not run"}`,
        source: refused
          ? { kind: "http_refusal", response: caseRef(result, refused) }
          : { kind: "leg", bundle: result.entry.bundle.path, legIndex: -1 },
      }),
    );
  }
}

/** The first attempt's outcome: what the guard decided when the slice was first tried. */
export function firstAttemptProbe(
  ctx: CaseContext,
  result: PaycheckResult,
  outcome: LegOutcome,
  expected: string[],
  description: string,
): Probe | null {
  const first = outcome.record.attempts[0];
  if (!first?.simulation) return null;
  const observed =
    first.outcome === "waiting"
      ? `wait:${first.waitReason}`
      : first.outcome === "executed"
        ? "executed"
        : `failed:${first.simulation.errorName ?? first.error ?? "unknown"}`;
  const p = probe({
    name: `${result.entry.label} / ${outcome.record.symbol} first attempt`,
    description,
    expected,
    observed,
    source: { kind: "program_error", logs: caseRef(result, first.simulation.logs) },
  });
  ctx.probes.push(p);
  return p;
}

export function deliveryProbe(ctx: CaseContext, result: PaycheckResult, outcome: LegOutcome) {
  const executed = outcome.record.executed;
  if (!executed) return null;
  const gross = BigInt(executed.outAmount) + BigInt(executed.issuerFee);
  const p = probe({
    name: `${result.entry.label} / ${outcome.record.symbol} delivered at least the minimum`,
    description: "Owner's shares plus the issuer's withheld fee reach min_out from the event",
    expected: ["delivered>=min_out"],
    observed: gross >= BigInt(executed.minOut) ? "delivered>=min_out" : "delivered<min_out",
    source: { kind: "delivery", transaction: caseRef(result, executed.transaction) },
    signature: executed.signature,
  });
  ctx.probes.push(p);
  return p;
}

type SnapshotFile = {
  response: {
    result: {
      value: ({ data: { parsed: { info: { tokenAmount: { amount: string } } } } } | null)[];
    };
  };
};

function amounts(ctx: CaseContext, ref: ArtifactRef): bigint[] {
  const file = JSON.parse(readFileSync(resolve(ctx.dir, ref.path), "utf8")) as SnapshotFile;
  return file.response.result.value.map((account) =>
    account ? BigInt(account.data.parsed.info.tokenAmount.amount) : 0n,
  );
}

/**
 * Nothing moved except the inflow itself: the pay-in account rose by exactly the inflow and no
 * share balance changed.
 */
export function balancesProbe(
  ctx: CaseContext,
  result: PaycheckResult,
  inflow: bigint,
  description: string,
): Probe | null {
  if (!result.before || !result.after) return null;
  return movementProbe(
    ctx,
    `${result.entry.label} / nothing moved`,
    description,
    caseRef(result, result.before),
    caseRef(result, result.after),
    inflow,
  );
}

/** Compares two case-relative balance snapshots of the same accounts. */
export function movementProbe(
  ctx: CaseContext,
  name: string,
  description: string,
  before: ArtifactRef,
  after: ArtifactRef,
  inflow: bigint,
): Probe {
  const [usdcBefore = 0n, ...sharesBefore] = amounts(ctx, before);
  const [usdcAfter = 0n, ...sharesAfter] = amounts(ctx, after);
  const sharesMoved = sharesBefore.some((amount, i) => amount !== sharesAfter[i]);
  const observed =
    usdcAfter - usdcBefore === inflow && !sharesMoved
      ? "moved:inflow_only"
      : `moved:usdc ${usdcAfter - usdcBefore}, shares ${sharesMoved ? "changed" : "unchanged"}`;
  const p = probe({
    name,
    description,
    expected: ["moved:inflow_only"],
    observed,
    source: { kind: "balances", before, after, inflow: inflow.toString() },
  });
  ctx.probes.push(p);
  return p;
}

export function programErrorProbe(
  ctx: CaseContext,
  name: string,
  description: string,
  expected: string[],
  run: ProbeRun,
  observed: string,
): Probe {
  const p = probe({
    name,
    description,
    expected,
    observed,
    source: { kind: "program_error", logs: run.transactionRef ?? run.simulationRef },
    signature: run.signature,
  });
  ctx.probes.push(p);
  return p;
}

export function accountAbsentProbe(
  ctx: CaseContext,
  name: string,
  description: string,
  read: ArtifactRef,
  value: unknown,
  account: Address,
): Probe {
  const p = probe({
    name,
    description: `${description} (${account})`,
    expected: ["account:absent"],
    observed: value === null ? "account:absent" : "account:present",
    source: { kind: "account_absent", read },
  });
  ctx.probes.push(p);
  return p;
}

/** `error:<Name>` for our program's errors, `external:<program>:<code>` or `landing:...` else. */
export function observedFailure(err: unknown, logs: readonly string[]): string {
  if (!err) return "simulation:success";
  const failure = classifyFailure(err, logs);
  if (failure.kind === "program") return `error:${failure.error.name}`;
  if (failure.kind === "external") return `external:${failure.program}:${failure.code ?? "none"}`;
  return `landing:${failure.detail}`;
}
