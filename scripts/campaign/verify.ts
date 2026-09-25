/**
 * `pnpm verify:campaign [--root evidence/campaign]`: rebuilds every number in summary.json from
 * the raw artifacts and exits non-zero on any mismatch or altered byte.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { CAMPAIGN_ROOT } from "./lib/case.ts";
import { verifyCampaign } from "./lib/verify.ts";

const { values } = parseArgs({ options: { root: { type: "string" } } });
const root = values.root ? resolve(values.root) : CAMPAIGN_ROOT;
const report = verifyCampaign(root);
const { runs, artifacts, probes, fills } = report.checked;
console.log(`${root}: ${runs} case runs, ${artifacts} artifacts, ${probes} probes, ${fills} fills`);
for (const note of report.notes) console.log(`NOTE ${note}`);
for (const error of report.errors) console.error(`MISMATCH ${error}`);
console.log(
  report.ok
    ? "verify:campaign OK: summary.json rebuilds from the raw artifacts"
    : `verify:campaign FAILED: ${report.errors.length} mismatches`,
);
process.exitCode = report.ok ? 0 : 1;
