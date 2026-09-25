import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { type ArtifactRef, FORK_KEYS, MANIFEST_FILE, PROGRAM_ID } from "@paycheck-router/shared";
import type { Address } from "@solana/kit";
import { EvidenceBundle, toJson } from "../../lib/bundle.ts";
import {
  type Deployment,
  deployProgram,
  type ForkSigners,
  fundForkKeys,
  initializeProtocol,
  loadForkSigners,
  type ProtocolSetup,
  type Surfnet,
  startSurfnet,
} from "../../lib/fork.ts";
import { TransactionLog } from "../../lib/run.ts";
import type { CampaignEnv } from "./env.ts";
import { CAMPAIGN_DIR, CaseManifest, type PaycheckEntry, type Probe } from "./manifest.ts";

const run = promisify(execFile);
export const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
/** evidence/campaign in this checkout. */
export const CAMPAIGN_ROOT = resolve(REPO_ROOT, CAMPAIGN_DIR);
/** Surfpool logs above this size stay out of the bundle; the manifest says so. */
const MAX_SURFPOOL_LOG_BYTES = 4 * 1024 * 1024;

export type ForkState = {
  surfnet: Surfnet;
  deployment: Deployment;
  protocol: ProtocolSetup;
  transactions: TransactionLog;
};

export type CaseContext = {
  readonly def: CaseDefinition;
  readonly runId: string;
  readonly dir: string;
  readonly bundle: EvidenceBundle;
  readonly env: CampaignEnv;
  readonly commit: string;
  readonly crankVersion: string;
  readonly signers: ForkSigners;
  /** Null for cases that only replay other bundles (P7). */
  readonly fork: ForkState | null;
  readonly paychecks: PaycheckEntry[];
  readonly probes: Probe[];
  readonly notes: string[];
  readonly inputs: ArtifactRef[];
  /** Fork-only keys created for this run (P8 workers), recorded by public key. */
  readonly extraKeys: Record<string, Address>;
  log(message: string): void;
};

export type CaseDefinition = {
  /** Directory name and `--case` value, e.g. `p1-positive`. */
  module: string;
  /** PRD 23.4 row, e.g. `P1`. */
  caseId: string;
  title: string;
  scenario: string;
  /** The pre-registered expected program outcome, in words. */
  expected: string;
  needsFork: boolean;
  run(ctx: CaseContext): Promise<void>;
};

export function requireFork(ctx: CaseContext): ForkState {
  if (!ctx.fork) throw new Error(`${ctx.def.module} needs a surfnet`);
  return ctx.fork;
}

async function gitCommit(): Promise<string> {
  const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT });
  return stdout.trim();
}

function crankVersion(): string {
  const pkg = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "packages", "sdk", "package.json"), "utf8"),
  ) as { version: string };
  return pkg.version;
}

function newRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Runs one case on its own fresh surfnet: deploy, Config and registry, funded fork-only keys,
 * then the case body. The manifest is written whatever happens, so failures keep their bundle.
 */
