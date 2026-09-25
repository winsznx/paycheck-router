/**
 * The shape `@paycheck-router/verify`'s `verifyBundle` returns, restated here so the Worker does
 * not import the Node-only verifier at runtime.
 */
export type BundleReport = {
  runId: string;
  environment: string;
  forkStartSlot: number | null;
  artifacts: { checked: number; failed: string[] };
  slices: {
    index: number;
    symbol: string;
    claimed: string;
    pass: boolean;
    findings: { name: string; pass: boolean; detail: string }[];
  }[];
  pass: boolean;
};
