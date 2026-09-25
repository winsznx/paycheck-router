import {
  type Base64EncodedWireTransaction,
  type Commitment,
  createSolanaRpc,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
} from "@solana/kit";
import type { ChainEndpoints } from "../config.ts";

export type SignatureOutcome =
  | { status: "confirmed" | "finalized"; slot: bigint }
  | { status: "failed"; slot: bigint; err: unknown }
  | { status: "timeout" };

export type ChainClient = {
  endpoints: ChainEndpoints;
  /** Reads and simulation against the primary endpoint (the surfnet on surfnets). */
  rpc: Rpc<SolanaRpcApi>;
  /** The verifier's independent read path. */
  verifyRpc: Rpc<SolanaRpcApi>;
  /** Broadcasts to every configured send endpoint and returns the signature. */
  send(wire: Base64EncodedWireTransaction, options: { skipPreflight: boolean }): Promise<Signature>;
  waitForSignature(
    signature: Signature,
    options: { commitment: Exclude<Commitment, "processed">; timeoutMs: number; pollMs?: number },
  ): Promise<SignatureOutcome>;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createChainClient(endpoints: ChainEndpoints): ChainClient {
  const rpc = createSolanaRpc(endpoints.rpcUrl);
  const verifyRpc =
    endpoints.verifyRpcUrl === endpoints.rpcUrl ? rpc : createSolanaRpc(endpoints.verifyRpcUrl);
  const senders = endpoints.sendUrls.map((url) =>
    url === endpoints.rpcUrl ? rpc : createSolanaRpc(url),
  );

  return {
    endpoints,
    rpc,
    verifyRpc,
    async send(wire, { skipPreflight }) {
      const results = await Promise.allSettled(
        senders.map((sender) =>
          sender
            .sendTransaction(wire, {
              encoding: "base64",
              skipPreflight,
              maxRetries: 0n,
              preflightCommitment: "confirmed",
            })
            .send(),
        ),
      );
      const landed = results.find((result) => result.status === "fulfilled");
      if (landed?.status === "fulfilled") return landed.value;
      const first = results[0];
      throw first?.status === "rejected" ? first.reason : new Error("no send endpoint configured");
    },
    async waitForSignature(signature, { commitment, timeoutMs, pollMs = 1_000 }) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const { value } = await rpc
          .getSignatureStatuses([signature], { searchTransactionHistory: false })
          .send();
        const status = value[0];
        if (status) {
          if (status.err) return { status: "failed", slot: status.slot, err: status.err };
          const reached =
            status.confirmationStatus === "finalized" ||
            (commitment === "confirmed" && status.confirmationStatus === "confirmed");
          if (reached) {
            return {
              status: status.confirmationStatus === "finalized" ? "finalized" : "confirmed",
              slot: status.slot,
            };
          }
        }
        await sleep(pollMs);
      }
      return { status: "timeout" };
    },
  };
}
