import type { api } from "@paycheck-router/shared";
import { investProgress, paycheckNumber } from "./paycheck-view.ts";

export type InvestPoint = {
  id: string;
  /** People count paychecks from 1. */
  number: string;
  recordedAt: string;
  /** Raw USDC swapped into shares by this paycheck's slices. */
  bought: bigint;
  /** Raw USDC swapped into shares by this and every earlier paycheck. */
  total: bigint;
  /** Raw USDC in this paycheck's slices that are still pending, executing or waiting. */
  open: bigint;
};

/** Paychecks oldest first, with what each one bought and the running total. */
export function investHistory(paychecks: readonly api.PaycheckSummary[]): InvestPoint[] {
  const ordered = [...paychecks].sort((a, b) =>
    BigInt(a.seq) < BigInt(b.seq) ? -1 : BigInt(a.seq) > BigInt(b.seq) ? 1 : 0,
  );
  let total = 0n;
  return ordered.map((paycheck) => {
    const { open, bought } = investProgress(paycheck.legs);
    total += bought;
    return {
      id: paycheck.id,
      number: paycheckNumber(paycheck.seq),
      recordedAt: paycheck.recordedAt,
      bought,
      total,
      open,
    };
  });
}
