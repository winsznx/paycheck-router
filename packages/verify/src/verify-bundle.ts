/**
 * Re-derives every claim in a fork run's evidence bundle from its raw artifacts: artifact hashes,
 * each executed slice's LegExecuted event, balance changes, Paycheck readback, reference prices
 * and Hermes history, and each waiting slice's reason from its simulation logs or Hermes'
 * refusal.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyFailure,
  getPaycheckDecoder,
  HermesUpdateResponse,
  legExecutedFromLogs,
  legExecutedView,
  type ParsedTransactionView,
  verifyLeg,
} from "@paycheck-router/sdk";
import {
  type ArtifactRef,
  assetByMint,
  FORK_KEYS,
  type LegRecord,
  MANIFEST_FILE,
  RunManifest,
  USDC_FEED_ID,
  USDC_MINT,
  WaitReason,
} from "@paycheck-router/shared";
import { type Address, getBase64Encoder } from "@solana/kit";

export type Finding = { name: string; pass: boolean; detail: string };

export type SliceReport = {
  index: number;
  symbol: string;
  claimed: string;
  pass: boolean;
  findings: Finding[];
};

export type BundleReport = {
  runId: string;
  environment: string;
  forkStartSlot: number | null;
  artifacts: { checked: number; failed: string[] };
  slices: SliceReport[];
  pass: boolean;
};

class Bundle {
  constructor(readonly dir: string) {}

  read(ref: ArtifactRef): string {
    return readFileSync(resolve(this.dir, ref.path), "utf8");
  }

  hashMatches(ref: ArtifactRef): boolean {
    const content = readFileSync(resolve(this.dir, ref.path));
    return createHash("sha256").update(content).digest("hex") === ref.sha256;
  }
}

function finding(name: string, pass: boolean, detail: string): Finding {
  return { name, pass, detail };
}

async function checkExecuted(bundle: Bundle, leg: LegRecord, owner: Address): Promise<Finding[]> {
  const executed = leg.executed;
  if (!executed) return [finding("executed record present", false, "missing")];
  const asset = assetByMint(leg.mint);
  if (!asset) return [finding("registered asset", false, leg.mint)];
  const findings: Finding[] = [];
  const tx = (
    JSON.parse(bundle.read(executed.transaction)) as {
      result: ParsedTransactionView & { meta: { logMessages: string[] } };
    }
  ).result;
  const [decoded] = legExecutedFromLogs(tx.meta.logMessages ?? []);
  if (!decoded) return [finding("LegExecuted in the transaction logs", false, "not found")];
  const event = legExecutedView(decoded);
  const claims: [string, string, string][] = [
    ["amount_in", executed.amountIn, event.amountIn.toString()],
    ["fee", executed.fee, event.fee.toString()],
    ["out_amount", executed.outAmount, event.outAmount.toString()],
    ["issuer_fee", executed.issuerFee, event.issuerFee.toString()],
    ["min_out", executed.minOut, event.minOut.toString()],
    ["ref_price_e9", executed.refPriceE9, event.refPriceE9.toString()],
    ["usdc_price_e9", executed.usdcPriceE9, event.usdcPriceE9.toString()],
  ];
  for (const [name, claimed, derived] of claims) {
    findings.push(
      finding(`${name} matches LegExecuted`, claimed === derived, `${claimed} vs ${derived}`),
    );
  }

  const readback = JSON.parse(bundle.read(executed.readback)) as {
    result: { value: { data: [string, string] } | null };
  };
  const legState = readback.result.value
    ? getPaycheckDecoder().decode(
        Uint8Array.from(getBase64Encoder().encode(readback.result.value.data[0])),
      ).legs[leg.index]
    : undefined;

  const attempt = leg.attempts.find((a) => a.signatures.includes(executed.signature));
  const posted = attempt?.hermesUpdate
    ? HermesUpdateResponse.parse(JSON.parse(bundle.read(attempt.hermesUpdate)))
    : null;
  const histories = executed.history.map((ref) =>
    HermesUpdateResponse.parse(JSON.parse(bundle.read(ref))),
  );
  const feedId =
    event.priceSource === "PythRegular"
      ? asset.feedId
      : event.priceSource === "Pyth247"
        ? asset.feedId247
        : null;
  const attestation = attempt?.attestation;
  const result = await verifyLeg({
    event,
    transaction: tx,
    owner,
    usdcMint: USDC_MINT,
    decimals: asset.decimals,
    postedUpdate: posted,
    history: {
      binary: { encoding: "base64", data: histories.flatMap((h) => h.binary.data) },
      parsed: histories.flatMap((h) => h.parsed),
    },
    feedId,
    usdcFeedId: USDC_FEED_ID,
    readback: legState
      ? {
          executed: legState.status === 1,
          amountIn: legState.amountIn,
          outAmount: legState.outAmount,
          fee: legState.fee,
          issuerFee: legState.issuerFee,
          refPriceE9: legState.refPriceE9,
          executedAt: legState.executedAt,
        }
      : null,
    attestation: attestation
      ? {
          attester: attestation.attester as Address,
          signature: Uint8Array.from(attestation.signature.match(/../g) ?? [], (h) =>
            Number.parseInt(h, 16),
          ),
        }
      : null,
  });
  for (const check of result.checks) {
    findings.push(
      finding(check.name, check.pass, `expected ${check.expected}, got ${check.actual}`),
    );
  }
  findings.push(
    finding(
      "manifest verification state re-derives",
      leg.verification?.state === result.state,
      `${leg.verification?.state ?? "none"} vs ${result.state}`,
    ),
  );
  return findings;
}

function checkWaiting(bundle: Bundle, leg: LegRecord): Finding[] {
  const last = leg.attempts.at(-1);
  if (!last) return [finding("an attempt backs the wait", false, "no attempts")];
  if (leg.waitReason === WaitReason.PRICE_UNAVAILABLE) {
    const named = last.priceRejections.filter((r) => r.status === 403 && r.body.includes(r.feedId));
    return [
      finding(
        "Hermes refused the slice's feed by name",
        named.length > 0 && last.signatures.length === 0,
        named.map((r) => `${r.status} ${r.feedId}`).join(", ") || "no refusal recorded",
      ),
    ];
  }
  if (!last.simulation) {
    return [finding("simulation logs back the wait", false, "no simulation recorded")];
  }
  const { err, logs } = JSON.parse(bundle.read(last.simulation.logs)) as {
    err: unknown;
    logs: string[];
  };
  const failure = classifyFailure(err, logs);
  const derived =
    failure.kind === "program"
      ? failure.reason
      : failure.kind === "landing"
        ? WaitReason.LANDING
        : null;
  return [
    finding(
      "wait reason re-derives from the simulation logs",
      derived === leg.waitReason,
      `${leg.waitReason} vs ${derived ?? failure.kind}`,
    ),
  ];
}

export async function verifyBundle(dir: string): Promise<BundleReport> {
  const bundle = new Bundle(dir);
  const manifest = RunManifest.parse(JSON.parse(readFileSync(resolve(dir, MANIFEST_FILE), "utf8")));
  const failedArtifacts = manifest.artifacts
    .filter((ref) => !bundle.hashMatches(ref))
    .map((r) => r.path);
  const owner = (manifest.router?.owner ?? FORK_KEYS["demo-worker"]) as Address;
  const slices: SliceReport[] = [];
  for (const leg of manifest.legs) {
    let findings: Finding[];
    try {
      findings =
        leg.state === "VERIFIED" || leg.state === "UNVERIFIED" || leg.state === "EXECUTED"
          ? await checkExecuted(bundle, leg, owner)
          : leg.state === "WAITING"
            ? checkWaiting(bundle, leg)
            : [
                finding(
                  "slice reached an outcome",
                  false,
                  `${leg.state}: ${leg.attempts.at(-1)?.error ?? "no attempt"}`,
                ),
              ];
    } catch (error) {
      findings = [
        finding(
          "artifacts readable",
          false,
          error instanceof Error ? error.message : String(error),
        ),
      ];
    }
    const claimed = leg.waitReason ? `${leg.state} ${leg.waitReason}` : leg.state;
    slices.push({
      index: leg.index,
      symbol: leg.symbol,
      claimed,
      pass: findings.every((f) => f.pass),
      findings,
    });
  }
  return {
    runId: manifest.runId,
    environment: manifest.environment,
    forkStartSlot: manifest.fork?.startSlot ?? null,
    artifacts: { checked: manifest.artifacts.length, failed: failedArtifacts },
    slices,
    pass: failedArtifacts.length === 0 && slices.every((s) => s.pass),
  };
}
