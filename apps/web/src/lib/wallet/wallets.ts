"use client";

import {
  SolanaSignIn,
  type SolanaSignInFeature,
  SolanaSignMessage,
  type SolanaSignMessageFeature,
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";
import { useSyncExternalStore } from "react";
import { SOLANA_CHAIN } from "./chain.ts";

/** A Wallet Standard wallet that can sign in and sign transactions on the active chain. */
export type SigningWallet = Wallet & {
  features: StandardConnectFeature &
    SolanaSignTransactionFeature &
    Partial<SolanaSignInFeature & SolanaSignMessageFeature>;
};

export function isSigningWallet(wallet: Wallet): wallet is SigningWallet {
  const features = wallet.features;
  return (
    wallet.chains.includes(SOLANA_CHAIN) &&
    StandardConnect in features &&
    SolanaSignTransaction in features &&
    (SolanaSignIn in features || SolanaSignMessage in features)
  );
}

const EMPTY: readonly SigningWallet[] = [];
let snapshot: readonly SigningWallet[] = EMPTY;

function refresh(): void {
  snapshot = getWallets().get().filter(isSigningWallet);
}

function subscribe(onChange: () => void): () => void {
  const wallets = getWallets();
  refresh();
  const handle = () => {
    refresh();
    onChange();
  };
  const offRegister = wallets.on("register", handle);
  const offUnregister = wallets.on("unregister", handle);
  return () => {
    offRegister();
    offUnregister();
  };
}

/** Detected wallets, in registration order; the demo signer registers first in demo builds. */
export function useWallets(): readonly SigningWallet[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
}

export async function connectAccount(wallet: SigningWallet): Promise<WalletAccount> {
  const { accounts } = await wallet.features[StandardConnect].connect();
  const account = accounts.find((a) => a.chains.includes(SOLANA_CHAIN)) ?? accounts[0];
  if (!account) throw new Error(`${wallet.name} returned no account`);
  return account;
}

/** Signs a base64 wire transaction and returns the signed transaction as base64. */
export async function signTransactionBase64(
  wallet: SigningWallet,
  account: WalletAccount,
  txBase64: string,
): Promise<string> {
  const transaction = Uint8Array.from(atob(txBase64), (char) => char.charCodeAt(0));
  const [output] = await wallet.features[SolanaSignTransaction].signTransaction({
    account,
    transaction,
    chain: SOLANA_CHAIN,
  });
  if (!output) throw new Error(`${wallet.name} returned no signed transaction`);
  return bytesToBase64(output.signedTransaction);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
