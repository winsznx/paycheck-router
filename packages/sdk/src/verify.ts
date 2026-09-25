import { buyMinOut, buyPremiumBps, pythPriceToE9 } from "@paycheck-router/guard-math";
import { HARD_CAPS, type VerifierCheck, type VerifierResult } from "@paycheck-router/shared";
import {
  type Address,
  getPublicKeyFromAddress,
  signatureBytes,
  verifySignature,
} from "@solana/kit";
import { encodeMarkAttestation, type MarkAttestation } from "./attester.ts";
import type { HermesParsedUpdate, HermesUpdateResponse } from "./hermes.ts";

/** The `LegExecuted` fields the verifier re-derives, whatever client decoded them. */
export type LegExecutedView = {
  router: Address;
  paycheck: Address;
  seq: bigint;
  legIndex: number;
  mint: Address;
  destination: Address;
  amountIn: bigint;
  fee: bigint;
  swappedIn: bigint;
  dustReturned: bigint;
  /** Gross shares delivered, before the issuer's Token-2022 transfer fee. */
  outAmount: bigint;
  /** Transfer fee the issuer withheld in the destination account. */
  issuerFee: bigint;
  minOut: bigint;
  refPriceE9: bigint;
  usdcPriceE9: bigint;
  multiplierE12: bigint;
  bandBps: number;
  priceSource: "PythRegular" | "Pyth247" | "MarkAttestation";
  pricePublishTime: bigint;
  attestation: MarkAttestation | null;
};

type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
};

/** The parts of a `getTransaction` (jsonParsed) response the verifier reads. */
export type ParsedTransactionView = {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    preTokenBalances: TokenBalance[];
    postTokenBalances: TokenBalance[];
  };
  transaction: { message: { accountKeys: ({ pubkey: string } | string)[] } };
};

/** The leg as the chain holds it after the transaction, read back from the Paycheck account. */
export type PaycheckLegReadback = {
  executed: boolean;
  amountIn: bigint;
  outAmount: bigint;
  fee: bigint;
  refPriceE9: bigint;
};

export type LegVerificationInput = {
  event: LegExecutedView;
  transaction: ParsedTransactionView;
  owner: Address;
  usdcMint: Address;
  decimals: number;
  /** The Hermes update the crank posted for this leg. */
  postedUpdate: HermesUpdateResponse | null;
  /** Hermes history for the event's publish time (listed legs) or USDC's (pre-IPO legs). */
  history: HermesUpdateResponse | null;
  feedId: string | null;
  usdcFeedId: string;
  readback: PaycheckLegReadback | null;
  attestation: { attester: Address; signature: Uint8Array } | null;
};

function check(name: string, pass: boolean, expected: unknown, actual: unknown): VerifierCheck {
  return {
    name,
    pass,
    expected: expected === null ? null : String(expected),
    actual: actual === null ? null : String(actual),
  };
}

function balanceDelta(tx: ParsedTransactionView, account: string): bigint | null {
  const keys = tx.transaction.message.accountKeys.map((k) =>
    typeof k === "string" ? k : k.pubkey,
  );
  const index = keys.indexOf(account);
  if (index < 0) return null;
  const read = (list: TokenBalance[]) => {
    const entry = list.find((b) => b.accountIndex === index);
    return entry ? BigInt(entry.uiTokenAmount.amount) : 0n;
  };
  return read(tx.meta.postTokenBalances) - read(tx.meta.preTokenBalances);
}

function ownerUsdcDelta(tx: ParsedTransactionView, owner: Address, usdcMint: Address): bigint {
  const keys = tx.transaction.message.accountKeys.map((k) =>
    typeof k === "string" ? k : k.pubkey,
  );
  let delta = 0n;
  const indices = new Set<number>();
  for (const b of [...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances]) {
    if (b.mint === usdcMint && b.owner === owner) indices.add(b.accountIndex);
  }
  for (const index of indices) {
    const key = keys[index];
    if (key) delta += balanceDelta(tx, key) ?? 0n;
  }
  return delta;
}

function e9Of(update: HermesParsedUpdate): bigint {
  return pythPriceToE9(BigInt(update.price.price), update.price.expo);
}

function findParsed(update: HermesUpdateResponse | null, feedId: string | null) {
  if (!update || !feedId) return undefined;
  const id = feedId.replace(/^0x/, "");
  return update.parsed.find((p) => p.id === id);
}

async function verifyAttestationSignature(
  attestation: MarkAttestation,
  attester: Address,
  signature: Uint8Array,
): Promise<boolean> {
  const key = await getPublicKeyFromAddress(attester);
  return verifySignature(key, signatureBytes(signature), encodeMarkAttestation(attestation));
}

/**
 * Re-derives one executed leg from raw artifacts: the transaction's balance changes, the chain
 * readback, the posted Pyth price and Hermes history for the same publish time. Every check must
 * pass for VERIFIED.
 */
