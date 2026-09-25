import { DurableObject } from "cloudflare:workers";
import { api, assetByMint, retryDelaySecs, type WaitReason } from "@paycheck-router/shared";
import { sharesUi } from "../chain/shares.ts";
import { binding } from "../config.ts";
import { createDb } from "../db/client.ts";
import { createEngine } from "../engine/factory.ts";
import type {
  AttemptRecord,
  Engine,
  InflowRules,
  LegJob,
  LegOutcome,
  RouterRef,
  SweepHit,
  VerificationOutcome,
  VerifyJob,
} from "../engine/types.ts";
import type { Env } from "../env.ts";
import { CRANK_PAUSED_KEY } from "../flags.ts";
import { log } from "../log.ts";
import {
  type AttemptRow,
  applyMirror,
  type LegRow,
  type MirrorOp,
  type PaycheckRow,
} from "../mirror.ts";
import type { PublishInput } from "./user-hub.ts";

type Meta = { router: RouterRef; rules: SerializedRules; lastInflowSig: string | null };
type SerializedRules = {
  minInflow: string;
  appThreshold: string;
  taggedPayersOnly: boolean;
  taggedPayers: string[];
};

/** How long an executing batch may run before the actor assumes its consumer died. */
const STUCK_JOB_MS = 5 * 60 * 1000;
const OUTBOX_RETRY_MS = 15_000;

const SCHEMA = [
  "create table if not exists meta (key text primary key, value text not null)",
  `create table if not exists paychecks (
    seq text primary key, id text not null unique, paycheck_pda text not null, inflow text not null,
    invest_total text not null, recorded_sig text not null, recorded_at integer not null,
    expires_at integer not null, inflow_sig text, sender text, status text not null)`,
  `create table if not exists legs (
    id text primary key, paycheck_id text not null, seq text not null, idx integer not null,
    mint text not null, amount_in text not null, band_bps integer not null, status text not null,
    wait_reason text, next_attempt_at integer, attempt_count integer not null default 0,
    executing_since integer, out_amount text, fee text, issuer_fee text, ui_multiplier text,
    ref_price_e9 text,
    exec_price_e9 text, premium_bps integer, executed_sig text, executed_at integer,
    verified_at integer, unique (seq, idx))`,
  "create table if not exists outbox (id integer primary key autoincrement, payload text not null)",
  "create table if not exists job (id integer primary key check (id = 1), seq text not null, started_at integer not null)",
];

type LegSqlRow = {
  id: string;
  paycheck_id: string;
  seq: string;
  idx: number;
  mint: string;
  amount_in: string;
  band_bps: number;
  status: LegRow["status"];
  wait_reason: string | null;
  next_attempt_at: number | null;
  attempt_count: number;
  executing_since: number | null;
  out_amount: string | null;
  fee: string | null;
  issuer_fee: string | null;
  ui_multiplier: string | null;
  ref_price_e9: string | null;
  exec_price_e9: string | null;
  premium_bps: number | null;
  executed_sig: string | null;
  executed_at: number | null;
  verified_at: number | null;
};

type PaycheckSqlRow = {
  seq: string;
  id: string;
  paycheck_pda: string;
  inflow: string;
  invest_total: string;
  recorded_sig: string;
  recorded_at: number;
  expires_at: number;
  inflow_sig: string | null;
  sender: string | null;
  status: PaycheckRow["status"];
};

function toLegRow(row: LegSqlRow): LegRow {
  return {
    id: row.id,
    paycheckId: row.paycheck_id,
    seq: row.seq,
    idx: row.idx,
    mint: row.mint,
    amountIn: row.amount_in,
    bandBps: row.band_bps,
    status: row.status,
    waitReason: row.wait_reason,
    nextAttemptAt: row.next_attempt_at,
    attemptCount: row.attempt_count,
    executingSince: row.executing_since,
    outAmount: row.out_amount,
    fee: row.fee,
    issuerFee: row.issuer_fee,
    uiMultiplier: row.ui_multiplier,
    refPriceE9: row.ref_price_e9,
    execPriceE9: row.exec_price_e9,
    premiumBps: row.premium_bps,
    executedSig: row.executed_sig,
    executedAt: row.executed_at,
    verifiedAt: row.verified_at,
  };
}

