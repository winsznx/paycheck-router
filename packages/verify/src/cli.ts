import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { verifyBundle } from "./verify-bundle.ts";

const { values } = parseArgs({
  options: {
    bundle: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

if (!values.bundle) {
  console.error("usage: paycheck-verify --bundle evidence/<run-id> [--json]");
  process.exit(2);
}

const report = await verifyBundle(resolve(process.cwd(), values.bundle));
if (values.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(
    `run ${report.runId} (${report.environment}, fork start slot ${report.forkStartSlot ?? "n/a"})`,
  );
  const artifactsPass = report.artifacts.failed.length === 0;
  console.log(
    `${artifactsPass ? "PASS" : "FAIL"}  artifacts: ${report.artifacts.checked} hashed${artifactsPass ? "" : `, altered: ${report.artifacts.failed.join(", ")}`}`,
  );
  for (const slice of report.slices) {
    console.log(
      `${slice.pass ? "PASS" : "FAIL"}  slice ${slice.index} ${slice.symbol}: ${slice.claimed}`,
    );
    for (const f of slice.findings.filter((f) => !f.pass)) {
      console.log(`        ${f.name}: ${f.detail}`);
    }
  }
  console.log(report.pass ? "PASS" : "FAIL");
}
process.exitCode = report.pass ? 0 : 1;
