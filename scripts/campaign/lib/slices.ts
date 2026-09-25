/**
 * Reads every campaign bundle and derives one record per slice from raw artifacts: the first
 * attempt's Jupiter quote and reference, and the executed fill decoded from the transaction's
 * own logs. Every artifact read is checked against the SHA-256 its manifest recorded.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decimalToE9, legExecutedFromLogs } from "@paycheck-router/sdk";
import {
  type ArtifactRef,
  assetBySymbol,
  MANIFEST_FILE,
  RunManifest,
  USDC_FEED_ID,
} from "@paycheck-router/shared";
import { CaseManifest } from "./manifest.ts";
import {
  buyMultiplierE12,
  type FillCost,
  fillCost,
  hermesPriceE9,
  type QuoteVersusReference,
  quoteVersusReference,
  transferFeeBps,
} from "./metrics.ts";

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrityError";
  }
}

/** Reads an artifact and checks its bytes against the recorded hash. */
export function readArtifact(dir: string, ref: ArtifactRef): string {
  const path = resolve(dir, ref.path);
  if (!existsSync(path)) throw new IntegrityError(`missing artifact ${path}`);
  const bytes = readFileSync(path);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== ref.sha256) {
    throw new IntegrityError(`${path}: sha256 ${sha} does not match the manifest's ${ref.sha256}`);
  }
  return bytes.toString("utf8");
}

export function readArtifactJson<T = unknown>(dir: string, ref: ArtifactRef): T {
  return JSON.parse(readArtifact(dir, ref)) as T;
}

type RawManifest = { legs?: { attempts?: Record<string, unknown>[] }[] };

/**
 * Paycheck manifests written before the shared schema gained a field still parse: fields added
 * since (the re-quote list and notes on each attempt, Hermes refusals) read as empty. The bytes on
 * disk, and so their hashes, are untouched.
 */
export function withLaterFields(raw: unknown): unknown {
  const manifest = raw as RawManifest;
  for (const leg of manifest.legs ?? []) {
    for (const attempt of leg.attempts ?? []) {
      attempt.jupiterBuilds ??= [];
      attempt.notes ??= [];
      attempt.priceRejections ??= [];
    }
  }
  return manifest;
}

export type CaseRun = {
  dir: string;
  manifest: CaseManifest;
  paychecks: { entryIndex: number; dir: string; manifest: RunManifest }[];
};

/** Every case run under `root` (evidence/campaign), oldest first within each case. */
export function loadCampaign(root: string): CaseRun[] {
  if (!existsSync(root)) return [];
  const runs: CaseRun[] = [];
  for (const module of readdirSync(root, { withFileTypes: true })) {
    if (!module.isDirectory()) continue;
    const moduleDir = resolve(root, module.name);
    for (const run of readdirSync(moduleDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!run.isDirectory()) continue;
      const dir = resolve(moduleDir, run.name);
      const path = resolve(dir, MANIFEST_FILE);
      if (!existsSync(path)) continue;
      const manifest = CaseManifest.parse(JSON.parse(readFileSync(path, "utf8")));
      const paychecks = manifest.paychecks.map((entry, entryIndex) => {
        const sub = resolve(dir, entry.bundle.path, "..");
        return {
          entryIndex,
          dir: sub,
          manifest: RunManifest.parse(withLaterFields(JSON.parse(readArtifact(dir, entry.bundle)))),
        };
      });
      runs.push({ dir, manifest, paychecks });
    }
  }
  return runs;
}

export type Reference = {
  source: "pyth" | "mark";
  priceE9: bigint;
  usdcPriceE9: bigint;
  multiplierE12: bigint;
  decimals: number;
};

export type Slice = {
  module: string;
  caseId: string;
  runId: string;
  paycheck: string;
  legIndex: number;
  symbol: string;
  kind: "listed_equity" | "pre_ipo";
  amountIn: bigint;
  bandBps: number;
  state: string;
  waitReason: string | null;
  attempts: number;
  firstAttempt: {
    at: string;
    outcome: string;
    waitReason: string | null;
    quote: { inAmount: bigint; outAmount: bigint } | null;
    reference: Reference | null;
    versusReference: QuoteVersusReference | null;
    /** The issuer's transfer fee at the time, which a manual buyer also pays. */
    issuerFeeBps: number;
  } | null;
  executed: {
    signature: string;
    blockTime: number | null;
    /** The execute transaction's fee, paid by the crank (the protocol), not the owner. */
    networkFeeLamports: number | null;
    swappedIn: bigint;
    grossOut: bigint;
    cost: FillCost;
    recorded: { premiumBps: string; allInCostBps: string } | null;
    verified: boolean;
  } | null;
  /** For slices that stopped: `program:<Error>`, `infrastructure`, `external:...` or `other:...`. */
  failure: string | null;
};

type TxJson = {
  result: {
    blockTime: number | null;
    meta: { logMessages: string[] | null; fee?: number };
  } | null;
};

type PreStocksRow = { contract_address: string; markPrice: number };

