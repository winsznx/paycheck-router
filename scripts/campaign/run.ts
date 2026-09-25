/**
 * `pnpm campaign [--case P1 --case p4-real-market ...] [--port 48899]`: runs the PRD 23.4 cases,
 * each on its own fresh surfnet, one after another, and keeps every bundle, failed or not.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { toJson } from "../lib/bundle.ts";
import { CASES, caseByName } from "./cases/index.ts";
import { CAMPAIGN_ROOT, runCase } from "./lib/case.ts";
import { CAMPAIGN_RPC_PORT, readEnv } from "./lib/env.ts";
import { buildSummary, summaryPath } from "./lib/summary.ts";

const { values } = parseArgs({
  options: {
    case: { type: "string", multiple: true },
    port: { type: "string" },
  },
});

const selected = values.case?.length ? values.case.map(caseByName) : [...CASES];
const env = await readEnv(values.port ? Number(values.port) : CAMPAIGN_RPC_PORT);
if (!env.hermes) {
  console.log("PYTH_API_KEY is not set: cases stop before their first Hermes call.");
}

let failed = 0;
for (const def of selected) {
  const { manifest, path } = await runCase(def, env);
  console.log(`${def.module}: ${manifest.observed.pass ? "PASS" : "FAIL"} -> ${path}`);
  if (!manifest.observed.pass) failed++;
}
console.log(`${selected.length - failed}/${selected.length} cases matched their expectations`);

writeFileSync(summaryPath(CAMPAIGN_ROOT), toJson(buildSummary(CAMPAIGN_ROOT)));
console.log(`summary: ${summaryPath(CAMPAIGN_ROOT)}`);
