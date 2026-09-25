import { type api, assetByMint, type LegRecord } from "@paycheck-router/shared";
import { multiplierFromE12, sharesUi } from "../chain/shares.ts";
import { FORK_MANIFEST, FORK_REPORT } from "./generated/fork-bundle.ts";

const BUNDLE_PATH = "evidence/stocklana-fork";
const REPO = "https://github.com/winsznx/paycheck-router";

const blob = (path: string) => `${REPO}/blob/main/${BUNDLE_PATH}/${path}`;

const EXECUTED_STATES = new Set(["EXECUTED", "VERIFIED", "UNVERIFIED"]);

function reportSlice(index: number) {
  return FORK_REPORT.slices.find((slice) => slice.index === index);
}

function proofLeg(leg: LegRecord): api.ProofLeg | null {
  const executed = leg.executed;
  const paycheck = FORK_MANIFEST.paycheck;
  if (!executed || !paycheck) return null;
  const slice = reportSlice(leg.index);
  const decimals = assetByMint(leg.mint)?.decimals ?? 0;
  const uiMultiplier = multiplierFromE12(BigInt(executed.multiplierE12));
  const verified = leg.verification?.state === "VERIFIED" && slice?.pass === true;
  return {
    signature: executed.signature,
    mint: leg.mint,
    symbol: leg.symbol,
    amountIn: executed.amountIn,
    outAmount: executed.outAmount,
    fee: executed.fee,
    issuerFee: executed.issuerFee,
    uiMultiplier,
    sharesUi: sharesUi(BigInt(executed.outAmount), decimals, uiMultiplier),
    refPriceE9: executed.refPriceE9,
    execPriceE9: null,
    premiumBps: Number(executed.premiumBps),
    executedAt: null,
    paycheck: {
      seq: paycheck.seq,
      inflow: paycheck.inflow,
      investTotal: paycheck.investTotal,
      recordedSig: paycheck.recordSignature,
      recordedAt: null,
    },
    verification: leg.verification
      ? {
          rpcProvider: "surfnet (fork)",
          finalizedSlot: String(executed.slot),
          ownerDeltaRaw: executed.outAmount,
          ownerUsdcDelta: `-${executed.amountIn}`,
          recomputedMinOut: executed.minOut,
          recomputedPremiumBps: Number(executed.premiumBps),
          matches: verified,
          diff: {
            verifierChecks: leg.verification.checks,
            bundleFindings: slice?.findings ?? [],
          },
          createdAt: leg.verification.verifiedAt,
        }
      : null,
    links: [
      { label: "execute transaction (raw)", url: blob(executed.transaction.path) },
      { label: "Paycheck readback (raw)", url: blob(executed.readback.path) },
      { label: "Run manifest", url: blob("manifest.json") },
    ],
  };
}

/**
 * `/proof` from the committed canonical fork bundle. Totals come from the manifest; whether a
 * slice counts as verified comes from `@paycheck-router/verify` re-deriving it from the raw
 * artifacts at build time.
 */
export function bundleProof(environment: api.Environment): api.ProofResponse {
  const legs = FORK_MANIFEST.legs;
  const executed = legs.filter((leg) => EXECUTED_STATES.has(leg.state));
  const waits: Record<string, number> = {};
  for (const leg of legs) {
    if (leg.state === "WAITING" && leg.waitReason) {
      waits[leg.waitReason] = (waits[leg.waitReason] ?? 0) + 1;
    }
  }
  return {
    environment,
    fork: true,
    programId: FORK_MANIFEST.programId,
    campaign: {
      paychecks: FORK_MANIFEST.paycheck ? 1 : 0,
      slicesExecuted: executed.length,
      slicesVerified: executed.filter(
        (leg) => leg.verification?.state === "VERIFIED" && reportSlice(leg.index)?.pass === true,
      ).length,
      waitsByReason: waits,
      medianSecondsToShares: null,
    },
    recentLegs: executed.map(proofLeg).filter((leg) => leg !== null),
    bundle: {
      runId: FORK_MANIFEST.runId,
      path: BUNDLE_PATH,
      forkStartSlot: FORK_REPORT.forkStartSlot,
      programExecutableHash: FORK_MANIFEST.programExecutableHash,
      programSource: FORK_MANIFEST.programSource,
      artifactsChecked: FORK_REPORT.artifacts.checked,
      artifactsFailed: FORK_REPORT.artifacts.failed,
      pass: FORK_REPORT.pass,
      slices: legs.map((leg) => ({
        symbol: leg.symbol,
        mint: leg.mint,
        amountIn: leg.amountIn,
        state: leg.state,
        waitReason: leg.waitReason,
        verified: reportSlice(leg.index)?.pass === true,
        findings: reportSlice(leg.index)?.findings ?? [],
      })),
    },
    asOf: FORK_MANIFEST.finishedAt ?? FORK_MANIFEST.startedAt,
  };
}

export function bundleProofLeg(signature: string): api.ProofLeg | null {
  const leg = FORK_MANIFEST.legs.find((candidate) => candidate.executed?.signature === signature);
  return leg ? proofLeg(leg) : null;
}