export async function verifyLeg(
  input: LegVerificationInput,
  verifiedAtMs: number = Date.now(),
): Promise<VerifierResult> {
  const { event, transaction } = input;
  const checks: VerifierCheck[] = [];

  checks.push(
    check(
      "transaction succeeded",
      transaction.meta.err === null,
      null,
      JSON.stringify(transaction.meta.err),
    ),
  );

  const received = balanceDelta(transaction, event.destination);
  const gross = received === null ? null : received + event.issuerFee;
  checks.push(
    check(
      "destination received out_amount less the issuer fee",
      gross === event.outAmount,
      event.outAmount,
      gross,
    ),
  );
  checks.push(
    check(
      "gross delivery meets min_out",
      event.outAmount >= event.minOut,
      `>= ${event.minOut}`,
      event.outAmount,
    ),
  );

  const spent = -ownerUsdcDelta(transaction, input.owner, input.usdcMint);
  const expectedSpent = event.amountIn - event.dustReturned;
  checks.push(
    check(
      "owner USDC fell by amount_in less returned dust",
      spent === expectedSpent,
      expectedSpent,
      spent,
    ),
  );
  checks.push(
    check(
      "fee plus swapped equals amount_in",
      event.fee + event.swappedIn === event.amountIn,
      event.amountIn,
      event.fee + event.swappedIn,
    ),
  );

  if (input.readback) {
    const r = input.readback;
    checks.push(check("paycheck leg reads back executed", r.executed, true, r.executed));
    checks.push(
      check(
        "readback out_amount matches event",
        r.outAmount === event.outAmount,
        event.outAmount,
        r.outAmount,
      ),
    );
    checks.push(
      check(
        "readback amount_in matches event",
        r.amountIn === event.amountIn,
        event.amountIn,
        r.amountIn,
      ),
    );
    checks.push(check("readback fee matches event", r.fee === event.fee, event.fee, r.fee));
    checks.push(
      check(
        "readback reference price matches event",
        r.refPriceE9 === event.refPriceE9,
        event.refPriceE9,
        r.refPriceE9,
      ),
    );
  } else {
    checks.push(check("paycheck leg reads back executed", false, true, null));
  }

  const postedUsdc = findParsed(input.postedUpdate, input.usdcFeedId);
  checks.push(
    check(
      "posted USDC/USD matches event",
      postedUsdc !== undefined && e9Of(postedUsdc) === event.usdcPriceE9,
      event.usdcPriceE9,
      postedUsdc ? e9Of(postedUsdc) : null,
    ),
  );
  const historyUsdc = findParsed(input.history, input.usdcFeedId);
  checks.push(
    check(
      "USDC/USD matches Hermes history",
      historyUsdc !== undefined && e9Of(historyUsdc) === event.usdcPriceE9,
      event.usdcPriceE9,
      historyUsdc ? e9Of(historyUsdc) : null,
    ),
  );

  if (event.priceSource === "MarkAttestation") {
    const attestation = event.attestation;
    const signed = input.attestation;
    const valid =
      attestation !== null &&
      signed !== null &&
      (await verifyAttestationSignature(attestation, signed.attester, signed.signature));
    checks.push(
      check(
        "attestation signed by the attester",
        valid,
        signed?.attester ?? null,
        valid ? signed?.attester : "invalid",
      ),
    );
    checks.push(
      check(
        "reference price is the attested mark",
        attestation?.markPriceE9 === event.refPriceE9,
        attestation?.markPriceE9 ?? null,
        event.refPriceE9,
      ),
    );
    const age =
      attestation && transaction.blockTime !== null
        ? Math.abs(transaction.blockTime - Number(attestation.observedAt))
        : null;
    checks.push(
      check(
        "attestation fresh at execution",
        age !== null && age <= HARD_CAPS.maxAttestationAgeSecs,
        `<= ${HARD_CAPS.maxAttestationAgeSecs}s`,
        age === null ? null : `${age}s`,
      ),
    );
  } else {
    const posted = findParsed(input.postedUpdate, input.feedId);
    checks.push(
      check(
        "posted Pyth price matches event",
        posted !== undefined &&
          e9Of(posted) === event.refPriceE9 &&
          BigInt(posted.price.publish_time) === event.pricePublishTime,
        `${event.refPriceE9}@${event.pricePublishTime}`,
        posted ? `${e9Of(posted)}@${posted.price.publish_time}` : null,
      ),
    );
    const history = findParsed(input.history, input.feedId);
    checks.push(
      check(
        "Pyth price matches Hermes history for its publish time",
        history !== undefined &&
          e9Of(history) === event.refPriceE9 &&
          BigInt(history.price.publish_time) === event.pricePublishTime,
        `${event.refPriceE9}@${event.pricePublishTime}`,
        history ? `${e9Of(history)}@${history.price.publish_time}` : null,
      ),
    );
  }

  let recomputed: bigint | null = null;
  try {
    recomputed = buyMinOut({
      usdcIn: event.swappedIn,
      usdcPriceE9: event.usdcPriceE9,
      priceE9: event.refPriceE9,
      bandBps: event.bandBps,
      multiplierE12: event.multiplierE12,
      decimals: input.decimals,
    });
  } catch (error) {
    recomputed = null;
    checks.push(
      check(
        "min_out recomputes",
        false,
        event.minOut,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
  if (recomputed !== null) {
    checks.push(
      check(
        "min_out recomputes from the reference price",
        recomputed === event.minOut,
        event.minOut,
        recomputed,
      ),
    );
  }
  const premium =
    event.outAmount > 0n
      ? buyPremiumBps({
          usdcIn: event.swappedIn,
          sharesOut: event.outAmount,
          usdcPriceE9: event.usdcPriceE9,
          priceE9: event.refPriceE9,
          multiplierE12: event.multiplierE12,
          decimals: input.decimals,
        })
      : null;
  checks.push(
    check(
      "premium within the band",
      premium !== null && premium <= BigInt(event.bandBps),
      `<= ${event.bandBps}`,
      premium,
    ),
  );

  return {
    state: checks.every((c) => c.pass) ? "VERIFIED" : "UNVERIFIED",
    verifiedAt: new Date(verifiedAtMs).toISOString(),
    checks,
  };
}

/** Premium in basis points for a verified fill, for reports. */
export function premiumOf(event: LegExecutedView, decimals: number): bigint {
  return buyPremiumBps({
    usdcIn: event.swappedIn,
    sharesOut: event.outAmount,
    usdcPriceE9: event.usdcPriceE9,
    priceE9: event.refPriceE9,
    multiplierE12: event.multiplierE12,
    decimals,
  });
}
