"use client";

import { api } from "@paycheck-router/shared";
import { getWallets } from "@wallet-standard/app";
import { apiRequest } from "@/lib/api/client.ts";
import {
  connectAccount,
  isSigningWallet,
  type SigningWallet,
  signTransactionBase64,
  WalletProblem,
} from "./wallets.ts";

/** The wallet the user signed in with, found again by name after a reload. */
export function findWallet(name: string | null): SigningWallet | null {
  const wallets = getWallets().get().filter(isSigningWallet);
  return wallets.find((w) => w.name === name) ?? wallets[0] ?? null;
}

export type Signer = {
  /** The wallet the session was signed in with. */
  walletName: string | null;
  /** The address the session was signed in as; only it can sign for this router. */
  address: string;
};

/**
 * Signs a builder's transaction with the user's wallet and broadcasts it through the API. Stops
 * before signing when the wallet is gone or now on another account than the session's.
 */
export async function signAndSubmit(
  signer: Signer,
  built: api.TxBuildResponse,
  kind: api.SubmitTxKind,
  legId?: string,
): Promise<api.SubmitTxResponse> {
  const wallet = findWallet(signer.walletName);
  if (!wallet) throw new WalletProblem("unavailable", signer.walletName, signer.address);
  const account = await connectAccount(wallet);
  if (account.address !== signer.address) {
    throw new WalletProblem("wrongAccount", wallet.name, signer.address);
  }
  const tx = await signTransactionBase64(wallet, account, built.tx);
  const body: api.SubmitTxRequest = legId ? { tx, kind, legId } : { tx, kind };
  return apiRequest("/tx/submit", api.SubmitTxResponse, { method: "POST", body });
}
