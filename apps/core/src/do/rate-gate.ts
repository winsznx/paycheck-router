import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env.ts";

export type Upstream = "jupiter" | "helius-send" | "hermes";

/** Section 8.10: Jupiter's free key allows 1 request/s; Helius free sends 1/s. */
export const UPSTREAM_LIMITS: Record<Upstream, { perSecond: number; burst: number }> = {
  jupiter: { perSecond: 1, burst: 1 },
  "helius-send": { perSecond: 1, burst: 1 },
  hermes: { perSecond: 10, burst: 10 },
};

/** Longest a caller is told to wait before the gate turns it away. */
const MAX_QUEUE_MS = 30_000;

export type Reservation =
  | { granted: true; waitMs: number }
  | { granted: false; retryAfterMs: number };

/**
 * One instance per upstream (`idFromName(upstream)`). A token bucket where a negative balance is
 * the queue: each reservation is told exactly how long to wait for its slot, so callers across
 * every Worker share one budget without polling.
 */
export class RateGate extends DurableObject<Env> {
  private tokens: number | null = null;
  private updatedAt = 0;

  reserve(upstream: Upstream, nowMs: number = Date.now()): Reservation {
    const { perSecond, burst } = UPSTREAM_LIMITS[upstream];
    if (this.tokens === null) {
      this.tokens = burst;
      this.updatedAt = nowMs;
    }
    const elapsed = Math.max(0, nowMs - this.updatedAt);
    this.tokens = Math.min(burst, this.tokens + (elapsed / 1000) * perSecond);
    this.updatedAt = nowMs;
    const waitMs = this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) / perSecond) * 1000);
    if (waitMs > MAX_QUEUE_MS) return { granted: false, retryAfterMs: waitMs };
    this.tokens -= 1;
    return { granted: true, waitMs };
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waits for a slot on `upstream`; throws when the queue is longer than the gate allows. */
export async function throughGate(
  namespace: DurableObjectNamespace<RateGate>,
  upstream: Upstream,
): Promise<void> {
  const stub = namespace.get(namespace.idFromName(upstream));
  const reservation = await stub.reserve(upstream);
  if (!reservation.granted) {
    throw new Error(`${upstream} rate gate is full; retry in ${reservation.retryAfterMs} ms`);
  }
  if (reservation.waitMs > 0) await sleep(reservation.waitMs);
}
