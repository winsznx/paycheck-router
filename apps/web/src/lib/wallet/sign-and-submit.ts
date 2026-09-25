"use client";

import { api } from "@paycheck-router/shared";
import { getWallets } from "@wallet-standard/app";
import { apiRequest } from "@/lib/api/client.ts";
import {
  connectAccount,
  isSigningWallet,
  type SigningWallet,
  signTransactionBase64,
} from "./wallets.ts";

/** The wallet the user signed in with, found again by name after a reload. */
export function findWallet(name: string | null): SigningWallet | null {
  const wallets = getWallets().get().filter(isSigningWallet);
  return wallets.find((w) => w.name === name) ?? wallets[0] ?? null;
}

/** Signs a builder's transaction with the user's wallet and broadcasts it through the API. */
export async function signAndSubmit(
  walletName: string | null,
  built: api.TxBuildResponse,
  kind: api.SubmitTxKind,
  legId?: string,
): Promise<api.SubmitTxResponse> {
  const wallet = findWallet(walletName);
  if (!wallet) throw new Error("No wallet is available to sign");
  const account = await connectAccount(wallet);
  const tx = await signTransactionBase64(wallet, account, built.tx);
  const body: api.SubmitTxRequest = legId ? { tx, kind, legId } : { tx, kind };
  return apiRequest("/tx/submit", api.SubmitTxResponse, { method: "POST", body });
}