function toPaycheckRow(row: PaycheckSqlRow): PaycheckRow {
  return {
    id: row.id,
    seq: row.seq,
    paycheckPda: row.paycheck_pda,
    inflow: row.inflow,
    investTotal: row.invest_total,
    recordedSig: row.recorded_sig,
    recordedAt: row.recorded_at,
    expiresAt: row.expires_at,
    inflowSig: row.inflow_sig,
    sender: row.sender,
    status: row.status,
  };
}

const bigintJson = (_key: string, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value;

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/** The API shape of a leg, shared by realtime events and the paycheck routes. */
export function legView(row: LegRow): api.Leg {
  const reason = api.WaitReasonSchema.safeParse(row.waitReason);
  return {
    id: row.id,
    idx: row.idx,
    mint: row.mint,
    symbol: assetByMint(row.mint)?.symbol ?? row.mint.slice(0, 4),
    amountIn: row.amountIn,
    status: row.status,
    waitReason: reason.success ? reason.data : null,
    nextAttemptAt: iso(row.nextAttemptAt),
    outAmount: row.outAmount,
    fee: row.fee,
    issuerFee: row.issuerFee,
    uiMultiplier: row.uiMultiplier,
    sharesUi:
      row.outAmount !== null && row.uiMultiplier !== null
        ? sharesUi(BigInt(row.outAmount), assetByMint(row.mint)?.decimals ?? 0, row.uiMultiplier)
        : null,
    refPriceE9: row.refPriceE9,
    execPriceE9: row.execPriceE9,
    premiumBps: row.premiumBps,
    executedSig: row.executedSig,
    executedAt: iso(row.executedAt),
    verifiedAt: iso(row.verifiedAt),
  };
}

function attemptRows(attempts: readonly AttemptRecord[]): AttemptRow[] {
  return attempts.map((attempt) => ({
    attemptNo: attempt.attemptNo,
    kind: attempt.kind,
    outcome: attempt.outcome,
    programErrorCode: attempt.programErrorCode,
    reason: attempt.reason,
    signature: attempt.signature,
    cuUsed: attempt.cuUsed,
    priorityFeeLamports: attempt.priorityFeeLamports?.toString() ?? null,
    quote: attempt.quote,
    reference: attempt.reference,
  }));
}

export type ExecutionMessage = { routerId: string; seq: string; legIds: string[]; key: string };
export type VerifyMessage = {
  routerId: string;
  legId: string;
  signature: string;
  evidence: Record<string, unknown>;
};

/**
 * One per router (`idFromName(routerId)`). Serialises detection, recording, leg attempts and
 * waits, keeps at most one transaction batch in flight, stores state in SQLite, mirrors every
 * transition to Supabase and fans events out to the owner's UserHub.
 */
export class RouterActor extends DurableObject<Env> {
  private engine: Engine | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      for (const statement of SCHEMA) ctx.storage.sql.exec(statement);
      const columns = ctx.storage.sql
        .exec<{ name: string }>("select name from pragma_table_info('legs')")
        .toArray()
        .map((column) => column.name);
      if (!columns.includes("ui_multiplier")) {
        ctx.storage.sql.exec("alter table legs add column ui_multiplier text");
      }
    });
  }

  private getEngine(): Engine {
    this.engine ??= createEngine(this.env);
    return this.engine;
  }

  private meta(): Meta | null {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("select value from meta where key = 'router'")
      .toArray()[0];
    return row ? (JSON.parse(row.value) as Meta) : null;
  }

  private saveMeta(meta: Meta): void {
    this.ctx.storage.sql.exec(
      "insert into meta (key, value) values ('router', ?) on conflict (key) do update set value = excluded.value",
      JSON.stringify(meta),
    );
  }

  private requireMeta(): Meta {
    const meta = this.meta();
    if (!meta) throw new Error("RouterActor used before init");
    return meta;
  }

  /** Registers (or refreshes) the router this actor owns. */
  init(router: RouterRef, rules: InflowRules): void {
    const existing = this.meta();
    this.saveMeta({
      router,
      rules: {
        minInflow: rules.minInflow.toString(),
        appThreshold: rules.appThreshold.toString(),
        taggedPayersOnly: rules.taggedPayersOnly,
        taggedPayers: [...rules.taggedPayers],
      },
      lastInflowSig: existing?.lastInflowSig ?? null,
    });
  }

  /** True while a record or execution batch is in flight; the sweep skips busy routers. */
  busy(): boolean {
    return this.currentJob() !== null;
  }

  private currentJob(): { seq: string; started_at: number } | null {
    const job = this.ctx.storage.sql
      .exec<{ seq: string; started_at: number }>("select seq, started_at from job where id = 1")
      .toArray()[0];
    if (!job) return null;
    if (Date.now() - job.started_at > STUCK_JOB_MS) {
      log.warn("clearing a stuck job", { routerId: this.meta()?.router.routerId, seq: job.seq });
      this.ctx.storage.sql.exec("delete from job");
      return null;
    }
    return job;
  }

  private startJob(seq: string): void {
    this.ctx.storage.sql.exec(
      "insert into job (id, seq, started_at) values (1, ?, ?)",
      seq,
      Date.now(),
    );
  }

  private finishJob(): void {
    this.ctx.storage.sql.exec("delete from job");
  }

  /**
   * A sweep hit for this router: resolve the inflow, classify it, then record or skip it. Only
   * one record or batch runs at a time; a hit while busy is dropped and the next sweep retries.
   */
  async candidate(hit: SweepHit): Promise<{ handled: boolean }> {
    const meta = this.requireMeta();
    if (this.currentJob()) return { handled: false };
    this.startJob("record");
    try {
      await this.handleCandidate(meta, hit);
    } finally {
      this.finishJob();
    }
    await this.dispatchNext();
    return { handled: true };
  }

  private async handleCandidate(meta: Meta, hit: SweepHit): Promise<void> {
    const { router } = meta;
    const engine = this.getEngine();
    const sources = await engine.resolveInflows(router.payIn, meta.lastInflowSig);
    const newest = sources[0] ?? null;
    const sender = newest?.sender ?? null;
    const detectedAt = new Date();
    await this.publish({
      type: "paycheck.detected",
      data: {
        routerId: router.routerId,
        routerPda: router.routerPda,
        amount: hit.delta.toString(),
        sender,
        signature: newest?.signature ?? null,
        detectedAt: detectedAt.toISOString(),
      },
    });
    const rules: InflowRules = {
      minInflow: BigInt(meta.rules.minInflow),
      appThreshold: BigInt(meta.rules.appThreshold),
      taggedPayersOnly: meta.rules.taggedPayersOnly,
      taggedPayers: meta.rules.taggedPayers,
    };
    const decision = engine.classify({ amount: hit.delta, sender }, router, rules);
    const inflowSig = newest?.signature ?? null;

    if (decision.action === "skip") {
      const skipped = await engine.skipInflow(router);
      log.info("inflow skipped", {
        routerId: router.routerId,
        reason: decision.reason,
        signature: skipped.signature,
      });
      if (inflowSig) {
        await this.mirror({
          op: "inflow",
          routerId: router.routerId,
          signature: inflowSig,
          slot: (newest?.slot ?? hit.slot).toString(),
          amount: hit.delta.toString(),
          sender,
          classification:
            decision.reason === "below_minimum"
              ? "skipped_below_minimum"
              : decision.reason === "untagged_sender"
                ? "skipped_untagged"
                : decision.reason === "self_transfer"
                  ? "skipped_self_transfer"
                  : "skipped_protocol",
          decidedAt: Date.now(),
        });
      }
      this.saveMeta({ ...meta, lastInflowSig: inflowSig ?? meta.lastInflowSig });
      return;
    }

    const outcome = await engine.recordPaycheck(router);
    if (outcome.kind !== "recorded") {
      log.warn("record_paycheck did not record", {
        routerId: router.routerId,
        outcome,
      });
      return;
    }
    const recorded = outcome.paycheck;
    const paycheck: PaycheckRow = {
      id: crypto.randomUUID(),
      seq: recorded.seq.toString(),
      paycheckPda: recorded.paycheckPda,
      inflow: recorded.inflow.toString(),
      investTotal: recorded.investTotal.toString(),
      recordedSig: recorded.signature,
      recordedAt: recorded.recordedAt.getTime(),
      expiresAt: recorded.expiresAt.getTime(),
      inflowSig,
      sender,
      status: "open",
    };
    this.ctx.storage.sql.exec(
      `insert into paychecks (seq, id, paycheck_pda, inflow, invest_total, recorded_sig, recorded_at,
        expires_at, inflow_sig, sender, status) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict (seq) do nothing`,
      paycheck.seq,
      paycheck.id,
      paycheck.paycheckPda,
      paycheck.inflow,
      paycheck.investTotal,
      paycheck.recordedSig,
      paycheck.recordedAt,
      paycheck.expiresAt,
      paycheck.inflowSig,
      paycheck.sender,
      paycheck.status,
    );
    for (const leg of recorded.legs) {
      this.ctx.storage.sql.exec(
        `insert into legs (id, paycheck_id, seq, idx, mint, amount_in, band_bps, status)
          values (?, ?, ?, ?, ?, ?, ?, 'pending') on conflict (seq, idx) do nothing`,
        crypto.randomUUID(),
        paycheck.id,
        paycheck.seq,
        leg.idx,
        leg.mint,
        leg.amountIn.toString(),
        leg.bandBps,
      );
    }
    this.saveMeta({ ...meta, lastInflowSig: inflowSig ?? meta.lastInflowSig });
    const legs = this.legsOf(paycheck.seq);
    if (inflowSig) {
      await this.mirror({
        op: "inflow",
        routerId: router.routerId,
        signature: inflowSig,
        slot: (newest?.slot ?? hit.slot).toString(),
        amount: hit.delta.toString(),
        sender,
        classification: "recorded",
        decidedAt: Date.now(),
      });
    }
    await this.mirror({ op: "paycheck", routerId: router.routerId, paycheck, legs });
    await this.publish({
      type: "paycheck.recorded",
      data: { routerId: router.routerId, paycheck: this.paycheckView(paycheck, legs) },
    });
    await this.notify("paycheck.recorded", {
      inflow: paycheck.inflow,
      investTotal: paycheck.investTotal,
      sender: paycheck.sender,
    });
  }

  private legsOf(seq: string): LegRow[] {
    return this.ctx.storage.sql
      .exec<LegSqlRow>("select * from legs where seq = ? order by idx", seq)
      .toArray()
      .map(toLegRow);
  }

  private legById(legId: string): LegRow | null {
    const row = this.ctx.storage.sql
      .exec<LegSqlRow>("select * from legs where id = ?", legId)
      .toArray()[0];
    return row ? toLegRow(row) : null;
  }

  private paycheckBySeq(seq: string): PaycheckRow | null {
    const row = this.ctx.storage.sql
      .exec<PaycheckSqlRow>("select * from paychecks where seq = ?", seq)
      .toArray()[0];
    return row ? toPaycheckRow(row) : null;
  }

  private paycheckView(paycheck: PaycheckRow, legs: LegRow[]): api.PaycheckSummary {
    const meta = this.requireMeta();
    return {
      id: paycheck.id,
      routerId: meta.router.routerId,
      seq: paycheck.seq,
      paycheckPda: paycheck.paycheckPda,
      inflow: paycheck.inflow,
      investTotal: paycheck.investTotal,
      sender: paycheck.sender,
      inflowSig: paycheck.inflowSig,
      recordedSig: paycheck.recordedSig,
      recordedAt: new Date(paycheck.recordedAt).toISOString(),
      expiresAt: new Date(paycheck.expiresAt).toISOString(),
      status: paycheck.status,
      legs: legs.map(legView),
    };
  }

  /** Every paycheck this actor holds, newest first, for reads while Supabase lags. */
  paychecks(): api.PaycheckSummary[] {
    return this.ctx.storage.sql
      .exec<PaycheckSqlRow>("select * from paychecks order by cast(seq as integer) desc")
      .toArray()
      .map(toPaycheckRow)
      .map((paycheck) => this.paycheckView(paycheck, this.legsOf(paycheck.seq)));
  }

  /**
   * Starts the next batch: every due pending leg of the oldest open paycheck, sent to the
   * Executor as one message so its legs share one Hermes post (section 8.5).
   */
  private async dispatchNext(): Promise<void> {
    if (this.currentJob()) return;
    if ((await binding(this.env.REGISTRY, "REGISTRY").get(CRANK_PAUSED_KEY)) === "1") return;
    const meta = this.meta();
    if (!meta) return;
    const now = Date.now();
    const due = this.ctx.storage.sql
      .exec<LegSqlRow>(
        `select l.* from legs l join paychecks p on p.seq = l.seq
          where p.status = 'open' and l.status in ('pending', 'waiting')
            and (l.next_attempt_at is null or l.next_attempt_at <= ?)
            and p.expires_at > ?
          order by cast(l.seq as integer) asc`,
        now,
        now,
      )
      .toArray()
      .map(toLegRow);
    const first = due[0];
    if (!first) return;
    const batch = due.filter((leg) => leg.seq === first.seq);
    this.startJob(first.seq);
    const key = `${meta.router.routerPda}:${first.seq}:${batch.map((leg) => leg.idx).join("+")}:${Math.max(...batch.map((leg) => leg.attemptCount))}`;
    const message: ExecutionMessage = {
      routerId: meta.router.routerId,
      seq: first.seq,
      legIds: batch.map((leg) => leg.id),
      key,
    };
    try {
      await binding(this.env.EXECUTIONS, "EXECUTIONS").send(message, { contentType: "v8" });
    } catch (error) {
      this.finishJob();
      throw error;
    }
  }

  /** The Executor asks for the jobs it was sent, with their current attempt numbers. */
  jobs(seq: string, legIds: readonly string[]): LegJob[] {
    const meta = this.requireMeta();
    const paycheck = this.paycheckBySeq(seq);
    if (!paycheck) return [];
    return this.legsOf(seq)
      .filter((leg) => legIds.includes(leg.id) && ["pending", "waiting"].includes(leg.status))
      .map((leg) => ({
        legId: leg.id,
        router: meta.router,
        paycheckPda: paycheck.paycheckPda,
        seq: BigInt(seq),
        idx: leg.idx,
        mint: leg.mint,
        amountIn: BigInt(leg.amountIn),
        bandBps: leg.bandBps,
        attemptNo: leg.attemptCount,
      }));
  }

  private updateLeg(leg: LegRow): void {
    this.ctx.storage.sql.exec(
      `update legs set status = ?, wait_reason = ?, next_attempt_at = ?, attempt_count = ?,
        executing_since = ?, out_amount = ?, fee = ?, issuer_fee = ?, ui_multiplier = ?, ref_price_e9 = ?,
        exec_price_e9 = ?, premium_bps = ?, executed_sig = ?, executed_at = ?, verified_at = ?
        where id = ?`,
      leg.status,
      leg.waitReason,
      leg.nextAttemptAt,
      leg.attemptCount,
      leg.executingSince,
      leg.outAmount,
      leg.fee,
      leg.issuerFee,
      leg.uiMultiplier,
      leg.refPriceE9,
      leg.execPriceE9,
      leg.premiumBps,
      leg.executedSig,
      leg.executedAt,
      leg.verifiedAt,
      leg.id,
    );
  }

  private async emitLeg(
    type: "leg.waiting" | "leg.executing" | "leg.executed" | "leg.expired" | "leg.cancelled",
    leg: LegRow,
    extra: { attemptNo?: number } = {},
  ): Promise<void> {
    const meta = this.requireMeta();
    const base = { routerId: meta.router.routerId, paycheckId: leg.paycheckId, leg: legView(leg) };
    if (type === "leg.executing") {
      await this.publish({
        type,
        data: { ...base, attemptNo: extra.attemptNo ?? leg.attemptCount },
      });
    } else {
      await this.publish({ type, data: base });
    }
  }

  async legExecuting(legId: string): Promise<void> {
    const leg = this.legById(legId);
    if (!leg || !["pending", "waiting"].includes(leg.status)) return;
    const updated: LegRow = { ...leg, status: "executing", executingSince: Date.now() };
    this.updateLeg(updated);
    await this.mirror({ op: "leg", leg: updated });
    await this.emitLeg("leg.executing", updated, { attemptNo: leg.attemptCount });
  }

  async legOutcome(legId: string, outcome: LegOutcome): Promise<void> {
    const leg = this.legById(legId);
    if (!leg) return;
    const attemptCount = leg.attemptCount + Math.max(1, outcome.attempts.length);
    await this.mirror({ op: "attempts", legId, attempts: attemptRows(outcome.attempts) });
    if (outcome.kind === "executed") {
      const executed: LegRow = {
        ...leg,
        status: "executed",
        waitReason: null,
        nextAttemptAt: null,
        attemptCount,
        executingSince: null,
        outAmount: outcome.leg.outAmount.toString(),
        fee: outcome.leg.fee.toString(),
        issuerFee: outcome.leg.issuerFee.toString(),
        uiMultiplier: outcome.leg.uiMultiplier,
        refPriceE9: outcome.leg.refPriceE9.toString(),
        execPriceE9: outcome.leg.execPriceE9?.toString() ?? null,
        premiumBps: outcome.leg.premiumBps,
        executedSig: outcome.leg.signature,
        executedAt: Date.now(),
      };
      this.updateLeg(executed);
      await this.mirror({ op: "leg", leg: executed });
      await this.emitLeg("leg.executed", executed);
      const verify: VerifyMessage = {
        routerId: this.requireMeta().router.routerId,
        legId,
        signature: outcome.leg.signature,
        evidence: outcome.leg.evidence,
      };
      await binding(this.env.VERIFY, "VERIFY").send(verify, { contentType: "v8" });
      return;
    }
    const reason: WaitReason | null = outcome.kind === "waiting" ? outcome.reason : null;
    const priorSameReason = leg.waitReason === reason ? leg.attemptCount : 0;
    const delaySecs = reason ? retryDelaySecs(reason, priorSameReason) : 60;
    const waiting: LegRow = {
      ...leg,
      status: reason === "EXPIRED" ? "expired" : "waiting",
      waitReason: reason ?? "LANDING",
      nextAttemptAt: delaySecs === null ? null : Date.now() + delaySecs * 1000,
      attemptCount,
      executingSince: null,
      // The last attempt's quote against its reference, so a PREMIUM_TOO_HIGH wait shows both.
      refPriceE9:
        outcome.kind === "waiting" && outcome.measured
          ? outcome.measured.refPriceE9.toString()
          : null,
      premiumBps:
        outcome.kind === "waiting" && outcome.measured ? outcome.measured.premiumBps : null,
    };
    this.updateLeg(waiting);
    await this.mirror({ op: "leg", leg: waiting });
    const firstWait = leg.status !== "waiting" || leg.waitReason !== waiting.waitReason;
    if (firstWait) {
      await this.notify(waiting.status === "expired" ? "slice.expired" : "slice.waiting", {
        symbol: assetByMint(leg.mint)?.symbol ?? null,
        amountIn: leg.amountIn,
        reason: waiting.waitReason,
      });
    }
    await this.emitLeg(waiting.status === "expired" ? "leg.expired" : "leg.waiting", waiting);
    if (outcome.kind === "failed") {
      log.error("leg attempt failed", {
        legId,
        error: outcome.error,
        code: outcome.programErrorCode,
      });
    }
  }

  /** The Executor finished a batch: release the router and schedule what comes next. */
  async batchDone(seq: string): Promise<void> {
    const job = this.currentJob();
    if (job?.seq === seq) this.finishJob();
    await this.completePaychecks();
    await this.scheduleAlarm();
    await this.dispatchNext();
  }

  /** What the Verifier needs to re-derive one executed leg. */
  verifyJob(legId: string, signature: string, evidence: Record<string, unknown>): VerifyJob | null {
    const meta = this.requireMeta();
    const leg = this.legById(legId);
    if (!leg || leg.status !== "executed") return null;
    return {
      legId,
      router: meta.router,
      seq: BigInt(leg.seq),
      idx: leg.idx,
      mint: leg.mint,
      signature,
      evidence,
    };
  }

  async legVerified(legId: string, verification: VerificationOutcome): Promise<void> {
    const leg = this.legById(legId);
    if (!leg) return;
    const verified: LegRow = {
      ...leg,
      status: verification.matches ? "verified" : "unverified",
      verifiedAt: verification.matches ? Date.now() : null,
    };
    this.updateLeg(verified);
    const view = {
      rpcProvider: verification.rpcProvider,
      finalizedSlot: verification.finalizedSlot?.toString() ?? null,
      ownerDeltaRaw: verification.ownerDeltaRaw?.toString() ?? null,
      ownerUsdcDelta: verification.ownerUsdcDelta?.toString() ?? null,
      recomputedMinOut: verification.recomputedMinOut?.toString() ?? null,
      recomputedPremiumBps: verification.recomputedPremiumBps,
      matches: verification.matches,
      diff: verification.diff,
    };
    await this.mirror({ op: "leg", leg: verified });
    await this.mirror({
      op: "verification",
      legId,
      verification: {
        ...view,
        hermesPublishTime: verification.hermesPublishTime?.getTime() ?? null,
      },
    });
    const meta = this.requireMeta();
    await this.publish({
      type: verification.matches ? "leg.verified" : "leg.unverified",
      data: {
        routerId: meta.router.routerId,
        paycheckId: verified.paycheckId,
        leg: legView(verified),
        verification: { ...view, createdAt: new Date().toISOString() },
      },
    });
    await this.completePaychecks();
  }

  /** Marks a waiting leg cancelled once the owner's `cancel_leg` transaction landed. */
  async legCancelled(legId: string): Promise<void> {
    const leg = this.legById(legId);
    if (!leg || !["pending", "waiting"].includes(leg.status)) return;
    const cancelled: LegRow = { ...leg, status: "cancelled", nextAttemptAt: null };
    this.updateLeg(cancelled);
    await this.mirror({ op: "leg", leg: cancelled });
    await this.emitLeg("leg.cancelled", cancelled);
    await this.completePaychecks();
  }

  /** A paycheck is complete once every leg is final. */
  private async completePaychecks(): Promise<void> {
    const open = this.ctx.storage.sql
      .exec<PaycheckSqlRow>("select * from paychecks where status = 'open'")
      .toArray();
    for (const row of open) {
      const legs = this.legsOf(row.seq);
      const final = legs.every((leg) =>
        ["verified", "unverified", "expired", "cancelled"].includes(leg.status),
      );
      if (!final) continue;
      this.ctx.storage.sql.exec("update paychecks set status = 'complete' where seq = ?", row.seq);
      await this.mirror({ op: "paycheck_status", paycheckId: row.id, status: "complete" });
      await this.notify("paycheck.complete", { investTotal: row.invest_total });
    }
  }

  private async scheduleAlarm(): Promise<void> {
    const next = this.ctx.storage.sql
      .exec<{ at: number | null }>(
        `select min(at) as at from (
          select next_attempt_at as at from legs
            where status in ('pending', 'waiting') and next_attempt_at is not null
          union all
          select p.expires_at as at from paychecks p
            where p.status = 'open' and exists (
              select 1 from legs l where l.seq = p.seq and l.status in ('pending', 'waiting')))`,
      )
      .one().at;
    const outbox = this.ctx.storage.sql
      .exec<{ n: number }>("select count(*) as n from outbox")
      .one().n;
    const candidates = [next, outbox > 0 ? Date.now() + OUTBOX_RETRY_MS : null].filter(
      (value): value is number => value !== null,
    );
    if (candidates.length === 0) return;
    const at = Math.max(Date.now() + 1_000, Math.min(...candidates));
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }

  override async alarm(): Promise<void> {
    await this.flushOutbox();
    await this.expireDue();
    await this.dispatchNext();
    await this.scheduleAlarm();
  }

  /** Legs still unexecuted when their paycheck expires: `expire_leg`, USDC stays with the owner. */
  private async expireDue(): Promise<void> {
    if (this.currentJob()) return;
    const meta = this.meta();
    if (!meta) return;
    const now = Date.now();
    const due = this.ctx.storage.sql
      .exec<LegSqlRow>(
        `select l.* from legs l join paychecks p on p.seq = l.seq
          where l.status in ('pending', 'waiting') and p.expires_at <= ?`,
        now,
      )
      .toArray()
      .map(toLegRow);
    for (const leg of due) {
      const paycheck = this.paycheckBySeq(leg.seq);
      if (!paycheck) continue;
      try {
        await this.getEngine().expireLeg({
          legId: leg.id,
          router: meta.router,
          paycheckPda: paycheck.paycheckPda,
          seq: BigInt(leg.seq),
          idx: leg.idx,
          mint: leg.mint,
          amountIn: BigInt(leg.amountIn),
          bandBps: leg.bandBps,
          attemptNo: leg.attemptCount,
        });
      } catch (error) {
        log.warn("expire_leg failed", { legId: leg.id, error });
        continue;
      }
      const expired: LegRow = {
        ...leg,
        status: "expired",
        waitReason: "EXPIRED",
        nextAttemptAt: null,
      };
      this.updateLeg(expired);
      await this.mirror({ op: "leg", leg: expired });
      await this.emitLeg("leg.expired", expired);
    }
    if (due.length > 0) await this.completePaychecks();
  }

  /** Queues a milestone for the Notifier; channels and preferences are decided there. */
  private async notify(
    event: "paycheck.recorded" | "paycheck.complete" | "slice.waiting" | "slice.expired",
    data: Record<string, string | null>,
  ): Promise<void> {
    const userId = this.meta()?.router.userId;
    if (!userId) return;
    try {
      await binding(this.env.NOTIFY, "NOTIFY").send({ userId, event, data }, { contentType: "v8" });
    } catch (error) {
      log.warn("notify enqueue failed", { event, error });
    }
  }

  private async publish(event: PublishInput): Promise<void> {
    const userId = this.meta()?.router.userId;
    if (!userId) return;
    try {
      const hubs = binding(this.env.USER_HUB, "USER_HUB");
      const hub = hubs.get(hubs.idFromName(userId));
      await hub.publish(event);
    } catch (error) {
      log.warn("realtime publish failed", { type: event.type, error });
    }
  }

  /**
   * Queues a Supabase write in the SQLite outbox and flushes it from an immediate alarm, so a
   * slow or unavailable database never delays the chain or the realtime stream (runbook: the
   * Durable Objects buffer offchain writes and flush on recovery).
   */
  private async mirror(op: MirrorOp): Promise<void> {
    this.ctx.storage.sql.exec(
      "insert into outbox (payload) values (?)",
      JSON.stringify(op, bigintJson),
    );
    const current = await this.ctx.storage.getAlarm();
    const soon = Date.now() + 100;
    if (current === null || current > soon) await this.ctx.storage.setAlarm(soon);
  }

  private async flushOutbox(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<{ id: number; payload: string }>("select id, payload from outbox order by id limit 100")
      .toArray();
    if (rows.length === 0) return;
    const db = createDb(binding(this.env.HYPERDRIVE, "HYPERDRIVE"));
    for (const row of rows) {
      try {
        await applyMirror(db, JSON.parse(row.payload) as MirrorOp);
        this.ctx.storage.sql.exec("delete from outbox where id = ?", row.id);
      } catch (error) {
        log.warn("mirror write deferred", { error });
        return;
      }
    }
  }
}
