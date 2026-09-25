import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Slice = { symbol: string; state: string; reason?: string; signature?: string };
type Facts = {
  tagline: string;
  oneLine: string;
  environmentLine: string;
  descriptionFirstLine: string;
  program: { id: string; buildHash: string };
  canonicalRun: string;
  runs: {
    runId: string;
    bundle: string;
    forkStartSlot: number;
    programExecutableHash: string;
    slices: Slice[];
  }[];
};
type Manifest = {
  runId: string;
  environment: string;
  fork: { startSlot: number };
  programId: string;
  programExecutableHash: string;
  legs: {
    symbol: string;
    state: string;
    waitReason: string | null;
    executed?: { signature: string } | null;
  }[];
};

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const facts = JSON.parse(read("submission-facts.json")) as Facts;
const readme = read("README.md");
const submission = read("docs/SUBMISSION.md");
const failures: string[] = [];

function expect(ok: boolean, message: string) {
  if (!ok) failures.push(message);
}

expect(
  readme.includes(facts.oneLine),
  "README is missing the one-line description from submission-facts.json",
);
expect(readme.includes(facts.environmentLine), "README is missing the fork environment line");
expect(readme.includes(facts.program.id), "README is missing the program id");
expect(
  readme.includes(facts.program.buildHash),
  "README build hash differs from submission-facts.json",
);
expect(
  submission.includes(facts.tagline),
  "docs/SUBMISSION.md tagline differs from submission-facts.json",
);
expect(
  submission.includes(facts.descriptionFirstLine),
  "docs/SUBMISSION.md description first line differs from submission-facts.json",
);
expect(
  !/live on mainnet/i.test(readme + submission),
  "a public surface claims to be live on mainnet",
);

const canonical = facts.runs.find((run) => run.runId === facts.canonicalRun);
expect(canonical !== undefined, `canonicalRun ${facts.canonicalRun} is not in runs[]`);
if (canonical) {
  const manifest = JSON.parse(read(`${canonical.bundle}/manifest.json`)) as Manifest;
  expect(
    manifest.runId === canonical.runId,
    "canonical bundle runId differs from submission-facts.json",
  );
  expect(manifest.environment === "fork", "canonical bundle is not labelled fork");
  expect(manifest.fork.startSlot === canonical.forkStartSlot, "canonical fork start slot differs");
  expect(manifest.programId === facts.program.id, "canonical bundle program id differs");
  expect(
    manifest.programExecutableHash === canonical.programExecutableHash &&
      canonical.programExecutableHash === facts.program.buildHash,
    "canonical run binary hash differs from the submitted build hash",
  );
  expect(readme.includes(canonical.bundle), "README does not link the canonical bundle");
  for (const slice of canonical.slices) {
    const leg = manifest.legs.find((l) => l.symbol === slice.symbol);
    expect(leg !== undefined, `${slice.symbol} is not in the canonical bundle`);
    if (!leg) continue;
    expect(
      leg.state === slice.state,
      `${slice.symbol} state ${slice.state} differs from bundle ${leg.state}`,
    );
    if (slice.reason) {
      expect(leg.waitReason === slice.reason, `${slice.symbol} wait reason differs from bundle`);
    }
    if (slice.signature) {
      expect(
        leg.executed?.signature === slice.signature,
        `${slice.symbol} signature differs from bundle`,
      );
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL  ${failure}`);
  process.exit(1);
}
console.log(
  "submission-facts.json agrees with the README, docs/SUBMISSION.md and the canonical bundle",
);
