"use client";

import { FORK_KEYS } from "@paycheck-router/shared";
import { createKeyPairFromBytes, getAddressFromPublicKey, getBase58Encoder } from "@solana/kit";
import { registerWallet } from "@wallet-standard/wallet";
import { KeyPairAccount, KeyPairWallet } from "./keypair-wallet.ts";

/**
 * The in-app demo signer (PRD 4 "Signing"): a Wallet Standard wallet backed by the fork-only
 * demo-worker keypair, so a recording or Playwright can sign on a surfnet where extension
 * wallets cannot. It is imported only behind `NEXT_PUBLIC_ENVIRONMENT === "demo"`, and
 * scripts/assert-no-demo-signer.mjs fails any other build that contains DEMO_SIGNER_MARKER.
 */
export const DEMO_SIGNER_MARKER = "paycheck-router:demo-signer";
export const DEMO_SIGNER_NAME = "Paycheck Router demo signer";

const ICON =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjZmFiMjE5Ii8+PHJlY3QgeD0iNSIgeT0iMTciIHdpZHRoPSI2IiBoZWlnaHQ9IjEwIiBmaWxsPSIjMGEwYTBmIi8+PHJlY3QgeD0iMTMiIHk9IjExIiB3aWR0aD0iNiIgaGVpZ2h0PSIxNiIgZmlsbD0iIzBhMGEwZiIvPjxyZWN0IHg9IjIxIiB5PSI1IiB3aWR0aD0iNiIgaGVpZ2h0PSIyMiIgZmlsbD0iIzBhMGEwZiIvPjwvc3ZnPg==" as const;

/** The shared keypair wallet, marked so scripts/assert-no-demo-signer.mjs can find it. */
class DemoSignerWallet extends KeyPairWallet {
  readonly marker = DEMO_SIGNER_MARKER;
}

let registration: Promise<void> | null = null;

/** Loads the fork-only secret from the dev route and registers the wallet once per page. */
export function registerDemoSigner(): Promise<void> {
  registration ??= (async () => {
    const response = await fetch("/api/demo-signer", { cache: "no-store" });
    if (!response.ok) throw new Error(`Demo signer unavailable (${response.status})`);
    const { secretKey } = (await response.json()) as { secretKey: string };
    const bytes = new Uint8Array(getBase58Encoder().encode(secretKey));
    const keyPair = await createKeyPairFromBytes(bytes, false);
    const address = await getAddressFromPublicKey(keyPair.publicKey);
    if (address !== FORK_KEYS["demo-worker"]) {
      throw new Error(`Demo signer key ${address} is not the fork demo-worker key`);
    }
    const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
    registerWallet(
      new DemoSignerWallet(DEMO_SIGNER_NAME, ICON, keyPair, new KeyPairAccount(address, publicKey)),
    );
  })();
  return registration;
}