function firstAttemptOf(
  pc: CaseRun["paychecks"][number],
  leg: RunManifest["legs"][number],
): Slice["firstAttempt"] {
  const first = leg.attempts[0];
  if (!first) return null;
  const asset = assetBySymbol(leg.symbol);
  const current = currentOf(pc.manifest.artifacts);
  let quote: { inAmount: bigint; outAmount: bigint } | null = null;
  if (first.jupiterBuild && current(first.jupiterBuild)) {
    const build = readArtifactJson<{ inAmount: string; outAmount: string }>(
      pc.dir,
      first.jupiterBuild,
    );
    quote = { inAmount: BigInt(build.inAmount), outAmount: BigInt(build.outAmount) };
  }
  const mintRef = pc.manifest.artifacts.find((a) => a.path === `raw/mints/${leg.symbol}.json`);
  const epochRef = pc.manifest.artifacts.find((a) => a.path === "raw/epoch.json");
  const mint = mintRef ? readArtifactJson(pc.dir, mintRef) : null;
  const epoch = epochRef
    ? (readArtifactJson<{ result: { epoch: number } }>(pc.dir, epochRef).result.epoch ?? 0)
    : 0;
  const at = Math.floor(Date.parse(first.startedAt) / 1000);
  let reference: Reference | null = null;
  const hermes =
    first.hermesUpdate && current(first.hermesUpdate)
      ? readArtifactJson(pc.dir, first.hermesUpdate)
      : null;
  const usdc = hermes ? hermesPriceE9(hermes, USDC_FEED_ID) : null;
  if (mint && usdc) {
    const multiplierE12 = buyMultiplierE12(mint, at);
    if (leg.kind === "pre_ipo" && first.attestation && current(first.attestation.apiResponse)) {
      const rows = readArtifactJson<PreStocksRow[]>(pc.dir, first.attestation.apiResponse);
      const row = rows.find((r) => r.contract_address === leg.mint);
      if (row) {
        reference = {
          source: "mark",
          priceE9: decimalToE9(row.markPrice),
          usdcPriceE9: usdc.priceE9,
          multiplierE12,
          decimals: asset.decimals,
        };
      }
    } else if (leg.kind === "listed_equity" && asset.feedId && hermes) {
      const price = hermesPriceE9(hermes, asset.feedId);
      if (price) {
        reference = {
          source: "pyth",
          priceE9: price.priceE9,
          usdcPriceE9: usdc.priceE9,
          multiplierE12,
          decimals: asset.decimals,
        };
      }
    }
  }
  return {
    at: first.startedAt,
    outcome: first.outcome,
    waitReason: first.waitReason,
    quote,
    reference,
    versusReference: quote && reference ? quoteVersusReference(quote, reference) : null,
    issuerFeeBps: mint ? transferFeeBps(mint, epoch) : 0,
  };
}

function executedOf(
  pc: CaseRun["paychecks"][number],
  leg: RunManifest["legs"][number],
): Slice["executed"] {
  const executed = leg.executed;
  if (!executed) return null;
  const tx = readArtifactJson<TxJson>(pc.dir, executed.transaction);
  const [event] = legExecutedFromLogs(tx.result?.meta.logMessages ?? []);
  if (!event) throw new IntegrityError(`${pc.dir}: ${executed.signature} has no LegExecuted`);
  const asset = assetBySymbol(leg.symbol);
  return {
    signature: executed.signature,
    blockTime: tx.result?.blockTime ?? null,
    networkFeeLamports: tx.result?.meta.fee ?? null,
    swappedIn: event.swappedIn,
    grossOut: event.outAmount + event.issuerFee,
    cost: fillCost({
      amountIn: event.amountIn,
      fee: event.fee,
      swappedIn: event.swappedIn,
      outAmount: event.outAmount,
      issuerFee: event.issuerFee,
      usdcPriceE9: event.usdcPriceE9,
      refPriceE9: event.refPriceE9,
      multiplierE12: event.multiplierE12,
      decimals: asset.decimals,
    }),
    recorded: { premiumBps: executed.premiumBps, allInCostBps: executed.allInCostBps },
    verified: leg.verification?.state === "VERIFIED",
  };
}

/**
 * Surfnet datasource and transport failures: the fork could not fetch mainnet state or the RPC
 * call itself failed. They say nothing about the product and are tallied apart from its outcomes.
 */
export const INFRASTRUCTURE_FAILURE =
  /Failed to fetch accounts from remote|error sending request|Cannot destructure property|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|Too Many Requests|\b429\b|Internal error/i;

/**
 * Whether a reference is the last one recorded for its path. A runner that wrote one path twice
 * left only the second write, so an earlier reference to that path has no surviving bytes.
 */
export function currentOf(artifacts: readonly ArtifactRef[]): (ref: ArtifactRef) => boolean {
  const latest = new Map(artifacts.map((ref) => [ref.path, ref.sha256]));
  return (ref) => latest.get(ref.path) === ref.sha256;
}

/** Why a slice that neither executed, waited nor expired stopped. */
function failureOf(leg: RunManifest["legs"][number]): string | null {
  if (leg.executed || leg.state === "WAITING" || leg.state === "EXPIRED") return null;
  const last = leg.attempts.at(-1);
  if (!last) return "not attempted";
  if (last.simulation?.errorName) return `program:${last.simulation.errorName}`;
  const error = last.error ?? "";
  if (INFRASTRUCTURE_FAILURE.test(error)) return "infrastructure";
  if (/^external:|failed: custom program error/.test(error))
    return `external:${error.slice(0, 160)}`;
  return `other:${error.slice(0, 160)}`;
}

export function slicesOf(runs: readonly CaseRun[]): Slice[] {
  const slices: Slice[] = [];
  for (const run of runs) {
    for (const pc of run.paychecks) {
      for (const leg of pc.manifest.legs) {
        slices.push({
          module: run.manifest.module,
          caseId: run.manifest.caseId,
          runId: run.manifest.runId,
          paycheck: run.manifest.paychecks[pc.entryIndex]?.label ?? "",
          legIndex: leg.index,
          symbol: leg.symbol,
          kind: leg.kind,
          amountIn: BigInt(leg.amountIn),
          bandBps: leg.bandBps,
          state: leg.state,
          waitReason: leg.waitReason,
          attempts: leg.attempts.length,
          firstAttempt: firstAttemptOf(pc, leg),
          executed: executedOf(pc, leg),
          failure: failureOf(leg),
        });
      }
    }
  }
  return slices;
}
