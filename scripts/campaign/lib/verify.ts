/**
 * `pnpm verify:campaign`: checks every artifact against its recorded SHA-256, re-derives every
 * probe's observation from raw artifacts with parsers of its own, cross-checks each fill's cost
 * against the crank's recorded figure, and rebuilds summary.json byte for byte. It imports no
 * decision code from the crank: guard arithmetic comes from `packages/guard-math` and the event
 * layout from the generated client.
 */
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { buyMinOut } from "@paycheck-router/guard-math";
import { legExecutedFromLogs } from "@paycheck-router/sdk";
import {
  type ArtifactRef,
  assetBySymbol,
  PROGRAM_ID,
  programErrorByCode,
  USDC_MINT,
} from "@paycheck-router/shared";
import { toJson } from "../../lib/bundle.ts";
import type { Probe } from "./manifest.ts";
import { fillCost, multiplierPairE12 } from "./metrics.ts";
import {
  type CaseRun,
  IntegrityError,
  loadCampaign,
  readArtifact,
  readArtifactJson,
} from "./slices.ts";
import { buildSummary, summaryPath } from "./summary.ts";

export type VerifyReport = {
  ok: boolean;
  errors: string[];
  notes: string[];
  checked: Record<string, number>;
};

const FAILED = /^Program (\w+) failed: custom program error: 0x([0-9a-fA-F]+)$/;
const ALREADY_PROCESSED = /already (been )?processed|AlreadyProcessed/i;

type LogsFile = {
  err?: unknown;
  logs?: string[];
  result?: { meta?: { err: unknown; logMessages: string[] | null } } | null;
};

function logsOf(file: LogsFile): { err: unknown; logs: string[] } {
  if (file.result !== undefined) {
    return { err: file.result?.meta?.err ?? null, logs: file.result?.meta?.logMessages ?? [] };
  }
  return { err: file.err ?? null, logs: file.logs ?? [] };
}

/** Every rendering of a failure the runner may have recorded: error name and wait reason. */
function failureForms(file: LogsFile): string[] {
  const { err, logs } = logsOf(file);
  if (!err) return ["simulation:success", "executed"];
  for (const line of logs) {
    const match = FAILED.exec(line);
    if (!match) continue;
    const [, program = "", hex = "0"] = match;
    const code = Number.parseInt(hex, 16);
    if (program !== PROGRAM_ID) return [`external:${program}:${code}`];
    const info = programErrorByCode(code);
    if (!info) return [`error:unknown-${code}`];
    return [`error:${info.name}`, ...(info.reason ? [`wait:${info.reason}`] : [])];
  }
  return [`landing:${JSON.stringify(err)}`];
}

type SnapshotFile = {
  response: {
    result: {
      value: ({ data: { parsed: { info: { tokenAmount: { amount: string } } } } } | null)[];
    };
  };
};

function amountsOf(file: SnapshotFile): bigint[] {
  return file.response.result.value.map((a) =>
    a ? BigInt(a.data.parsed.info.tokenAmount.amount) : 0n,
  );
}

type ParsedTx = {
  result: {
    meta: {
      err: unknown;
      preTokenBalances: {
        accountIndex: number;
        mint: string;
        owner?: string;
        uiTokenAmount: { amount: string };
      }[];
      postTokenBalances: {
        accountIndex: number;
        mint: string;
        owner?: string;
        uiTokenAmount: { amount: string };
      }[];
      logMessages: string[] | null;
    };
    transaction: { message: { accountKeys: ({ pubkey: string } | string)[] } };
  } | null;
};

/** USDC credited to `payIn` and the owner of the account that lost the most USDC. */
function inflowOf(tx: ParsedTx, payIn: string): { amount: bigint; sender: string | null } {
  const result = tx.result;
  if (!result || result.meta.err) return { amount: 0n, sender: null };
  const keys = result.transaction.message.accountKeys.map((k) =>
    typeof k === "string" ? k : k.pubkey,
  );
  const index = keys.indexOf(payIn);
  const at = (list: typeof result.meta.preTokenBalances, i: number) =>
    BigInt(list.find((b) => b.accountIndex === i)?.uiTokenAmount.amount ?? "0");
  const amount = at(result.meta.postTokenBalances, index) - at(result.meta.preTokenBalances, index);
  let sender: string | null = null;
  let largest = 0n;
  for (const pre of result.meta.preTokenBalances) {
    if (pre.mint !== USDC_MINT || pre.accountIndex === index) continue;
    const out =
      BigInt(pre.uiTokenAmount.amount) - at(result.meta.postTokenBalances, pre.accountIndex);
    if (out > largest && pre.owner) {
      largest = out;
      sender = pre.owner;
    }
  }
  return { amount, sender };
}

