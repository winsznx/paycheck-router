import { buyMinOut } from "@paycheck-router/guard-math";
import { assetBySymbol, USDC_FEED_ID, USDC_MINT } from "@paycheck-router/shared";
import { address, generateKeyPairSigner } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { signMarkAttestation } from "../src/attester.ts";
import type { HermesUpdateResponse } from "../src/hermes.ts";
import {
  type LegExecutedView,
  type LegVerificationInput,
  type ParsedTransactionView,
  verifyLeg,
} from "../src/verify.ts";

const nvda = assetBySymbol("NVDAx");
const owner = address("hoyjKyffP55yKjj8aEGARUQi5xKC3bZTYv4j4ih3dBy");
const ownerUsdc = address("CuZDTZrPcGrRcjjFEF4UmcxgGq75Jm8eFFaxAWnSBBGA");
const destination = address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
const crank = address("7okuGKwRkoLvcGsu1wXHC3gqJQk41FZT9mo363Qsefwu");
const PUBLISH = 1_790_000_000;

function hermes(nvdaPrice: string): HermesUpdateResponse {
  const entry = (id: string, price: string, expo: number) => ({
    id,
    price: { price, conf: "1000", expo, publish_time: PUBLISH },
    ema_price: { price, conf: "1000", expo, publish_time: PUBLISH },
    metadata: null,
  });
  return {
    binary: { encoding: "base64", data: [] },
    parsed: [entry(USDC_FEED_ID, "99990000", -8), entry(nvda.feedId ?? "", nvdaPrice, -5)],
  };
}

const minOut = buyMinOut({
  usdcIn: 99_800_000n,
  usdcPriceE9: 999_900_000n,
  priceE9: 180_123_450_000n,
  bandBps: 50,
  multiplierE12: 1_000_000_000_000n,
  decimals: 8,
});
const outAmount = minOut + 1_000n;

const event: LegExecutedView = {
  router: crank,
  paycheck: crank,
  seq: 0n,
  legIndex: 0,
  mint: nvda.mint,
  destination,
  amountIn: 100_000_000n,
  fee: 200_000n,
  swappedIn: 99_800_000n,
  dustReturned: 0n,
  outAmount,
  issuerFee: 0n,
  minOut,
  refPriceE9: 180_123_450_000n,
  usdcPriceE9: 999_900_000n,
  multiplierE12: 1_000_000_000_000n,
  bandBps: 50,
  priceSource: "PythRegular",
  pricePublishTime: BigInt(PUBLISH),
  attestation: null,
};

function transaction(received: bigint): ParsedTransactionView {
  const balance = (index: number, mint: string, amount: bigint) => ({
    accountIndex: index,
    mint,
    owner,
    uiTokenAmount: { amount: amount.toString() },
  });
  return {
    slot: 1,
    blockTime: PUBLISH + 3,
    meta: {
      err: null,
      preTokenBalances: [balance(1, USDC_MINT, 500_000_000n), balance(2, nvda.mint, 0n)],
      postTokenBalances: [balance(1, USDC_MINT, 400_000_000n), balance(2, nvda.mint, received)],
    },
    transaction: { message: { accountKeys: [crank, ownerUsdc, destination] } },
  };
}

const input: LegVerificationInput = {
  event,
  transaction: transaction(outAmount),
  owner,
  usdcMint: USDC_MINT,
  decimals: 8,
  postedUpdate: hermes("18012345"),
  history: hermes("18012345"),
  feedId: nvda.feedId,
  usdcFeedId: USDC_FEED_ID,
  readback: {
    executed: true,
    amountIn: event.amountIn,
    outAmount,
    fee: event.fee,
    issuerFee: 0n,
    refPriceE9: event.refPriceE9,
  },
  attestation: null,
};

const failing = (result: Awaited<ReturnType<typeof verifyLeg>>) =>
  result.checks.filter((c) => !c.pass).map((c) => c.name);

describe("verifyLeg", () => {
  it("verifies a leg whose every number re-derives", async () => {
    const result = await verifyLeg(input);
    expect(failing(result)).toEqual([]);
    expect(result.state).toBe("VERIFIED");
  });

  it("fails when Hermes history disagrees with the posted price", async () => {
    const result = await verifyLeg({ ...input, history: hermes("18012346") });
    expect(result.state).toBe("UNVERIFIED");
    expect(failing(result)).toEqual(["Pyth price matches Hermes history for its publish time"]);
  });

  it("fails when the destination received less than the event claims", async () => {
    const result = await verifyLeg({ ...input, transaction: transaction(outAmount - 1n) });
    expect(failing(result)).toContain("destination received out_amount");
  });

  it("fails without a chain readback", async () => {
    const result = await verifyLeg({ ...input, readback: null });
    expect(failing(result)).toEqual(["paycheck leg reads back executed"]);
  });

  it("checks a pre-IPO leg against the attester's signature", async () => {
    const attester = await generateKeyPairSigner();
    const signed = await signMarkAttestation(
      { mint: nvda.mint, markPriceE9: 180_123_450_000n, observedAt: BigInt(PUBLISH), source: 0 },
      attester,
    );
    const preIpo = {
      ...input,
      event: { ...event, priceSource: "MarkAttestation" as const, attestation: signed.attestation },
      attestation: { attester: attester.address, signature: signed.signature },
    };
    expect(failing(await verifyLeg(preIpo))).toEqual([]);
    const other = await generateKeyPairSigner();
    const forged = {
      ...preIpo,
      attestation: { attester: other.address, signature: signed.signature },
    };
    expect(failing(await verifyLeg(forged))).toEqual(["attestation signed by the attester"]);
  });
});
