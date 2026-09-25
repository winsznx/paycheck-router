/** `pnpm campaign:summary [--root evidence/campaign]`: writes summary.json from every case bundle. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { toJson } from "../lib/bundle.ts";
import { CAMPAIGN_ROOT } from "./lib/case.ts";
import { buildSummary, summaryPath } from "./lib/summary.ts";

const { values } = parseArgs({ options: { root: { type: "string" } } });
const root = values.root ? resolve(values.root) : CAMPAIGN_ROOT;
const path = summaryPath(root);
writeFileSync(path, toJson(buildSummary(root)));
console.log(`wrote ${path}`);