function deriveProbe(run: CaseRun, p: Probe, latest: ReadonlyMap<string, ArtifactRef>): string[] {
  const src = p.source;
  const dir = run.dir;
  const current = (ref: ArtifactRef) => latest.get(ref.path) ?? ref;
  const json = <T = unknown>(ref: ArtifactRef): T => readArtifactJson<T>(dir, current(ref));
  switch (src.kind) {
    case "program_error":
      return failureForms(json<LogsFile>(src.logs));
    case "rpc_refusal": {
      const file = json<{
        response: { error?: { message?: string }; result?: unknown };
      }>(src.response);
      if (file.response.error) {
        const message = String(file.response.error.message ?? "");
        return [
          ALREADY_PROCESSED.test(message)
            ? "rpc:already_processed"
            : `rpc:refused:${message.slice(0, 120)}`,
        ];
      }
      return ["rpc:accepted"];
    }
    case "http_refusal": {
      const file = json<{ status: number }>(src.response);
      return file.status === 401 || file.status === 403
        ? ["hermes:refused"]
        : [`hermes:${file.status}`];
    }
    case "account_absent": {
      const file = json<{ response: { result: { value: unknown } } }>(src.read);
      return [file.response.result.value === null ? "account:absent" : "account:present"];
    }
    case "balances": {
      const [usdcBefore = 0n, ...sharesBefore] = amountsOf(json<SnapshotFile>(src.before));
      const [usdcAfter = 0n, ...sharesAfter] = amountsOf(json<SnapshotFile>(src.after));
      const moved = sharesBefore.some((a, i) => a !== sharesAfter[i]);
      return [
        usdcAfter - usdcBefore === BigInt(src.inflow) && !moved
          ? "moved:inflow_only"
          : `moved:usdc ${usdcAfter - usdcBefore}, shares ${moved ? "changed" : "unchanged"}`,
      ];
    }
    case "classification": {
      const { amount, sender } = inflowOf(json<ParsedTx>(src.transaction), src.payIn);
      if (sender === src.authority) return ["classification:protocol_movement"];
      if (sender === src.owner) return ["classification:self_transfer"];
      if (amount < BigInt(src.minimum)) return ["classification:not_detected"];
      if (src.taggedPayersOnly && (!sender || !src.taggedPayers.includes(sender))) {
        return ["classification:untagged_sender"];
      }
      return ["classification:record"];
    }
    case "delivery": {
      const tx = json<ParsedTx>(src.transaction);
      const [event] = legExecutedFromLogs(tx.result?.meta.logMessages ?? []);
      if (!event) return ["no LegExecuted"];
      return [
        event.outAmount + event.issuerFee >= event.minOut
          ? "delivered>=min_out"
          : "delivered<min_out",
      ];
    }
    case "min_out_multiplier": {
      const file = json<LogsFile>(src.transaction);
      const [event] = legExecutedFromLogs(logsOf(file).logs);
      if (!event) return failureForms(file);
      const { current, pending } = multiplierPairE12(json(src.mintAfter));
      const recomputed = buyMinOut({
        usdcIn: event.swappedIn,
        usdcPriceE9: event.usdcPriceE9,
        priceE9: event.refPriceE9,
        bandBps: event.bandBps,
        multiplierE12: event.multiplierE12,
        decimals: src.decimals,
      });
      if (recomputed !== event.minOut) return ["min_out:mismatch"];
      if (event.multiplierE12 === pending) return ["min_out:new_multiplier"];
      if (event.multiplierE12 === current) return ["min_out:old_multiplier"];
      return ["min_out:other_multiplier"];
    }
    case "computed":
      for (const ref of src.artifacts) readArtifact(dir, current(ref));
      return [p.observed];
    case "leg":
      return deriveLeg(run, src.bundle, src.legIndex);
  }
}

/** Every case-level artifact a probe's source names. */
function sourceRefs(p: Probe): ArtifactRef[] {
  const src = p.source;
  switch (src.kind) {
    case "program_error":
      return [src.logs];
    case "rpc_refusal":
    case "http_refusal":
      return [src.response];
    case "account_absent":
      return [src.read];
    case "balances":
      return [src.before, src.after];
    case "classification":
    case "delivery":
      return [src.transaction];
    case "min_out_multiplier":
      return [src.transaction, src.mintAfter];
    case "computed":
      return src.artifacts;
    case "leg":
      return [];
  }
}

