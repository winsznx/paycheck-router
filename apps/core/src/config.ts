import { api } from "@paycheck-router/shared";
import type { Env } from "./env.ts";

export type ChainEndpoints = {
  /** Reads and simulation. */
  rpcUrl: string;
  /** Every endpoint a signed transaction is broadcast to. */
  sendUrls: readonly string[];
  /** The verifier's read path; a different provider from the sender outside surfnets. */
  verifyRpcUrl: string;
  verifyProvider: "surfnet" | "alchemy" | "public-rpc";
  /** True on local, ci and demo: every read and send goes to the surfnet and nowhere else. */
  surfnet: boolean;
  /** Headers every request to the chain endpoint carries (the hosted fork's access key). */
  headers: ChainHeaders;
};

/** Header the hosted fork's proxy requires; the value is the `SURFNET_RPC_KEY` secret. */
export const SURFNET_KEY_HEADER = "x-surfnet-key";

export type ChainHeaders = { [SURFNET_KEY_HEADER]?: string };

const AUTHED = Symbol.for("paycheck-router.surfnet-auth");

type AuthedFetch = typeof fetch & { [AUTHED]?: string };

/**
 * Adds the fork's access header to every `fetch` bound for the surfnet's origin. Core's own
 * clients pass the header explicitly; this covers SDK transports that call the global `fetch`
 * with only a URL (raw JSON-RPC for evidence and cheatcodes). Idempotent per origin.
 */
export function installSurfnetAuth(url: string, key: string): void {
  const origin = new URL(url).origin;
  const current = globalThis.fetch as AuthedFetch;
  if (current[AUTHED] === origin) return;
  const inner = current;
  const wrapped: AuthedFetch = (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.origin !== origin) return inner(input, init);
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set(SURFNET_KEY_HEADER, key);
    return inner(new Request(request, { headers }));
  };
  wrapped[AUTHED] = origin;
  globalThis.fetch = wrapped;
}

export class ConfigError extends Error {}

function required(value: string | undefined, name: string): string {
  if (!value) throw new ConfigError(`${name} is not set`);
  return value;
}

/**
 * With `SURFNET_RPC_URL` set, the surfnet is the only chain endpoint: the Helius send path,
 * Jupiter's landing endpoint and the Alchemy verifier are never used.
 */
export function chainEndpoints(env: Env): ChainEndpoints {
  if (env.SURFNET_RPC_URL) {
    const headers: ChainHeaders = {};
    if (env.SURFNET_RPC_KEY) {
      headers[SURFNET_KEY_HEADER] = env.SURFNET_RPC_KEY;
      installSurfnetAuth(env.SURFNET_RPC_URL, env.SURFNET_RPC_KEY);
    }
    return {
      rpcUrl: env.SURFNET_RPC_URL,
      sendUrls: [env.SURFNET_RPC_URL],
      verifyRpcUrl: env.SURFNET_RPC_URL,
      verifyProvider: "surfnet",
      surfnet: true,
      headers,
    };
  }
  if (!env.HELIUS_RPC_URL && env.PUBLIC_RPC_URL) {
    // Read-only deployment (the public site): reads only, and nothing can be sent.
    return {
      rpcUrl: env.PUBLIC_RPC_URL,
      sendUrls: [],
      verifyRpcUrl: env.PUBLIC_RPC_URL,
      verifyProvider: "public-rpc",
      surfnet: false,
      headers: {},
    };
  }
  const helius = `${required(env.HELIUS_RPC_URL, "HELIUS_RPC_URL")}/?api-key=${required(env.HELIUS_API_KEY, "HELIUS_API_KEY")}`;
  const alchemy = `${required(env.ALCHEMY_RPC_URL, "ALCHEMY_RPC_URL")}/${required(env.ALCHEMY_API_KEY, "ALCHEMY_API_KEY")}`;
  return {
    rpcUrl: helius,
    sendUrls: [helius],
    verifyRpcUrl: alchemy,
    verifyProvider: "alchemy",
    surfnet: false,
    headers: {},
  };
}

export function environment(env: Env): api.Environment {
  return api.Environment.parse(env.ENVIRONMENT);
}

/** SIWS messages carry chain `localnet` on surfnets and `mainnet` everywhere else. */
export function siwsChain(env: Env): api.SiwsChain {
  return env.SURFNET_RPC_URL ? "localnet" : "mainnet";
}

/** Solana Explorer link; on a surfnet it reads the fork through the viewer's browser. */
export function explorerTxUrl(env: Env, signature: string): string {
  const url = new URL(`https://explorer.solana.com/tx/${signature}`);
  if (env.SURFNET_RPC_URL) {
    url.searchParams.set("cluster", "custom");
    url.searchParams.set("customUrl", env.SURFNET_RPC_URL);
  }
  return url.toString();
}

export function explorerAddressUrl(env: Env, address: string): string {
  const url = new URL(`https://explorer.solana.com/address/${address}`);
  if (env.SURFNET_RPC_URL) {
    url.searchParams.set("cluster", "custom");
    url.searchParams.set("customUrl", env.SURFNET_RPC_URL);
  }
  return url.toString();
}

function list(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Origins allowed by CORS: `APP_ORIGIN` plus any extra `CORS_ORIGINS` (comma-separated). */
export function allowedOrigins(env: Env): Set<string> {
  return new Set([...list(env.APP_ORIGIN), ...list(env.CORS_ORIGINS ?? "")]);
}

/** Domains a SIWS message may name; the first is the one `/auth/nonce` advertises. */
export function siwsDomains(env: Env): string[] {
  return list(env.SIWS_DOMAIN);
}

/** A binding some environments leave out (the public site has no queues or database). */
export function binding<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new ConfigError(`${name} is not bound in this environment`);
  return value;
}
