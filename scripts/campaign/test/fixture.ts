import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { FORK_KEYS, PROGRAM_ID, type RunManifest } from "@paycheck-router/shared";
import { EvidenceBundle, toJson } from "../../lib/bundle.ts";
import { CaseManifest, probe } from "../lib/manifest.ts";
import { buildSummary, summaryPath } from "../lib/summary.ts";

const OWNER = FORK_KEYS["demo-worker"];
const ROUTER = FORK_KEYS.ops;

function balances(usdc: string, shares: string) {
  const account = (amount: string) => ({ data: { parsed: { info: { tokenAmount: { amount } } } } });
  return toJson({
    request: { method: "getMultipleAccounts" },
    response: { result: { value: [account(usdc), account(shares)] } },
  });
}

/**
 * A one-case campaign shaped like a P2 run: a paycheck bundle with before and after balances
 * and a probe that the router's next Paycheck account is absent. Returns the campaign root.
 */
export function writeFixtureCampaign(): string {
  const root = mkdtempSync(resolve(tmpdir(), "campaign-fixture-"));
  const dir = resolve(root, "p2-control", "2026-09-25T13-00-00-000Z");
  const caseBundle = new EvidenceBundle(dir);
  const paycheck = new EvidenceBundle(resolve(dir, "paychecks", "01-untagged-sender"));
  const before = paycheck.write("raw/balances/before.json", balances("0", "0"));
  const after = paycheck.write("raw/balances/after.json", balances("50000000", "0"));
  const runManifest: Omit<RunManifest, "artifacts"> = {
    schemaVersion: 1,
    runId: "fixture/paychecks/01-untagged-sender",
    environment: "fork",
    fork: null,
    startedAt: "2026-09-25T13:00:00.000Z",
    finishedAt: "2026-09-25T13:01:00.000Z",
    commit: "0".repeat(40),
    programId: PROGRAM_ID,
    programSha256: null,
    programExecutableHash: null,
    programSource: null,
    crankVersion: "0.1.0",
    rpc: { sender: "http://127.0.0.1:48899", verifier: "http://127.0.0.1:48899" },
    feedIds: [],
    keys: { ...FORK_KEYS },
    router: { address: ROUTER, owner: OWNER, authority: ROUTER, investBps: 5_000, legs: [] },
    paycheck: null,
    transactions: [],
    legs: [],
    error: null,
  };
  const pcPath = paycheck.writeManifest(runManifest);
  const pcRef = {
    path: "paychecks/01-untagged-sender/manifest.json",
    sha256: createHash("sha256").update(readFileSync(pcPath)).digest("hex"),
  };
  const read = caseBundle.write(
    "raw/accounts/untagged-sender-paycheck.json",
    toJson({ request: { method: "getAccountInfo" }, response: { result: { value: null } } }),
  );
  const probes = [
    probe({
      name: "untagged sender / no paycheck",
      description: "The router's next Paycheck account does not exist",
      expected: ["account:absent"],
      observed: "account:absent",
      source: { kind: "account_absent", read },
    }),
    probe({
      name: "untagged sender / nothing moved",
      description: "Only the inflow landed",
      expected: ["moved:inflow_only"],
      observed: "moved:inflow_only",
      source: {
        kind: "balances",
        before: { path: `paychecks/01-untagged-sender/${before.path}`, sha256: before.sha256 },
        after: { path: `paychecks/01-untagged-sender/${after.path}`, sha256: after.sha256 },
        inflow: "50000000",
      },
    }),
  ];
  const manifest = CaseManifest.parse({
    schemaVersion: 1,
    kind: "campaign-case",
    caseId: "P2",
    module: "p2-control",
    runId: "2026-09-25T13-00-00-000Z",
    environment: "fork",
    title: "Healthy control",
    scenario: "fixture",
    expected: "Skipped or no paycheck; nothing moves",
    fork: null,
    startedAt: "2026-09-25T13:00:00.000Z",
    finishedAt: "2026-09-25T13:01:00.000Z",
    commit: "0".repeat(40),
    programId: PROGRAM_ID,
    programSha256: null,
    programExecutableHash: null,
    programSource: null,
    crankVersion: "0.1.0",
    rpc: { sender: "none", verifier: "none" },
    keys: { ...FORK_KEYS },
    setup: [],
    paychecks: [
      {
        label: "untagged sender",
        employer: "employer-2",
        employerAddress: FORK_KEYS["employer-2"],
        worker: "demo-worker",
        workerAddress: OWNER,
        router: ROUTER,
        amount: "50000000",
        bundle: pcRef,
        classification: "untagged_sender",
        recorded: false,
        error: null,
      },
    ],
    probes,
    inputs: [],
    observed: {
      outcome: "every probe matched its pre-registered expectation",
      pass: true,
      notes: [],
    },
    artifacts: caseBundle.artifacts,
    error: null,
  });
  writeFileSync(resolve(dir, "manifest.json"), toJson(manifest));
  writeFileSync(summaryPath(root), toJson(buildSummary(root)));
  return root;
}