function deriveLeg(run: CaseRun, bundle: string, legIndex: number): string[] {
  const entryIndex = run.manifest.paychecks.findIndex((e) => e.bundle.path === bundle);
  const pc = run.paychecks.find((p) => p.entryIndex === entryIndex);
  if (!pc) return [`no paycheck bundle ${bundle}`];
  const leg = pc.manifest.legs.find((l) => l.index === legIndex);
  if (!leg)
    return [
      `paycheck:${pc.manifest.error ?? run.manifest.paychecks[entryIndex]?.classification ?? "not run"}`,
    ];
  if (leg.executed) {
    const tx = readArtifactJson<ParsedTx>(pc.dir, leg.executed.transaction);
    const [event] = legExecutedFromLogs(tx.result?.meta.logMessages ?? []);
    if (!event || event.legIndex !== legIndex) return ["leg:no matching LegExecuted"];
    const checks = leg.verification?.checks ?? [];
    const verified =
      leg.verification?.state === "VERIFIED" && checks.length > 0 && checks.every((c) => c.pass);
    return [verified ? "leg:VERIFIED" : leg.verification ? "leg:UNVERIFIED" : "leg:EXECUTED"];
  }
  if (leg.state === "EXPIRED") {
    const expiry = pc.manifest.transactions.find(
      (t) => t.label === `expire_leg ${leg.symbol}` && t.err === null && t.raw,
    );
    return [
      expiry?.raw && readArtifact(pc.dir, expiry.raw) ? "leg:EXPIRED" : "leg:expiry not onchain",
    ];
  }
  const last = leg.attempts.at(-1);
  if (last?.simulation) {
    const forms = failureForms(readArtifactJson<LogsFile>(pc.dir, last.simulation.logs));
    const waits = forms.filter((f) => f.startsWith("wait:"));
    if (waits.length === 0 || last.outcome !== "waiting") return [`leg:${leg.state}`];
    return waits.map((f) => `leg:WAITING:${f.slice(5)}`);
  }
  if (last?.waitReason === "PRICE_UNAVAILABLE") {
    const feedId = assetBySymbol(leg.symbol).feedId;
    const refused = pc.manifest.artifacts
      .filter((a) => a.path.startsWith("raw/hermes/rejected-"))
      .flatMap((a) => readArtifactJson<{ feedId: string; status: number }[]>(pc.dir, a))
      .some((r) => r.feedId === feedId && (r.status === 401 || r.status === 403));
    return [refused ? "leg:WAITING:PRICE_UNAVAILABLE" : "leg:no Hermes refusal on record"];
  }
  if (last?.waitReason) return [`leg:WAITING:${last.waitReason}`];
  return [`leg:${leg.state}`];
}

/**
 * The last reference recorded for each path. A runner that wrote one path twice left the file as
 * its second write; the earlier reference is superseded, reported, and never counted as a match.
 */
export function latestByPath(refs: readonly ArtifactRef[]): Map<string, ArtifactRef> {
  return new Map(refs.map((ref) => [ref.path, ref]));
}

