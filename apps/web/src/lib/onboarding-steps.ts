/** PRD 13.2 steps, in order. */
export const STEPS = [
  "welcome",
  "sign-in",
  "eligibility",
  "wallet",
  "pay-history",
  "split",
  "allowance",
  "review",
  "done",
] as const;
export type Step = (typeof STEPS)[number];

export function isStep(value: string): value is Step {
  return (STEPS as readonly string[]).includes(value);
}
