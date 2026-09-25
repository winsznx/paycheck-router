import type { CaseDefinition } from "../lib/case.ts";
import { p1Positive } from "./p1-positive.ts";
import { p2Control } from "./p2-control.ts";
import { p3ClosedMarket } from "./p3-closed-market.ts";
import { p4Harmful } from "./p4-harmful.ts";
import { p4RealMarket } from "./p4-real-market.ts";
import { p5StaleContext } from "./p5-stale-context.ts";
import { p6Replay } from "./p6-replay.ts";
import { p7Ablations } from "./p7-ablations.ts";
import { p8Breadth } from "./p8-breadth.ts";

/** Every case in run order. P7 reads the bundles the others leave, so it runs last. */
export const CASES: readonly CaseDefinition[] = [
  p1Positive,
  p2Control,
  p3ClosedMarket,
  p4Harmful,
  p4RealMarket,
  p5StaleContext,
  p6Replay,
  p8Breadth,
  p7Ablations,
];

export function caseByName(name: string): CaseDefinition {
  const needle = name.toLowerCase();
  const matches = CASES.filter((c) => c.module === needle || c.caseId.toLowerCase() === needle);
  const [found] = matches;
  if (!found || matches.length > 1) {
    throw new Error(
      `${matches.length > 1 ? "ambiguous" : "unknown"} case ${name}; use one of ${CASES.map((c) => c.module).join(", ")}`,
    );
  }
  return found;
}
