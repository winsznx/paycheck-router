/**
 * `pnpm demo:fork`: the judges' headless replay. A fresh surfnet forked from mainnet, the program
 * deployed under the production program id, Config and the registry, funded fork-only keys, the
 * demo worker's router, a paycheck sent as an ordinary transfer, detection by the reconcile
 * sweep, record_paycheck, the SDK's leg pipeline, the fork verifier, and an evidence bundle in
 * evidence/<run-id>/. Failed runs keep their bundle.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  classifyInflow,
  decodeLegExecuted,
  executeInstructionBuilder,
  executePaycheckLegs,
  fetchConfig,
  type HermesOptions,
  newMarkState,
  recordPaycheck,
  resolveInflows,
} from "@paycheck-router/sdk";
import { assetBySymbol, FORK_KEYS, PROGRAM_ID, type RunManifest } from "@paycheck-router/shared";
import { EvidenceBundle } from "./lib/bundle.ts";
import {
  createDemoRouter,
  deployProgram,
  fundForkKeys,
  initializeProtocol,
  loadForkSigners,
  type Surfnet,
  sendPaycheck,
  startSurfnet,
} from "./lib/fork.ts";
import { detectPaycheck, pendingLegs, recordPaycheckRun, TransactionLog } from "./lib/run.ts";

const exec = promisify(execFile);
const REPO_ROOT = resolve(import.meta.dirname, "..");

const SPLIT = [
  { symbol: "SPYx", weightBps: 2_500, bandBps: 50 },
  { symbol: "NVDAx", weightBps: 2_500, bandBps: 50 },
  { symbol: "Anthropic", weightBps: 2_500, bandBps: 300 },
  { symbol: "OpenAI", weightBps: 2_500, bandBps: 300 },
];
const INVEST_BPS = 2_000;
const PAYCHECK_USDC = 1_850_000_000n;
const ALLOWANCE_USDC = 10_000_000_000n;

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function gitCommit(): Promise<string> {
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT });
  return stdout.trim();
}

async function executableHash(soPath: string): Promise<string | null> {
  try {
    const { stdout } = await exec("solana-verify", ["get-executable-hash", soPath]);
    return stdout.trim().split("\n").at(-1) ?? null;
  } catch (error) {
    log(`solana-verify get-executable-hash failed: ${String(error)}`);
    return null;
  }
}

function sdkVersion(): string {
  const path = resolve(REPO_ROOT, "packages", "sdk", "package.json");
  return (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version;
}

async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const bundle = new EvidenceBundle(resolve(REPO_ROOT, "evidence", runId));
  const hermesApiKey = process.env.PYTH_API_KEY;
  if (!hermesApiKey) {
    log(
      "PYTH_API_KEY is not set. Hermes has required an API key since 2026-08-26, so this run " +
        "stops after record_paycheck, before the first price update.",
    );
  }
  const hermes: HermesOptions = {
    ...(hermesApiKey ? { apiKey: hermesApiKey } : {}),
    ...(process.env.HERMES_URL ? { baseUrl: process.env.HERMES_URL } : {}),
  };
  const manifest: Omit<RunManifest, "artifacts"> = {
    schemaVersion: 1,
    runId,
    environment: "fork",
    fork: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    commit: await gitCommit(),
    programId: PROGRAM_ID,
    programSha256: null,
    programExecutableHash: null,
    crankVersion: sdkVersion(),
    rpc: { sender: "", verifier: "" },
    feedIds: [],
    keys: { ...FORK_KEYS },
    router: null,
    paycheck: null,
    transactions: [],
    legs: [],
    error: null,
  };

  let surfnet: Surfnet | null = null;
  let transactions: TransactionLog | null = null;
  try {
    const signers = await loadForkSigners();
    const owner = signers["demo-worker"].address;
    log("starting a fresh surfnet forked from mainnet");
    surfnet = await startSurfnet({
      logFile: resolve(bundle.dir, "surfpool.log"),
      ...(process.env.FORK_RPC_PORT ? { rpcPort: Number(process.env.FORK_RPC_PORT) } : {}),
    });
    transactions = new TransactionLog(surfnet, bundle);
    manifest.fork = {
      startSlot: Number(surfnet.startSlot),
      rpcUrl: surfnet.rpcUrl,
      datasource: surfnet.datasource,
      surfpoolVersion: surfnet.surfpoolVersion,
      clockDriftSecs: surfnet.clockDriftSecs,
    };
    manifest.rpc = { sender: surfnet.rpcUrl, verifier: surfnet.rpcUrl };
    log(
      `surfnet ${surfnet.rpcUrl} from slot ${surfnet.startSlot}, clock ${surfnet.clockDriftSecs.toFixed(2)} s off wall time`,
    );

    await fundForkKeys(surfnet, signers);
    const deployment = await deployProgram(surfnet);
    manifest.programSha256 = deployment.sha256;
    manifest.programExecutableHash = await executableHash(deployment.soPath);
    if (deployment.signature) await transactions.add("deploy program", deployment.signature);
    log(`deployed ${deployment.programId} from ${deployment.soPath} (sha256 ${deployment.sha256})`);

    const protocol = await initializeProtocol(surfnet, signers);
    for (const { label, signature } of protocol.signatures) {
      await transactions.add(label, signature);
    }
    log(
      `Config, ${protocol.signatures.length - 1} setup transactions, lookup table ${protocol.lookupTable.address}`,
    );

    const demo = await createDemoRouter(surfnet, signers, {
      legs: SPLIT,
      investBps: INVEST_BPS,
      allowance: ALLOWANCE_USDC,
    });
    await transactions.add("setup: create_router and approves", demo.signature);
    manifest.router = {
      address: demo.router,
      owner,
      authority: demo.authority,
      investBps: INVEST_BPS,
      legs: SPLIT.map((leg) => ({
        mint: assetBySymbol(leg.symbol).mint,
        symbol: leg.symbol,
        weightBps: leg.weightBps,
      })),
    };
    log(`router ${demo.router}`);

    const paid = await sendPaycheck(surfnet, {
      from: signers["employer-1"],
      to: owner,
      amount: PAYCHECK_USDC,
    });
    await transactions.add("paycheck: employer-1 transferChecked", paid.signature);
    log(`employer-1 paid ${PAYCHECK_USDC} USDC base units: ${paid.signature}`);

    const candidate = await detectPaycheck(surfnet, { router: demo.router, payIn: demo.payIn });
    const [inflow] = await resolveInflows(surfnet.rpc, demo.payIn, null);
    if (!inflow) throw new Error("the sweep saw a balance but no credit transaction");
    const decision = classifyInflow(
      { amount: inflow.amount, sender: inflow.sender },
      {
        owner,
        authority: demo.authority,
        routerMinInflow: 1_000_000n,
        appThreshold: 1_000_000n,
        taggedPayersOnly: false,
        taggedPayers: new Set(),
      },
    );
    log(
      `detected +${candidate.delta} at slot ${candidate.slot} from ${inflow.sender}: ${decision.action}`,
    );
    if (decision.action !== "record") throw new Error(`inflow classified as ${decision.reason}`);

    const recorded = await recordPaycheck(surfnet.rpc, {
      recorder: signers.recorder,
      payer: signers.crank,
      router: demo.router,
      payIn: demo.payIn,
      detectedSlot: candidate.slot,
    });
    await transactions.add("record_paycheck", recorded.outcome.signature);
    if (recorded.outcome.status !== "confirmed" || !recorded.account) {
      throw new Error(`record_paycheck ${recorded.outcome.status}`);
    }
    const account = recorded.account;
    manifest.paycheck = {
      address: recorded.paycheck,
      seq: account.seq.toString(),
      inflow: account.inflow.toString(),
      investTotal: account.investTotal.toString(),
      sender: inflow.sender,
      inflowSignature: inflow.signature,
      recordSignature: recorded.outcome.signature,
    };
    log(
      `recorded paycheck ${recorded.paycheck}: invest ${account.investTotal} of ${account.inflow}`,
    );

    if (!hermesApiKey) {
      throw new Error(
        "PYTH_API_KEY is not set: Hermes answers 401 without a key, so no leg can be priced",
      );
    }
    const config = await fetchConfig(surfnet.rpc, protocol.config);
    const legs = await pendingLegs(surfnet, {
      router: demo.router,
      owner,
      authority: demo.authority,
      paycheck: recorded.paycheck,
      account,
    });
    const run = await executePaycheckLegs(
      {
        rpc: surfnet.rpc,
        rpcUrl: surfnet.rpcUrl,
        surfnet: true,
        crank: signers.crank,
        attester: signers.attester,
        jupiter: process.env.JUPITER_API_KEY ? { apiKey: process.env.JUPITER_API_KEY } : {},
        hermes,
        protocolLookupTable: { [protocol.lookupTable.address]: protocol.lookupTable.addresses },
        feeBps: config.data.feeBps,
      },
      legs,
      executeInstructionBuilder({ treasury: config.data.treasury }),
      decodeLegExecuted,
      newMarkState(),
      {
        onLegStart: (leg) => log(`${leg.asset.symbol}: ${leg.amountIn} USDC base units`),
        onAttempt: (leg, attempt) =>
          log(
            `${leg.asset.symbol}: ${attempt.outcome}${attempt.waitReason ? ` ${attempt.waitReason}` : ""}${attempt.error ? ` (${attempt.error})` : ""}`,
          ),
      },
    );
    const recordedRun = await recordPaycheckRun({
      surfnet,
      bundle,
      transactions,
      run,
      owner,
      hermes,
    });
    manifest.legs = recordedRun.legs;
    manifest.feedIds = recordedRun.feedIds;
  } catch (error) {
    manifest.error = error instanceof Error ? error.message : String(error);
    log(`run stopped: ${manifest.error}`);
    process.exitCode = 1;
  } finally {
    manifest.transactions = transactions?.records ?? [];
    manifest.finishedAt = new Date().toISOString();
    log(`bundle: ${bundle.writeManifest(manifest)}`);
    for (const leg of manifest.legs) {
      log(`  ${leg.symbol}: ${leg.state}${leg.waitReason ? ` ${leg.waitReason}` : ""}`);
    }
    await surfnet?.stop();
  }
}

await main();
