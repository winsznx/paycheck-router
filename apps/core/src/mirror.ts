import { sql } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { attempts, inflows, legs, paychecks, verifications } from "./db/schema.ts";

/** A leg as the RouterActor stores it; amounts are decimal strings so the row survives JSON. */
export type LegRow = {
  id: string;
  paycheckId: string;
  seq: string;
  idx: number;
  mint: string;
  amountIn: string;
  bandBps: number;
  status:
    | "pending"
    | "waiting"
    | "executing"
    | "executed"
    | "verified"
    | "unverified"
    | "expired"
    | "cancelled";
  waitReason: string | null;
  nextAttemptAt: number | null;
  attemptCount: number;
  executingSince: number | null;
  outAmount: string | null;
  fee: string | null;
  issuerFee: string | null;
  uiMultiplier: string | null;
  refPriceE9: string | null;
  execPriceE9: string | null;
  premiumBps: number | null;
  executedSig: string | null;
  executedAt: number | null;
  verifiedAt: number | null;
};

export type PaycheckRow = {
  id: string;
  seq: string;
  paycheckPda: string;
  inflow: string;
  investTotal: string;
  recordedSig: string;
  recordedAt: number;
  expiresAt: number;
  inflowSig: string | null;
  sender: string | null;
  status: "open" | "complete" | "closed";
};

export type AttemptRow = {
  attemptNo: number;
  kind: "simulate" | "send" | "owner_buy";
  outcome: string;
  programErrorCode: number | null;
  reason: string | null;
  signature: string | null;
  cuUsed: number | null;
  priorityFeeLamports: string | null;
  quote: Record<string, unknown> | null;
};

export type VerificationRow = {
  rpcProvider: string;
  finalizedSlot: string | null;
  ownerDeltaRaw: string | null;
  ownerUsdcDelta: string | null;
  recomputedMinOut: string | null;
  recomputedPremiumBps: number | null;
  matches: boolean;
  diff: Record<string, unknown> | null;
  hermesPublishTime: number | null;
};

/** Offchain writes the RouterActor mirrors to Supabase; replayed from its outbox on failure. */
export type MirrorOp =
  | {
      op: "inflow";
      routerId: string;
      signature: string;
      slot: string;
      amount: string;
      sender: string | null;
      classification:
        | "pending"
        | "recorded"
        | "skipped_below_minimum"
        | "skipped_untagged"
        | "skipped_self_transfer"
        | "skipped_protocol";
      decidedAt: number | null;
    }
  | { op: "paycheck"; routerId: string; paycheck: PaycheckRow; legs: LegRow[] }
  | { op: "leg"; leg: LegRow }
  | { op: "paycheck_status"; paycheckId: string; status: PaycheckRow["status"] }
  | { op: "attempts"; legId: string; attempts: AttemptRow[] }
  | { op: "verification"; legId: string; verification: VerificationRow };

const big = (value: string | null) => (value === null ? null : BigInt(value));
const date = (value: number | null) => (value === null ? null : new Date(value));

function legValues(leg: LegRow) {
  return {
    id: leg.id,
    paycheckId: leg.paycheckId,
    idx: leg.idx,
    assetMint: leg.mint,
    amountIn: BigInt(leg.amountIn),
    status: leg.status,
    waitReason: leg.waitReason,
    outAmount: big(leg.outAmount),
    fee: big(leg.fee),
    issuerFee: big(leg.issuerFee),
    uiMultiplier: leg.uiMultiplier,
    refPriceE9: big(leg.refPriceE9),
    execPriceE9: big(leg.execPriceE9),
    premiumBps: leg.premiumBps,
    executedSig: leg.executedSig,
    executedAt: date(leg.executedAt),
    verifiedAt: date(leg.verifiedAt),
    attemptCount: leg.attemptCount,
    nextAttemptAt: date(leg.nextAttemptAt),
    executingSince: date(leg.executingSince),
    updatedAt: new Date(),
  };
}

function legUpdate(leg: LegRow) {
  const {
    id: _id,
    paycheckId: _paycheck,
    idx: _idx,
    assetMint: _mint,
    amountIn: _in,
    ...rest
  } = legValues(leg);
  return rest;
}

