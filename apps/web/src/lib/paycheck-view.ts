import { type api, FORK_KEYS } from "@paycheck-router/shared";
import type { SegmentState, SliceStatus, SplitSegment } from "@paycheck-router/ui/components";
import { isSeriesSlot, type SeriesSlot } from "@paycheck-router/ui/tokens";
import { isForkEnvironment } from "./env.ts";

type AnyLeg = api.Leg;

const SEGMENT_STATE: Record<api.LegStatus, SegmentState> = {
  pending: "planned",
  executing: "filling",
  executed: "filled",
  verified: "filled",
  unverified: "filled",
  waiting: "waiting",
  expired: "empty",
  cancelled: "empty",
};

export const segmentState = (status: api.LegStatus): SegmentState => SEGMENT_STATE[status];

/** API leg statuses match the status chip states one to one. */
export const chipStatus = (status: api.LegStatus): SliceStatus => status;

/** Router legs keep their colour slot for life (PRD 14.2); the API numbers slots from 0. */
export function colorSlotFor(
  mint: string,
  fallbackIndex: number,
  routerLegs: readonly api.RouterLeg[] | undefined,
): SeriesSlot {
  const slot = (routerLegs?.find((leg) => leg.mint === mint)?.colorSlot ?? fallbackIndex) + 1;
  return isSeriesSlot(slot) ? slot : 1;
}

export function bandFor(
  mint: string,
  routerLegs: readonly api.RouterLeg[] | undefined,
): number | null {
  return routerLegs?.find((leg) => leg.mint === mint)?.bandBps ?? null;
}

const BOUGHT: ReadonlySet<api.LegStatus> = new Set(["executed", "verified", "unverified"]);
const OPEN: ReadonlySet<api.LegStatus> = new Set(["pending", "executing", "waiting"]);

/**
 * Raw USDC for the paycheck's slices: what is still to be bought (pending, executing or
 * waiting) and what has been bought. Expired and cancelled slices count as neither; their USDC
 * never left the wallet.
 */
export function investProgress(legs: readonly Pick<AnyLeg, "status" | "amountIn">[]): {
  open: bigint;
  bought: bigint;
} {
  let open = 0n;
  let bought = 0n;
  for (const leg of legs) {
    if (BOUGHT.has(leg.status)) bought += BigInt(leg.amountIn);
    else if (OPEN.has(leg.status)) open += BigInt(leg.amountIn);
  }
  return { open, bought };
}

/** The onchain sequence starts at 0; people count paychecks from 1. */
export const paycheckNumber = (seq: string): string => (BigInt(seq) + 1n).toString();

export type PaycheckPhase = "recording" | "executing" | "waiting" | "complete" | "expired";

/** PRD 13.4 paycheck detail states, derived from the legs. */
export function paycheckPhase(legs: readonly AnyLeg[]): PaycheckPhase {
  if (legs.length === 0) return "recording";
  if (legs.some((l) => l.status === "pending" || l.status === "executing")) return "executing";
  if (legs.some((l) => l.status === "waiting")) return "waiting";
  if (legs.every((l) => l.status === "expired" || l.status === "cancelled")) return "expired";
  return "complete";
}

export function toSegments(
  legs: readonly AnyLeg[],
  routerLegs: readonly api.RouterLeg[] | undefined,
  valueText: (leg: AnyLeg) => string,
  stateText: (leg: AnyLeg) => string | undefined,
): SplitSegment[] {
  return [...legs]
    .sort((a, b) => a.idx - b.idx)
    .map((leg, index) => ({
      key: leg.id,
      asset: leg.mint,
      ticker: leg.symbol,
      weightBps: Number(leg.amountIn),
      colorSlot: colorSlotFor(leg.mint, index, routerLegs),
      state: segmentState(leg.status),
      valueText: valueText(leg),
      stateText: stateText(leg),
    }));
}

const FORK_EMPLOYERS = new Set<string>([
  FORK_KEYS["employer-1"],
  FORK_KEYS["employer-2"],
  FORK_KEYS["employer-3"],
]);

/** Fork runs pay from the fork-only employer keys; they are labelled as the demo employer. */
export function isForkEmployer(sender: string | null): boolean {
  return isForkEnvironment && sender !== null && FORK_EMPLOYERS.has(sender);
}

/** PRD 8.6: a slice waiting on premium offers Buy now two hours after the paycheck. */
export const BUY_NOW_AFTER_MS = 2 * 60 * 60 * 1000;

export function buyNowAvailableAt(leg: AnyLeg, recordedAt: string): number | null {
  if (leg.status !== "waiting" || leg.waitReason !== "PREMIUM_TOO_HIGH") return null;
  return Date.parse(recordedAt) + BUY_NOW_AFTER_MS;
}