export async function runCase(
  def: CaseDefinition,
  env: CampaignEnv,
): Promise<{ manifest: CaseManifest; path: string }> {
  const runId = newRunId();
  const dir = resolve(CAMPAIGN_ROOT, def.module, runId);
  const bundle = new EvidenceBundle(dir);
  const startedAt = new Date().toISOString();
  const log = (message: string) =>
    console.log(`[${new Date().toISOString()}] ${def.module}: ${message}`);
  const signers = await loadForkSigners();
  const paychecks: PaycheckEntry[] = [];
  const probes: Probe[] = [];
  const notes: string[] = [];
  const inputs: ArtifactRef[] = [];
  const extraKeys: Record<string, Address> = {};
  let fork: ForkState | null = null;
  let surfnet: Surfnet | null = null;
  let programSha256: string | null = null;
  let error: string | null = null;
  const surfpoolLog = resolve(dir, "surfpool.log");
  const commit = await gitCommit();

  try {
    if (def.needsFork) {
      log(`starting a fresh surfnet on port ${env.rpcPort}`);
      surfnet = await startSurfnet({
        rpcPort: env.rpcPort,
        wsPort: env.rpcPort + 1,
        logFile: surfpoolLog,
      });
      log(`start slot ${surfnet.startSlot}, clock drift ${surfnet.clockDriftSecs.toFixed(2)} s`);
      const transactions = new TransactionLog(surfnet, bundle);
      await fundForkKeys(surfnet, signers);
      const deployment = await deployProgram(surfnet, { programSo: env.programSo });
      programSha256 = deployment.sha256;
      if (deployment.signature) await transactions.add("deploy program", deployment.signature);
      log(`deployed ${deployment.programId} (sha256 ${deployment.sha256})`);
      const protocol = await initializeProtocol(surfnet, signers);
      for (const { label, signature } of protocol.signatures) {
        await transactions.add(label, signature);
      }
      log(`Config, registry and lookup table: ${protocol.signatures.length} transactions`);
      fork = { surfnet, deployment, protocol, transactions };
    } else {
      programSha256 = existsSync(env.programSo) ? sha256File(env.programSo) : null;
    }
    const ctx: CaseContext = {
      def,
      runId,
      dir,
      bundle,
      env,
      commit,
      crankVersion: crankVersion(),
      signers,
      fork,
      paychecks,
      probes,
      notes,
      inputs,
      extraKeys,
      log,
    };
    await def.run(ctx);
  } catch (caught) {
    error = caught instanceof Error ? (caught.stack ?? caught.message) : String(caught);
    log(`stopped: ${error.split("\n")[0]}`);
  } finally {
    await surfnet?.stop();
  }

  if (existsSync(surfpoolLog)) {
    const size = statSync(surfpoolLog).size;
    if (size <= MAX_SURFPOOL_LOG_BYTES) {
      bundle.write("surfpool.log", readFileSync(surfpoolLog, "utf8"));
    } else {
      notes.push(`surfpool.log was ${size} bytes and is not part of the bundle`);
    }
  }

  const pass = error === null && probes.length > 0 && probes.every((p) => p.pass);
  const failed = probes.filter((p) => !p.pass).map((p) => `${p.name}: ${p.observed}`);
  const manifest = CaseManifest.parse({
    schemaVersion: 1,
    kind: "campaign-case",
    caseId: def.caseId,
    module: def.module,
    runId,
    environment: "fork",
    title: def.title,
    scenario: def.scenario,
    expected: def.expected,
    fork: surfnet
      ? {
          startSlot: Number(surfnet.startSlot),
          rpcUrl: surfnet.rpcUrl,
          datasource: surfnet.datasource,
          surfpoolVersion: surfnet.surfpoolVersion,
          clockDriftSecs: surfnet.clockDriftSecs,
        }
      : null,
    startedAt,
    finishedAt: new Date().toISOString(),
    commit,
    programId: PROGRAM_ID,
    programSha256,
    programExecutableHash: env.programExecutableHash,
    programSource: env.programSource,
    crankVersion: crankVersion(),
    rpc: surfnet
      ? { sender: surfnet.rpcUrl, verifier: surfnet.rpcUrl }
      : { sender: "none", verifier: "none" },
    keys: { ...FORK_KEYS, ...extraKeys },
    setup: fork?.transactions.records ?? [],
    paychecks,
    probes,
    inputs,
    observed: {
      outcome: error
        ? `run stopped: ${error.split("\n")[0]}`
        : pass
          ? "every probe matched its pre-registered expectation"
          : `probes that did not match: ${failed.join("; ") || "none recorded"}`,
      pass,
      notes,
    },
    artifacts: bundle.artifacts,
    error,
  });
  const path = resolve(dir, MANIFEST_FILE);
  writeFileSync(path, toJson(manifest));
  return { manifest, path };
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
