/**
 * Secrets set with `wrangler secret put` (or `.dev.vars` locally). The hot keys are required;
 * provider keys are optional so a feature without its key reports "not configured" instead of
 * pretending to work.
 */
export interface Secrets {
  CRANK_KEY: string;
  RECORDER_KEY: string;
  SPONSOR_KEY: string;
  ATTESTER_KEY: string;
  OPS_KEY?: string;
  /** Fork-only: the employer wallet `POST /demo/paycheck` pays from. */
  EMPLOYER_KEY?: string;
  /** Hosted fork: value of the `X-Surfnet-Key` header its proxy requires. */
  SURFNET_RPC_KEY?: string;
  SESSION_SIGNING_KEY: string;
  HELIUS_API_KEY?: string;
  HELIUS_WEBHOOK_SECRET?: string;
  ALCHEMY_API_KEY?: string;
  JUPITER_API_KEY?: string;
  PYTH_API_KEY?: string;
  PRIVY_APP_SECRET?: string;
  PRIVY_VERIFICATION_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  RESEND_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  VAPID_PRIVATE_KEY?: string;
  CHAINALYSIS_API_KEY?: string;
  TURNSTILE_SECRET?: string;
  PARTNER_WEBHOOK_SIGNING_KEY?: string;
}

type Vars = {
  [K in keyof CloudflareBindings as CloudflareBindings[K] extends string ? K : never]: string;
};

/** Optional variables that are not in every environment's wrangler config. */
type OptionalVars = {
  CORS_ORIGINS?: string;
  /** Read-only RPC for deployments with no surfnet and no Helius key (the public site). */
  PUBLIC_RPC_URL?: string;
  /** `bundle` serves /proof from the committed canonical fork bundle instead of the database. */
  PROOF_SOURCE?: string;
  /** Hosted fork: hours between the fork's resets from its snapshot. */
  RESET_EVERY_HOURS?: string;
};

export type Env = Omit<CloudflareBindings, keyof Vars | keyof OptionalVars> &
  Vars &
  OptionalVars &
  Secrets;
