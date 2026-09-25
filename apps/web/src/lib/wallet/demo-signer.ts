"use client";

import { FORK_KEYS } from "@paycheck-router/shared";
import {
  createKeyPairFromBytes,
  getAddressFromPublicKey,
  getBase58Encoder,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  signBytes,
} from "@solana/kit";
import {
  SolanaSignIn,
  type SolanaSignInFeature,
  type SolanaSignInInput,
  type SolanaSignInOutput,
  SolanaSignMessage,
  type SolanaSignMessageFeature,
  type SolanaSignMessageInput,
  type SolanaSignMessageOutput,
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
  type SolanaSignTransactionInput,
  type SolanaSignTransactionOutput,
} from "@solana/wallet-standard-features";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  StandardConnect,
  type StandardConnectFeature,
  StandardDisconnect,
  type StandardDisconnectFeature,
  StandardEvents,
  type StandardEventsFeature,
  type StandardEventsListeners,
  type StandardEventsOnMethod,
} from "@wallet-standard/features";
import { registerWallet } from "@wallet-standard/wallet";
import { SOLANA_CHAIN } from "./chain.ts";
import { formatSiwsMessage } from "./siws.ts";

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

type DemoFeatures = StandardConnectFeature &
  StandardDisconnectFeature &
  StandardEventsFeature &
  SolanaSignTransactionFeature &
  SolanaSignMessageFeature &
  SolanaSignInFeature;

class DemoAccount implements WalletAccount {
  readonly chains = [SOLANA_CHAIN] as const;
  readonly features = [SolanaSignTransaction, SolanaSignMessage, SolanaSignIn] as const;
  constructor(
    readonly address: string,
    readonly publicKey: Uint8Array,
  ) {}
}

class DemoSignerWallet implements Wallet {
  readonly version = "1.0.0" as const;
  readonly name = DEMO_SIGNER_NAME;
  readonly icon = ICON;
  readonly chains = [SOLANA_CHAIN] as const;
  readonly marker = DEMO_SIGNER_MARKER;
  readonly #account: DemoAccount;
  readonly #keyPair: CryptoKeyPair;
  #connected = false;
  readonly #changeListeners = new Set<StandardEventsListeners["change"]>();

  constructor(keyPair: CryptoKeyPair, account: DemoAccount) {
    this.#keyPair = keyPair;
    this.#account = account;
  }

  get accounts(): readonly WalletAccount[] {
    return this.#connected ? [this.#account] : [];
  }

  get features(): DemoFeatures {
    return {
      [StandardConnect]: { version: "1.0.0", connect: this.#connect },
      [StandardDisconnect]: { version: "1.0.0", disconnect: this.#disconnect },
      [StandardEvents]: { version: "1.0.0", on: this.#on },
      [SolanaSignTransaction]: {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: this.#signTransaction,
      },
      [SolanaSignMessage]: { version: "1.1.0", signMessage: this.#signMessage },
      [SolanaSignIn]: { version: "1.0.0", signIn: this.#signIn },
    };
  }

  #emitChange() {
    for (const listener of this.#changeListeners) listener({ accounts: this.accounts });
  }

  #on: StandardEventsOnMethod = (event, listener) => {
    if (event !== "change") return () => {};
    this.#changeListeners.add(listener);
    return () => {
      this.#changeListeners.delete(listener);
    };
  };

  #connect = async () => {
    if (!this.#connected) {
      this.#connected = true;
      this.#emitChange();
    }
    return { accounts: this.accounts };
  };

  #disconnect = async () => {
    this.#connected = false;
    this.#emitChange();
  };

  #assertAccount(account: WalletAccount) {
    if (account.address !== this.#account.address) {
      throw new Error("The demo signer only signs for the demo-worker account");
    }
  }

  #signTransaction = async (
    ...inputs: readonly SolanaSignTransactionInput[]
  ): Promise<readonly SolanaSignTransactionOutput[]> => {
    const decoder = getTransactionDecoder();
    const encoder = getTransactionEncoder();
    return Promise.all(
      inputs.map(async (input) => {
        this.#assertAccount(input.account);
        const signed = await partiallySignTransaction(
          [this.#keyPair],
          decoder.decode(input.transaction),
        );
        return { signedTransaction: new Uint8Array(encoder.encode(signed)) };
      }),
    );
  };

  #signMessage = async (
    ...inputs: readonly SolanaSignMessageInput[]
  ): Promise<readonly SolanaSignMessageOutput[]> =>
    Promise.all(
      inputs.map(async (input) => {
        this.#assertAccount(input.account);
        const signature = await signBytes(this.#keyPair.privateKey, input.message);
        return { signedMessage: input.message, signature: new Uint8Array(signature) };
      }),
    );

  #signIn = async (
    ...inputs: readonly SolanaSignInInput[]
  ): Promise<readonly SolanaSignInOutput[]> => {
    await this.#connect();
    return Promise.all(
      inputs.map(async (input) => {
        const text = formatSiwsMessage({
          ...input,
          domain: input.domain ?? window.location.host,
          address: this.#account.address,
        });
        const message = new TextEncoder().encode(text);
        const signature = await signBytes(this.#keyPair.privateKey, message);
        return {
          account: this.#account,
          signedMessage: message,
          signature: new Uint8Array(signature),
          signatureType: "ed25519" as const,
        };
      }),
    );
  };
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
    registerWallet(new DemoSignerWallet(keyPair, new DemoAccount(address, publicKey)));
  })();
  return registration;
}
