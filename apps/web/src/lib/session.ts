"use client";

import { api } from "@paycheck-router/shared";
import { SolanaSignIn, SolanaSignMessage } from "@solana/wallet-standard-features";
import { useSyncExternalStore } from "react";
import { ApiProblem } from "./api/problem.ts";
import { ClientSession, SESSION_MARKER_COOKIE, SESSION_ROUTE } from "./api/session-contract.ts";
import { apiUrl } from "./env.ts";
import { clearQueries } from "./query.ts";
import { formatSiwsMessage } from "./wallet/siws.ts";
import { bytesToBase64, connectAccount, type SigningWallet } from "./wallet/wallets.ts";

/**
 * The signed-in session lives in memory; a reload restores it through the HttpOnly refresh
 * cookie on this origin. `restoring` is the state before the first refresh attempt finishes.
 */
export type SessionState =
  | { status: "restoring" }
  | { status: "signed-out" }
  | { status: "signed-in"; session: ClientSession; walletName: string | null };

const WALLET_NAME_KEY = "pr_wallet_name";
const EXPIRY_MARGIN_MS = 30_000;

let state: SessionState = { status: "restoring" };
const listeners = new Set<() => void>();
let refreshing: Promise<ClientSession | null> | null = null;

function setState(next: SessionState) {
  if (next.status === "signed-out" && state.status === "signed-in") clearQueries();
  state = next;
  for (const listener of listeners) listener();
}

function storedWalletName(): string | null {
  try {
    return window.localStorage.getItem(WALLET_NAME_KEY);
  } catch {
    return null;
  }
}

function rememberWalletName(name: string | null) {
  try {
    if (name) window.localStorage.setItem(WALLET_NAME_KEY, name);
    else window.localStorage.removeItem(WALLET_NAME_KEY);
  } catch {
    // Storage can be unavailable in private windows; the wallet picker covers that case.
  }
}

async function readSession(response: Response): Promise<ClientSession> {
  if (!response.ok) throw await ApiProblem.fromResponse(response);
  return ClientSession.parse(await response.json());
}

function hasSessionMarker(): boolean {
  return document.cookie
    .split("; ")
    .some((cookie) => cookie.startsWith(`${SESSION_MARKER_COOKIE}=`));
}

const REFRESH_LOCK = "pr-session-refresh";

/**
 * Core rotates the refresh token on every use and treats a second use of the old one as theft,
 * revoking the whole session. Two tabs restoring at once would both send the same cookie, so
 * refreshes take a browser-wide lock: the second tab waits and sends the cookie the first one
 * received.
 */
async function oneRefreshAtATime(run: () => Promise<Response>): Promise<Response> {
  if (!("locks" in navigator)) return run();
  return await navigator.locks.request(REFRESH_LOCK, run);
}

/**
 * Exchanges the refresh cookie for a new access token; resolves null when signed out. Without
 * the session marker there is no refresh cookie either, so it resolves null without a request.
 */
export function refreshSession(): Promise<ClientSession | null> {
  if (!refreshing && !hasSessionMarker()) {
    if (state.status !== "signed-out") setState({ status: "signed-out" });
    return Promise.resolve(null);
  }
  refreshing ??= oneRefreshAtATime(() =>
    fetch(`${SESSION_ROUTE}/refresh`, { method: "POST", cache: "no-store" }),
  )
    .then(async (response) => {
      if (response.status === 401) {
        setState({ status: "signed-out" });
        return null;
      }
      const session = await readSession(response);
      setState({ status: "signed-in", session, walletName: storedWalletName() });
      return session;
    })
    .catch((error: unknown) => {
      if (state.status === "restoring") setState({ status: "signed-out" });
      throw error;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (state.status === "restoring" && !refreshing) {
    refreshSession().catch(() => undefined);
  }
  return () => listeners.delete(listener);
}

const RESTORING: SessionState = { status: "restoring" };

export function useSession(): SessionState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => RESTORING,
  );
}

/** A valid access token, refreshed when it is about to expire. */
export async function accessToken(): Promise<string | null> {
  if (state.status === "signed-in") {
    const expiresAt = Date.parse(state.session.accessTokenExpiresAt);
    if (expiresAt - Date.now() > EXPIRY_MARGIN_MS) return state.session.accessToken;
  }
  const session = await refreshSession().catch(() => null);
  return session?.accessToken ?? null;
}

/** PRD 12.1: nonce, the wallet signs the SIWS message, the API verifies and issues a session. */
export async function signInWithWallet(wallet: SigningWallet): Promise<ClientSession> {
  const nonceResponse = await fetch(`${apiUrl}/auth/nonce`, { cache: "no-store" });
  if (!nonceResponse.ok) throw await ApiProblem.fromResponse(nonceResponse);
  const nonce = api.NonceResponse.parse(await nonceResponse.json());
  const issuedAt = new Date().toISOString();
  const fields = {
    domain: nonce.domain,
    statement: nonce.statement,
    uri: nonce.uri,
    version: nonce.version,
    chainId: nonce.chainId,
    nonce: nonce.nonce,
    issuedAt,
    expirationTime: nonce.expiresAt,
  };

  let address: string;
  let message: Uint8Array;
  let signature: Uint8Array;
  const signIn = wallet.features[SolanaSignIn];
  if (signIn) {
    const [output] = await signIn.signIn(fields);
    if (!output) throw new Error(`${wallet.name} did not sign in`);
    address = output.account.address;
    message = output.signedMessage;
    signature = output.signature;
  } else {
    const signMessage = wallet.features[SolanaSignMessage];
    if (!signMessage) throw new Error(`${wallet.name} cannot sign messages`);
    const account = await connectAccount(wallet);
    address = account.address;
    message = new TextEncoder().encode(formatSiwsMessage({ ...fields, address }));
    const [output] = await signMessage.signMessage({ account, message });
    if (!output) throw new Error(`${wallet.name} did not sign the message`);
    signature = output.signature;
  }

  const body: api.SiwsRequest = {
    address,
    message: new TextDecoder().decode(message),
    signature: bytesToBase64(signature),
  };
  const session = await readSession(
    await fetch(SESSION_ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  rememberWalletName(wallet.name);
  setState({ status: "signed-in", session, walletName: wallet.name });
  return session;
}

export async function signOut(): Promise<void> {
  await fetch(SESSION_ROUTE, { method: "DELETE" }).catch(() => undefined);
  rememberWalletName(null);
  setState({ status: "signed-out" });
}
