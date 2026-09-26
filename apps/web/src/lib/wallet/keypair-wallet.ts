"use client";

import {
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
import { SOLANA_CHAIN } from "./chain.ts";
import { formatSiwsMessage } from "./siws.ts";

/** A Wallet Standard wallet that signs with one WebCrypto Ed25519 key pair held in the page. */
type KeyPairFeatures = StandardConnectFeature &
  StandardDisconnectFeature &
  StandardEventsFeature &
  SolanaSignTransactionFeature &
  SolanaSignMessageFeature &
  SolanaSignInFeature;

export class KeyPairAccount implements WalletAccount {
  readonly chains = [SOLANA_CHAIN] as const;
  readonly features = [SolanaSignTransaction, SolanaSignMessage, SolanaSignIn] as const;
  constructor(
    readonly address: string,
    readonly publicKey: Uint8Array,
  ) {}
}

export class KeyPairWallet implements Wallet {
  readonly version = "1.0.0" as const;
  readonly chains = [SOLANA_CHAIN] as const;
  readonly name: string;
  readonly icon: `data:image/${"svg+xml" | "png"};base64,${string}`;
  readonly #account: KeyPairAccount;
  readonly #keyPair: CryptoKeyPair;
  #connected = false;
  readonly #changeListeners = new Set<StandardEventsListeners["change"]>();

  constructor(
    name: string,
    icon: `data:image/${"svg+xml" | "png"};base64,${string}`,
    keyPair: CryptoKeyPair,
    account: KeyPairAccount,
  ) {
    this.name = name;
    this.icon = icon;
    this.#keyPair = keyPair;
    this.#account = account;
  }

  get accounts(): readonly WalletAccount[] {
    return this.#connected ? [this.#account] : [];
  }

  get features(): KeyPairFeatures {
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
      throw new Error(`${this.name} only signs for ${this.#account.address}`);
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
