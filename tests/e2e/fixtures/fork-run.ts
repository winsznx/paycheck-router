import { readFileSync } from "node:fs";
import path from "node:path";
import { api } from "@paycheck-router/shared";

/**
 * API responses rebuilt from the recorded fork run (evidence/stocklana-fork/manifest.json), so
 * layout tests use the real longest values: 88-character signatures, 44-character addresses,
 * 64-character feed ids. Test-only; product code never reads this.
 */
export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

type ManifestLeg = {
  index: number;
  mint: string;
  symbol: string;
  amountIn: string;
  bandBps: number;
  state: string;
  waitReason: string | null;
  executed: null | {
    signature: string;
    slot: number;
    fee: string;
    outAmount: string;
    issuerFee: string;
    minOut: string;
    refPriceE9: string;
    multiplierE12: string;
    premiumBps: string;
  };
  verification: null | { state: string; verifiedAt: string };
};

type Manifest = {
  programId: string;
  startedAt: string;
  finishedAt: string;
  feedIds: string[];
  router: {
    address: string;
    owner: string;
    authority: string;
    investBps: number;
    legs: Array<{ mint: string; symbol: string; weightBps: number }>;
  };
  paycheck: {
    address: string;
    seq: string;
    inflow: string;
    investTotal: string;
    sender: string;
    inflowSignature: string;
    recordSignature: string;
  };
  legs: ManifestLeg[];
};

export const manifest = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "evidence/stocklana-fork/manifest.json"), "utf8"),
) as Manifest;

export const ROUTER_ID = "5b1f3d2a-6c4e-4f8a-9b7d-1e2f3a4b5c6d";
export const PAYCHECK_ID = "8a7b6c5d-4e3f-4a1b-8c9d-0e1f2a3b4c5d";

const legId = (index: number, seed = "0") => `${seed}${index}000000-0000-4000-8000-000000000000`;

const scale = (raw: string, decimals: number) => {
  const digits = raw.padStart(decimals + 1, "0");
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
};

const multiplier = (e12: string) => {
  const digits = e12.padStart(13, "0");
  const fraction = digits.slice(-12).replace(/0+$/, "");
  return fraction ? `${digits.slice(0, -12)}.${fraction}` : digits.slice(0, -12);
};

function legFrom(leg: ManifestLeg, seed = "0"): api.Leg {
  const ex = leg.executed;
  const status: api.LegStatus =
    leg.state === "VERIFIED" ? "verified" : leg.state === "WAITING" ? "waiting" : "executed";
  return {
    id: legId(leg.index, seed),
    idx: leg.index,
    mint: leg.mint,
    symbol: leg.symbol,
    amountIn: leg.amountIn,
    status,
    waitReason: (leg.waitReason as api.Leg["waitReason"]) ?? null,
    nextAttemptAt: leg.waitReason ? manifest.finishedAt : null,
    outAmount: ex?.outAmount ?? null,
    fee: ex?.fee ?? null,
    issuerFee: ex?.issuerFee ?? null,
    uiMultiplier: ex ? multiplier(ex.multiplierE12) : null,
    sharesUi: ex ? scale(ex.outAmount, 9) : null,
    refPriceE9: ex?.refPriceE9 ?? null,
    execPriceE9: null,
    premiumBps: ex ? Number(ex.premiumBps) : leg.symbol === "OpenAI" ? 3040 : null,
    executedSig: ex?.signature ?? null,
    executedAt: ex ? manifest.finishedAt : null,
    verifiedAt: leg.verification?.verifiedAt ?? null,
  };
}

export function paycheckSummary(id = PAYCHECK_ID, seed = "0"): api.PaycheckSummary {
  return api.PaycheckSummary.parse({
    id,
    routerId: ROUTER_ID,
    seq: manifest.paycheck.seq,
    paycheckPda: manifest.paycheck.address,
    inflow: manifest.paycheck.inflow,
    investTotal: manifest.paycheck.investTotal,
    sender: manifest.paycheck.sender,
    inflowSig: manifest.paycheck.inflowSignature,
    recordedSig: manifest.paycheck.recordSignature,
    recordedAt: manifest.startedAt,
    expiresAt: manifest.finishedAt,
    status: "open",
    legs: manifest.legs.map((leg) => legFrom(leg, seed)),
  });
}

