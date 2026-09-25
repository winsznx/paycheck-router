import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { MANIFEST_FILE } from "@paycheck-router/shared";
import { CAMPAIGN_ROOT, type CaseDefinition } from "../lib/case.ts";
import { requireHermes } from "../lib/env.ts";
import { type ChainIndex, chainCosts, fetchChainData } from "../lib/ethereum.ts";
import { probe } from "../lib/manifest.ts";
import { loadCampaign, readArtifactJson, slicesOf } from "../lib/slices.ts";
import { HEADLINE_MODULES } from "../lib/summary.ts";

/**
 * PRD 23.4 P7 on the fork (23.9): the guard and oracle ablations replay the recorded quotes of
 * the other cases' slices (summary.json computes them from those bundles); the chain ablation
 * reads Ethereum gas and ETH/USD at the same timestamps and stays computed, never executed.
 */
export const p7Ablations: CaseDefinition = {
  module: "p7-ablations",
  caseId: "P7",
  title: "Ablations",
  scenario:
    "Arm D (no guard: buy at the first-attempt Jupiter quote) and Jupiter's own price as the " +
    "only reference, replayed from the fork runs' recorded quotes; the same slices costed in " +
    "Ethereum gas from eth_feeHistory and Pyth ETH/USD at the same timestamps",
  expected:
    "Overpayment the guard prevented per slice; count of slices that would have executed out " +
    "of band; computed (not executed) Ethereum cost per $20 slice",
  needsFork: false,
  async run(ctx) {
    const runs = loadCampaign(CAMPAIGN_ROOT).filter((r) => r.manifest.module !== "p7-ablations");
    for (const run of runs) {
      const path = resolve(run.dir, MANIFEST_FILE);
      ctx.inputs.push({
        path: relative(ctx.dir, path),
        sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      });
    }
    const slices = slicesOf(runs).filter(
      (s) => (HEADLINE_MODULES as readonly string[]).includes(s.module) && s.firstAttempt,
    );
    const quoted = slices.filter((s) => s.firstAttempt?.versusReference);
    ctx.log(
      `${runs.length} case runs, ${slices.length} headline slices, ${quoted.length} with a quote and reference`,
    );
    ctx.probes.push(
      probe({
        name: "guard and oracle ablations have inputs",
        description:
          "Headline slices with a recorded first-attempt quote and an independent reference",
        expected: ["replayable"],
        observed: quoted.length > 0 ? "replayable" : "no recorded quotes",
        source: { kind: "computed", artifacts: ctx.inputs },
      }),
    );
    const indexRef = await fetchChainData(
      ctx.bundle,
      slices.map((s) => ({
        slice: `${s.module}/${s.runId}/${s.paycheck}/${s.legIndex}`,
        at: s.firstAttempt?.at ?? "",
        sliceUsdc: s.amountIn,
      })),
      requireHermes(ctx.env),
    );
    const costs = chainCosts(
      ctx.dir,
      ctx.bundle.artifacts,
      readArtifactJson<ChainIndex>(ctx.dir, indexRef),
    );
    ctx.log(
      `Ethereum: ${costs.swapReceipts}/${costs.receiptsRead} swap receipts, median gas ${costs.gasUnitsMedian}, median $20 slice ${costs.medianPer20Bps} bps`,
    );
    ctx.probes.push(
      probe({
        name: "chain ablation computed",
        description:
          "Real Ethereum xStock swap gas, fee history and ETH/USD at every slice's timestamp",
        expected: ["computed"],
        observed:
          costs.gasUnitsMedian !== null && costs.points.every((p) => p.costUsdMicros !== null)
            ? "computed"
            : `incomplete: ${costs.swapReceipts} swap receipts`,
        source: { kind: "computed", artifacts: [indexRef] },
      }),
    );
    ctx.notes.push(
      "Chain ablation: computed, not executed. Guard and oracle ablations: replayed, not executed",
    );
  },
};
