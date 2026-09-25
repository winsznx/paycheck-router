import { effectiveMultiplier } from "@paycheck-router/guard-math";
import { address } from "@solana/kit";
import type { ChainClient } from "./client.ts";

type Extension = {
  extension: string;
  state?: {
    multiplier?: string;
    newMultiplier?: string;
    newMultiplierEffectiveTimestamp?: number;
    newerTransferFee?: { epoch: number; transferFeeBasisPoints: number };
    olderTransferFee?: { epoch: number; transferFeeBasisPoints: number };
  };
};

export type MintTerms = {
  /** Effective Token-2022 Scaled UI multiplier at 1e12 (1e12 when the mint has none). */
  multiplierE12: bigint;
  /** Transfer fee in bps charged on delivery (PreStocks), 0 when the mint has none. */
  transferFeeBps: number;
};

/** Reads each mint's Scaled UI multiplier and transfer fee from the chain endpoint. */
export async function mintTerms(
  chain: ChainClient,
  mints: readonly string[],
  now: Date,
): Promise<Map<string, MintTerms>> {
  const out = new Map<string, MintTerms>();
  if (mints.length === 0) return out;
  const [{ value }, epochInfo] = await Promise.all([
    chain.rpc
      .getMultipleAccounts(mints.map(address), { encoding: "jsonParsed", commitment: "confirmed" })
      .send(),
    chain.rpc.getEpochInfo({ commitment: "confirmed" }).send(),
  ]);
  mints.forEach((mint, index) => {
    const account = value[index] as {
      data?: { parsed?: { info?: { extensions?: Extension[] } } };
    } | null;
    const extensions = account?.data?.parsed?.info?.extensions ?? [];
    const scaled = extensions.find((ext) => ext.extension === "scaledUiAmountConfig")?.state;
    const multiplier = scaled?.multiplier
      ? effectiveMultiplier(
          {
            multiplier: Number(scaled.multiplier),
            newMultiplier: Number(scaled.newMultiplier ?? scaled.multiplier),
            newMultiplierEffectiveTimestamp: BigInt(scaled.newMultiplierEffectiveTimestamp ?? 0),
          },
          BigInt(Math.floor(now.getTime() / 1000)),
        )
      : 1;
    const fee = extensions.find((ext) => ext.extension === "transferFeeConfig")?.state;
    const current =
      fee?.newerTransferFee && epochInfo.epoch >= BigInt(fee.newerTransferFee.epoch)
        ? fee.newerTransferFee
        : fee?.olderTransferFee;
    out.set(mint, {
      // Rounded down, as the program does where the multiplier divides the minimum.
      multiplierE12: BigInt(Math.floor(multiplier * 1e12)),
      transferFeeBps: current?.transferFeeBasisPoints ?? 0,
    });
  });
  return out;
}