function checkArtifacts(
  dir: string,
  refs: readonly ArtifactRef[],
  errors: string[],
  notes: string[],
): number {
  const latest = latestByPath(refs);
  let n = 0;
  for (const ref of refs) {
    const last = latest.get(ref.path) ?? ref;
    if (last.sha256 !== ref.sha256) {
      notes.push(
        `${dir}/${ref.path}: written twice; the earlier write (${ref.sha256}) is superseded`,
      );
      continue;
    }
    try {
      readArtifact(dir, ref);
      n++;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return n;
}

export function verifyCampaign(root: string): VerifyReport {
  const errors: string[] = [];
  const notes: string[] = [];
  const checked = { runs: 0, artifacts: 0, probes: 0, fills: 0 };
  let runs: CaseRun[];
  try {
    runs = loadCampaign(root);
  } catch (error) {
    return {
      ok: false,
      errors: [String(error instanceof Error ? error.message : error)],
      notes,
      checked,
    };
  }
  for (const run of runs) {
    checked.runs++;
    const label = `${run.manifest.module}/${run.manifest.runId}`;
    checked.artifacts += checkArtifacts(run.dir, run.manifest.artifacts, errors, notes);
    // Probe sources name paycheck-bundle artifacts by case-relative path.
    const latest = latestByPath([
      ...run.manifest.artifacts,
      ...run.paychecks.flatMap((pc) =>
        pc.manifest.artifacts.map((ref) => ({
          path: `${relative(run.dir, pc.dir)}/${ref.path}`,
          sha256: ref.sha256,
        })),
      ),
    ]);
    for (const pc of run.paychecks)
      checked.artifacts += checkArtifacts(pc.dir, pc.manifest.artifacts, errors, notes);
    for (const p of run.manifest.probes) {
      checked.probes++;
      try {
        const superseded = sourceRefs(p).filter(
          (ref) => (latest.get(ref.path)?.sha256 ?? ref.sha256) !== ref.sha256,
        );
        if (superseded.length > 0) {
          notes.push(
            `${label}: probe "${p.name}" reads ${superseded.map((r) => r.path).join(", ")}, overwritten by a later write of the same path; derived from the surviving bytes`,
          );
        }
        const forms = deriveProbe(run, p, latest);
        if (!forms.includes(p.observed)) {
          errors.push(
            `${label}: probe "${p.name}" recorded ${p.observed}, raw artifacts give ${forms.join(" | ")}`,
          );
        }
        if (p.pass !== p.expected.includes(p.observed)) {
          errors.push(`${label}: probe "${p.name}" pass flag does not follow its expectation`);
        }
      } catch (error) {
        errors.push(
          `${label}: probe "${p.name}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const pass =
      run.manifest.error === null &&
      run.manifest.probes.length > 0 &&
      run.manifest.probes.every((p) => p.pass);
    if (pass !== run.manifest.observed.pass)
      errors.push(`${label}: observed.pass does not follow its probes`);
    for (const pc of run.paychecks) {
      for (const leg of pc.manifest.legs) {
        if (!leg.executed) continue;
        checked.fills++;
        try {
          const tx = readArtifactJson<ParsedTx>(pc.dir, leg.executed.transaction);
          const [event] = legExecutedFromLogs(tx.result?.meta.logMessages ?? []);
          if (!event) throw new IntegrityError("no LegExecuted in the fill's transaction");
          const cost = fillCost({ ...event, decimals: assetBySymbol(leg.symbol).decimals });
          if (
            String(cost.allInCostBps) !== leg.executed.allInCostBps ||
            String(cost.premiumBps) !== leg.executed.premiumBps
          ) {
            errors.push(
              `${label} ${leg.symbol}: crank recorded premium ${leg.executed.premiumBps} / all-in ${leg.executed.allInCostBps} bps, raw gives ${cost.premiumBps} / ${cost.allInCostBps}`,
            );
          }
          if (event.outAmount.toString() !== leg.executed.outAmount) {
            errors.push(`${label} ${leg.symbol}: recorded out_amount differs from the event`);
          }
        } catch (error) {
          errors.push(
            `${label} ${leg.symbol}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }
  const path = summaryPath(root);
  if (!existsSync(path)) {
    errors.push(`${path} is missing`);
  } else {
    try {
      const rebuilt = toJson(buildSummary(root));
      const stored = readFileSync(path, "utf8");
      if (rebuilt !== stored) errors.push(...summaryDiff(JSON.parse(stored), JSON.parse(rebuilt)));
    } catch (error) {
      errors.push(
        `summary rebuild failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { ok: errors.length === 0, errors, notes, checked };
}

/** Paths where the stored summary and the rebuilt one disagree. */
export function summaryDiff(stored: unknown, rebuilt: unknown, path = "summary"): string[] {
  if (JSON.stringify(stored) === JSON.stringify(rebuilt)) return [];
  if (
    typeof stored !== "object" ||
    typeof rebuilt !== "object" ||
    stored === null ||
    rebuilt === null ||
    Array.isArray(stored) !== Array.isArray(rebuilt)
  ) {
    return [`${path}: stored ${JSON.stringify(stored)}, rebuilt ${JSON.stringify(rebuilt)}`];
  }
  const keys = new Set([...Object.keys(stored), ...Object.keys(rebuilt)]);
  const out: string[] = [];
  for (const key of keys) {
    out.push(
      ...summaryDiff(
        (stored as Record<string, unknown>)[key],
        (rebuilt as Record<string, unknown>)[key],
        `${path}.${key}`,
      ),
    );
    if (out.length > 20) break;
  }
  return out;
}
