import type { ChainEnv } from "@paycheck-router/ui/chain";

/**
 * Public build-time configuration. Every `process.env.NEXT_PUBLIC_*` reference is written out
 * literally so Next inlines it and dead-code-eliminates demo-only branches in other builds.
 */

export const ENVIRONMENTS = ["local", "demo", "hosted-demo", "staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

function parseEnvironment(value: string | undefined): Environment {
  return (ENVIRONMENTS as readonly string[]).includes(value ?? "")
    ? (value as Environment)
    : "local";
}

export const environment: Environment = parseEnvironment(process.env.NEXT_PUBLIC_ENVIRONMENT);

export const isDemo = process.env.NEXT_PUBLIC_ENVIRONMENT === "demo";

/**
 * The public demo: the full app against a hosted Surfpool fork that resets every six hours.
 * Visitors sign with a wallet generated in their own browser; the fork RPC stays private to core.
 */
export const isHostedDemo = process.env.NEXT_PUBLIC_ENVIRONMENT === "hosted-demo";

/** local, demo and the hosted demo run against a Surfpool fork of mainnet (PRD 4). */
export const isForkEnvironment =
  environment === "local" || environment === "demo" || environment === "hosted-demo";

/** The public hosted demo, linked from the production site once it's live. */
export const hostedDemoUrl = process.env.NEXT_PUBLIC_HOSTED_DEMO_URL ?? "";

/** Flipped when the program is live on mainnet; until then public pages carry the fork label. */
export const mainnetDeployed = process.env.NEXT_PUBLIC_MAINNET_DEPLOYED === "true";

/**
 * The app runs against a fork locally and in demo builds, and publicly once the program is on
 * mainnet. Before that, a public build has no program or database behind /app, so every /app
 * route shows the launch page and every CTA points at the waitlist (PRD 18.1).
 */
export const appOpen = isForkEnvironment || mainnetDeployed;

export const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);

export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

export const surfnetRpcUrl = process.env.NEXT_PUBLIC_SURFNET_RPC_URL ?? "http://127.0.0.1:8899";

/** RPC used for read-only simulation before signing; fork runs simulate on the surfnet. */
export const rpcUrl =
  process.env.NEXT_PUBLIC_RPC_URL ??
  (isForkEnvironment ? surfnetRpcUrl : "https://api.mainnet-beta.solana.com");

export const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** The fork banner shows in fork environments, and on public pages until the mainnet deploy. */
export function showForkBanner(surface: "app" | "site"): boolean {
  if (isForkEnvironment) return true;
  return surface === "site" && !mainnetDeployed;
}

/** Where chain values link (packages/ui ChainRef): live surfnet, recorded fork bundle or mainnet. */
export const chainEnv: ChainEnv = {
  mode: isHostedDemo
    ? "fork-app"
    : isForkEnvironment
      ? "fork-live"
      : mainnetDeployed
        ? "mainnet"
        : "fork-recorded",
  surfnetRpcUrl,
  repoUrl: "https://github.com/winsznx/paycheck-router",
  evidencePath: "evidence/stocklana-fork",
};