export const paycheckDetail = api.PaycheckDetail.parse({
  ...paycheckSummary(),
  legs: paycheckSummary().legs.map((leg) => ({
    ...leg,
    attempts: [],
    verification: null,
    links: [],
  })),
  links: [],
});

export const router = api.Router.parse({
  id: ROUTER_ID,
  routerPda: manifest.router.address,
  authorityPda: manifest.router.authority,
  owner: manifest.router.owner,
  payInAta: manifest.router.owner,
  status: "active",
  investBps: manifest.router.investBps,
  minInflow: "20000000",
  appThreshold: null,
  dailyCap: "5000000000",
  maxWaitSecs: 259200,
  autoConvert: true,
  recorder: manifest.router.authority,
  payerRule: "any",
  legs: manifest.router.legs.map((leg, idx) => ({
    mint: leg.mint,
    weightBps: leg.weightBps,
    bandBps: 300,
    idx,
    symbol: leg.symbol,
    enabled: true,
    colorSlot: idx,
  })),
  allowance: { delegate: manifest.router.authority, amount: "1110000000" },
  usdcBalance: "1480000000",
  watermark: "0",
  createdSig: manifest.paycheck.recordSignature,
  createdAt: manifest.startedAt,
});

export const anthropicSignature = (() => {
  const leg = manifest.legs.find((l) => l.symbol === "Anthropic");
  if (!leg?.executed) throw new Error("The recorded run has no executed Anthropic slice");
  return leg.executed.signature;
})();

/** The public proof responses core would serve for the recorded run. */
export function proofLegs(): api.ProofLeg[] {
  return manifest.legs.flatMap((leg) => {
    const ex = leg.executed;
    if (!ex) return [];
    return [
      api.ProofLeg.parse({
        signature: ex.signature,
        mint: leg.mint,
        symbol: leg.symbol,
        amountIn: leg.amountIn,
        outAmount: ex.outAmount,
        fee: ex.fee,
        issuerFee: ex.issuerFee,
        uiMultiplier: multiplier(ex.multiplierE12),
        sharesUi: scale(ex.outAmount, 9),
        refPriceE9: ex.refPriceE9,
        execPriceE9: null,
        premiumBps: Number(ex.premiumBps),
        executedAt: manifest.finishedAt,
        paycheck: {
          seq: manifest.paycheck.seq,
          inflow: manifest.paycheck.inflow,
          investTotal: manifest.paycheck.investTotal,
          recordedSig: manifest.paycheck.recordSignature,
          recordedAt: manifest.startedAt,
        },
        verification: {
          rpcProvider: "surfnet",
          finalizedSlot: String(ex.slot),
          ownerDeltaRaw: ex.outAmount,
          ownerUsdcDelta: `-${leg.amountIn}`,
          recomputedMinOut: ex.minOut,
          recomputedPremiumBps: Number(ex.premiumBps),
          matches: true,
          diff: null,
          createdAt: leg.verification?.verifiedAt ?? manifest.finishedAt,
        },
        links: [],
      }),
    ];
  });
}

export function proofResponse(): api.ProofResponse {
  const waits: Record<string, number> = {};
  for (const leg of manifest.legs) {
    if (leg.waitReason) waits[leg.waitReason] = (waits[leg.waitReason] ?? 0) + 1;
  }
  const legs = proofLegs();
  return api.ProofResponse.parse({
    environment: "demo",
    fork: true,
    programId: manifest.programId,
    campaign: {
      paychecks: 1,
      slicesExecuted: legs.length,
      slicesVerified: legs.length,
      waitsByReason: waits,
      medianSecondsToShares: null,
    },
    recentLegs: legs,
    asOf: manifest.finishedAt,
  });
}
