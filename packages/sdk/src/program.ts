import { isSome } from "@solana/kit";
import { programDataFromLogs } from "./events.ts";
import {
  getLegExecutedEventDecoder,
  getRouterDecoder,
  LEG_EXECUTED_EVENT_DISCRIMINATOR,
  type LegExecutedEvent,
  PriceSource,
} from "./generated/index.ts";
import type { RouterSnapshot } from "./reconcile.ts";
import type { LegExecutedView } from "./verify.ts";

/** The Router fields the reconcile sweep reads, from raw account data. */
export function decodeRouterSnapshot(data: Uint8Array): RouterSnapshot {
  const router = getRouterDecoder().decode(data);
  return {
    owner: router.owner,
    payIn: router.payIn,
    watermark: router.watermark,
    minInflow: router.minInflow,
    paused: router.paused,
  };
}

function startsWith(bytes: Uint8Array, prefix: ArrayLike<number>): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false;
  return true;
}

/** Every `LegExecuted` our program emitted in a transaction's logs. */
export function legExecutedFromLogs(logs: readonly string[]): LegExecutedEvent[] {
  const discriminator = LEG_EXECUTED_EVENT_DISCRIMINATOR;
  return programDataFromLogs(logs)
    .filter((data) => startsWith(data, discriminator))
    .map((data) => getLegExecutedEventDecoder().decode(data));
}

const PRICE_SOURCES = {
  [PriceSource.PythRegular]: "PythRegular",
  [PriceSource.Pyth247]: "Pyth247",
  [PriceSource.MarkAttestation]: "MarkAttestation",
} as const;

/** The verifier's view of a decoded event. */
export function legExecutedView(event: LegExecutedEvent): LegExecutedView {
  return {
    router: event.router,
    paycheck: event.paycheck,
    seq: event.seq,
    legIndex: event.legIndex,
    mint: event.mint,
    destination: event.destination,
    amountIn: event.amountIn,
    fee: event.fee,
    swappedIn: event.swappedIn,
    dustReturned: event.dustReturned,
    outAmount: event.outAmount,
    issuerFee: event.issuerFee,
    minOut: event.minOut,
    refPriceE9: event.refPriceE9,
    usdcPriceE9: event.usdcPriceE9,
    multiplierE12: event.multiplierE12,
    bandBps: event.bandBps,
    priceSource: PRICE_SOURCES[event.priceSource],
    pricePublishTime: event.pricePublishTime,
    attestation: isSome(event.attestation) ? event.attestation.value : null,
  };
}
