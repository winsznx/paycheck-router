/**
 * Public build-time configuration. Every `process.env.NEXT_PUBLIC_*` reference is written out
 * literally so Next inlines it and dead-code-eliminates demo-only branches in other builds.
 */

export const ENVIRONMENTS = ["local", "demo", "staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

function parseEnvironment(value: string | undefined): Environment {
  return (ENVIRONMENTS as readonly string[]).includes(value ?? "")
    ? (value as Environment)
    : "local";
}

export const environment: Environment = parseEnvironment(process.env.NEXT_PUBLIC_ENVIRONMENT);

export const isDemo = process.env.NEXT_PUBLIC_ENVIRONMENT === "demo";

/** local and demo run against a Surfpool fork of mainnet (PRD 4). */
export const isForkEnvironment = environment === "local" || environment === "demo";

/** Flipped when the program is live on mainnet; until then public pages carry the fork label. */
export const mainnetDeployed = process.env.NEXT_PUBLIC_MAINNET_DEPLOYED === "true";

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

/** Explorer link for a signature or address: fork runs open the surfnet via cluster=custom. */
export function explorerUrl(kind: "tx" | "address", value: string): string {
  const base = `https://explorer.solana.com/${kind}/${value}`;
  if (!isForkEnvironment) return base;
  const params = new URLSearchParams({ cluster: "custom", customUrl: surfnetRpcUrl });
  return `${base}?${params.toString()}`;
}