/** Applies one mirror operation. Every write is an idempotent upsert keyed by PRD 8.7 keys. */
export async function applyMirror(db: Db, op: MirrorOp): Promise<void> {
  switch (op.op) {
    case "inflow":
      await db
        .insert(inflows)
        .values({
          routerId: op.routerId,
          signature: op.signature,
          slot: BigInt(op.slot),
          amount: BigInt(op.amount),
          senderOwner: op.sender,
          source: "reconcile",
          classification: op.classification,
          decidedAt: date(op.decidedAt),
        })
        .onConflictDoUpdate({
          target: [inflows.routerId, inflows.signature],
          set: { classification: op.classification, decidedAt: date(op.decidedAt) },
        });
      return;
    case "paycheck": {
      // Autocommit statements, each idempotent and replayed from the outbox on failure: the demo
      // database (PGlite behind a multiplexing wire server) shares one session across
      // connections, so an open transaction there would capture other connections' statements.
      const tx = db;
      {
        const inflow = op.paycheck.inflowSig
          ? await tx
              .select({ id: inflows.id })
              .from(inflows)
              .where(
                sql`${inflows.routerId} = ${op.routerId} and ${inflows.signature} = ${op.paycheck.inflowSig}`,
              )
              .limit(1)
          : [];
        await tx
          .insert(paychecks)
          .values({
            id: op.paycheck.id,
            routerId: op.routerId,
            seq: BigInt(op.paycheck.seq),
            paycheckPda: op.paycheck.paycheckPda,
            inflowId: inflow[0]?.id ?? null,
            inflowSig: op.paycheck.inflowSig,
            senderOwner: op.paycheck.sender,
            inflow: BigInt(op.paycheck.inflow),
            investTotal: BigInt(op.paycheck.investTotal),
            recordedSig: op.paycheck.recordedSig,
            recordedAt: new Date(op.paycheck.recordedAt),
            expiresAt: new Date(op.paycheck.expiresAt),
            status: op.paycheck.status,
          })
          .onConflictDoNothing({ target: [paychecks.routerId, paychecks.seq] });
        for (const leg of op.legs) {
          await tx
            .insert(legs)
            .values(legValues(leg))
            .onConflictDoUpdate({ target: [legs.paycheckId, legs.idx], set: legUpdate(leg) });
        }
      }
      return;
    }
    case "leg":
      await db
        .insert(legs)
        .values(legValues(op.leg))
        .onConflictDoUpdate({ target: [legs.paycheckId, legs.idx], set: legUpdate(op.leg) });
      return;
    case "paycheck_status":
      await db
        .update(paychecks)
        .set({ status: op.status, updatedAt: new Date() })
        .where(sql`${paychecks.id} = ${op.paycheckId}`);
      return;
    case "attempts":
      if (op.attempts.length === 0) return;
      await db
        .insert(attempts)
        .values(
          op.attempts.map((attempt) => ({
            legId: op.legId,
            attemptNo: attempt.attemptNo,
            kind: attempt.kind,
            outcome: attempt.outcome,
            programErrorCode: attempt.programErrorCode,
            reason: attempt.reason,
            signature: attempt.signature,
            cuUsed: attempt.cuUsed,
            priorityFeeLamports: big(attempt.priorityFeeLamports),
            quote: attempt.quote,
          })),
        )
        .onConflictDoNothing();
      return;
    case "verification": {
      const v = op.verification;
      const values = {
        legId: op.legId,
        rpcProvider: v.rpcProvider,
        finalizedSlot: big(v.finalizedSlot),
        ownerDeltaRaw: big(v.ownerDeltaRaw),
        ownerUsdcDelta: big(v.ownerUsdcDelta),
        recomputedMinOut: big(v.recomputedMinOut),
        recomputedPremiumBps: v.recomputedPremiumBps,
        matches: v.matches,
        diff: v.diff,
        hermesPublishTime: date(v.hermesPublishTime),
      };
      await db
        .insert(verifications)
        .values(values)
        .onConflictDoUpdate({
          target: [verifications.legId, verifications.rpcProvider],
          set: values,
        });
      return;
    }
  }
}
