import type { api } from "@paycheck-router/shared";

export type CanonicalStatus =
  | "verified"
  | "executed"
  | "unverified"
  | "waiting"
  | "expired"
  | "cancelled";

export type CanonicalSlice = {
  symbol: string;
  mint: string;
  /** Raw USDC. */
  amountIn: string;
  status: CanonicalStatus;
  waitReason: string | null;
  /** Executed: the fill against the reference. Waiting: what the last quote implied. */
  premiumBps: number | null;
};

export type CanonicalPaycheck = {
  seq: string;
  /** Raw USDC. */
  inflow: string;
  recordedAt: string;
  recordedSig: string;
  fork: boolean;
  slices: CanonicalSlice[];
};

const STATUS: Record<string, CanonicalStatus> = {
  VERIFIED: "verified",
  EXECUTED: "executed",
  UNVERIFIED: "unverified",
  WAITING: "waiting",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
};

/**
 * The first paycheck on /proof with every slice it split into. The fork bundle carries all of
 * them, waiting ones included; without a bundle only executed slices are known.
 */
export function canonicalPaycheck(proof: api.ProofResponse): CanonicalPaycheck | null {
  const first = proof.recentLegs[0];
  if (!first) return null;
  const bundled = proof.bundle?.slices ?? [];
  const slices: CanonicalSlice[] =
    bundled.length > 0
      ? bundled.map((slice) => ({
          symbol: slice.symbol,
          mint: slice.mint,
          amountIn: slice.amountIn,
          status: STATUS[slice.state] ?? "waiting",
          waitReason: slice.waitReason,
          premiumBps: slice.premiumBps ?? null,
        }))
      : proof.recentLegs
          .filter((leg) => leg.paycheck.recordedSig === first.paycheck.recordedSig)
          .map((leg) => ({
            symbol: leg.symbol,
            mint: leg.mint,
            amountIn: leg.amountIn,
            status: leg.verification?.matches ? "verified" : "executed",
            waitReason: null,
            premiumBps: leg.premiumBps,
          }));
  return {
    seq: first.paycheck.seq,
    inflow: first.paycheck.inflow,
    recordedAt: first.paycheck.recordedAt,
    recordedSig: first.paycheck.recordedSig,
    fork: proof.fork,
    slices,
  };
}
