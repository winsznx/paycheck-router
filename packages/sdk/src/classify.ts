import type { Address } from "@solana/kit";

export type InflowRules = {
  owner: Address;
  /** The router's Authority PDA: USDC it sends back is protocol movement, not pay. */
  authority: Address;
  routerMinInflow: bigint;
  /** The owner's own threshold in the app, on top of the onchain minimum. */
  appThreshold: bigint;
  taggedPayersOnly: boolean;
  taggedPayers: ReadonlySet<Address>;
};

export type InflowDecision =
  | { action: "record" }
  | {
      action: "skip";
      reason: "below_minimum" | "untagged_sender" | "self_transfer" | "protocol_movement";
    };

/** Whether one inflow is a paycheck (`record_paycheck`) or not (`skip_inflow`). */
export function classifyInflow(
  inflow: { amount: bigint; sender: Address | null },
  rules: InflowRules,
): InflowDecision {
  if (inflow.sender === rules.authority) return { action: "skip", reason: "protocol_movement" };
  if (inflow.sender === rules.owner) return { action: "skip", reason: "self_transfer" };
  const minimum =
    rules.routerMinInflow > rules.appThreshold ? rules.routerMinInflow : rules.appThreshold;
  if (inflow.amount < minimum) return { action: "skip", reason: "below_minimum" };
  if (
    rules.taggedPayersOnly &&
    (inflow.sender === null || !rules.taggedPayers.has(inflow.sender))
  ) {
    return { action: "skip", reason: "untagged_sender" };
  }
  return { action: "record" };
}
