import { PROGRAM_ID } from "@paycheck-router/shared";
import { address, getBase64Decoder, none, some } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  getLegExecutedEventEncoder,
  getRouterEncoder,
  LEG_EXECUTED_EVENT_DISCRIMINATOR,
  PriceSource,
} from "../src/generated/index.ts";
import { decodeRouterSnapshot, legExecutedFromLogs, legExecutedView } from "../src/program.ts";

const owner = address("hoyjKyffP55yKjj8aEGARUQi5xKC3bZTYv4j4ih3dBy");
const other = address("7okuGKwRkoLvcGsu1wXHC3gqJQk41FZT9mo363Qsefwu");

const event = {
  router: other,
  paycheck: other,
  seq: 3n,
  legIndex: 1,
  mint: owner,
  destination: other,
  amountIn: 100_000_000n,
  fee: 200_000n,
  swappedIn: 99_800_000n,
  dustReturned: 0n,
  outAmount: 55_000_000n,
  minOut: 54_000_000n,
  refPriceE9: 180_000_000_000n,
  usdcPriceE9: 1_000_000_000n,
  multiplierE12: 1_000_000_000_000n,
  bandBps: 50,
  priceSource: PriceSource.MarkAttestation,
  pricePublishTime: 1_790_000_000n,
  attestation: some({ mint: owner, markPriceE9: 1n, observedAt: 2n, source: 0 }),
  ownerInitiated: false,
  slot: 9n,
};

describe("generated client adapters", () => {
  it("decodes the Router fields the sweep needs", () => {
    const data = getRouterEncoder().encode({
      owner,
      payIn: other,
      recorder: other,
      rentPayer: other,
      investBps: 2_000,
      minInflow: 1_000_000n,
      dailyCap: 0n,
      dayStart: 0n,
      daySpent: 0n,
      maxWaitSecs: 0,
      autoConvert: false,
      paused: false,
      watermark: 5_000_000n,
      paycheckSeq: 0n,
      legs: Array.from({ length: 8 }, () => ({
        mint: other,
        weightBps: 0,
        bandBps: 0,
        enabled: false,
      })),
      legCount: 0,
      totalInflow: 0n,
      totalInvested: 0n,
      totalFees: 0n,
      createdAt: 0n,
      updatedAt: 0n,
      bump: 0,
      authorityBump: 0,
      pendingLegs: 0,
      reserved: new Uint8Array(64),
    });
    expect(decodeRouterSnapshot(Uint8Array.from(data))).toEqual({
      owner,
      payIn: other,
      watermark: 5_000_000n,
      minInflow: 1_000_000n,
      paused: false,
    });
  });

  it("finds LegExecuted in our program's logs and maps it for the verifier", () => {
    const payload = new Uint8Array([
      ...LEG_EXECUTED_EVENT_DISCRIMINATOR,
      ...getLegExecutedEventEncoder().encode(event),
    ]);
    const logs = [
      `Program ${PROGRAM_ID} invoke [1]`,
      `Program data: ${getBase64Decoder().decode(payload)}`,
      `Program ${PROGRAM_ID} success`,
    ];
    const [decoded] = legExecutedFromLogs(logs);
    expect(decoded?.outAmount).toBe(55_000_000n);
    const view = legExecutedView(decoded ?? { ...event, attestation: none() }, 12n);
    expect(view.priceSource).toBe("MarkAttestation");
    expect(view.attestation?.markPriceE9).toBe(1n);
    expect(view.issuerFee).toBe(12n);
  });
});
