import { isHostedDemo } from "./env.ts";

/** Every step there is; `fund` exists only on the hosted demo, where a new wallet starts empty. */
export type Step =
  | "welcome"
  | "sign-in"
  | "fund"
  | "eligibility"
  | "wallet"
  | "pay-history"
  | "split"
  | "allowance"
  | "review"
  | "done";

/** PRD 13.2 steps, in order, for this build. */
export const STEPS: readonly Step[] = [
  "welcome",
  "sign-in",
  ...(isHostedDemo ? (["fund"] as const) : []),
  "eligibility",
  "wallet",
  "pay-history",
  "split",
  "allowance",
  "review",
  "done",
];

export function isStep(value: string): value is Step {
  return (STEPS as readonly string[]).includes(value);
}

/** Where a step's Continue goes in this build. */
export function nextStepHref(step: Step): string {
  const next = STEPS[STEPS.indexOf(step) + 1] ?? "done";
  return `/app/onboarding/${next}`;
}
