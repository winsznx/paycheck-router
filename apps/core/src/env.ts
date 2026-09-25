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
type OptionalVars = { CORS_ORIGINS?: string };

export type Env = Omit<CloudflareBindings, keyof Vars> & Vars & OptionalVars & Secrets;
