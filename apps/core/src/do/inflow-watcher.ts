import { DurableObject } from "cloudflare:workers";
import { binding } from "../config.ts";
import { createDb } from "../db/client.ts";
import { routers as routerRows } from "../db/schema.ts";
import { clearForkRows, EPOCH_CHECK_MS, type ForkView } from "../demo/fork-state.ts";
import { type ForkEpoch, markEpoch, readEpoch } from "../demo/surfnet.ts";
import { createEngine } from "../engine/factory.ts";
import type { Engine, RouterRef, SweepHit } from "../engine/types.ts";
import type { Env } from "../env.ts";
import { log } from "../log.ts";
import { routerActorFor } from "./stubs.ts";

/** Surfnets have no Helius webhook, so the sweep runs from this alarm (section 8.1). */
export const SURFNET_SWEEP_MS = 2_000;
/** The same router and balance is not queued twice inside this window. */
const DEDUPE_MS = 30_000;

export type InflowMessage = { routerId: string; hit: SweepHit };

type WatchedRow = {
  router_pda: string;
  router_id: string;
  user_id: string | null;
  owner: string;
  pay_in: string;
  authority: string;
};

/**
 * One instance (`idFromName("global")`). Owns the set of watched pay-in accounts, runs the
 * reconcile sweep, and dedupes candidates before they reach the `inflows` queue.
 */
export class InflowWatcher extends DurableObject<Env> {
  private engine: Engine | null = null;
  private readonly recent = new Map<string, { balance: bigint; at: number }>();
  private forkCheck: { at: number; view: Promise<ForkView> } | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        `create table if not exists watched (router_pda text primary key, router_id text not null,
          user_id text, owner text not null, pay_in text not null, authority text not null)`,
      );
      ctx.storage.sql.exec(
        "create table if not exists sweeps (id integer primary key check (id = 1), at integer not null, routers integer not null, hits integer not null, error text)",
      );
      ctx.storage.sql.exec(
        "create table if not exists fork_epoch (id integer primary key check (id = 1), epoch text not null, started_at integer not null)",
      );
    });
  }

  private getEngine(): Engine {
    this.engine ??= createEngine(this.env);
    return this.engine;
  }

  private get surfnet(): boolean {
    return Boolean(this.env.SURFNET_RPC_URL);
  }

  async watch(router: RouterRef): Promise<void> {
    this.ctx.storage.sql.exec(
      `insert into watched (router_pda, router_id, user_id, owner, pay_in, authority)
        values (?, ?, ?, ?, ?, ?)
        on conflict (router_pda) do update set router_id = excluded.router_id,
          user_id = excluded.user_id, pay_in = excluded.pay_in, authority = excluded.authority`,
      router.routerPda,
      router.routerId,
      router.userId,
      router.owner,
      router.payIn,
      router.authority,
    );
    await this.ensureRunning();
  }

  unwatch(routerPda: string): void {
    this.ctx.storage.sql.exec("delete from watched where router_pda = ?", routerPda);
  }

  watched(): RouterRef[] {
    return this.ctx.storage.sql
      .exec<WatchedRow>("select * from watched")
      .toArray()
      .map((row) => ({
        routerId: row.router_id,
        userId: row.user_id,
        routerPda: row.router_pda,
        owner: row.owner,
        payIn: row.pay_in,
        authority: row.authority,
      }));
  }

  /** Last sweep time and outcome, for `/status`. */
  lastSweep(): { at: number; routers: number; hits: number; error: string | null } | null {
    return (
      this.ctx.storage.sql
        .exec<{ at: number; routers: number; hits: number; error: string | null }>(
          "select at, routers, hits, error from sweeps where id = 1",
        )
        .toArray()[0] ?? null
    );
  }

  /** On surfnets, keeps the 2-second alarm loop alive. */
  async ensureRunning(): Promise<void> {
    if (!this.surfnet) return;
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + SURFNET_SWEEP_MS);
    }
  }

  /** One reconcile pass: every hit not already queued goes to the `inflows` queue. */
  async sweep(): Promise<SweepHit[]> {
    const routers = this.watched();
    if (routers.length === 0) return [];
    const now = Date.now();
    let hits: SweepHit[] = [];
    try {
      hits = await this.getEngine().sweep(routers, new Set());
    } catch (error) {
      this.recordSweep(now, routers.length, 0, String(error));
      throw error;
    }
    const byPda = new Map(routers.map((router) => [router.routerPda, router]));
    const fresh = hits.filter((hit) => {
      const seen = this.recent.get(hit.routerPda);
      return !seen || seen.balance !== hit.balance || now - seen.at > DEDUPE_MS;
    });
    for (const hit of fresh) {
      const router = byPda.get(hit.routerPda);
      if (!router) continue;
      this.recent.set(hit.routerPda, { balance: hit.balance, at: now });
      const message: InflowMessage = { routerId: router.routerId, hit };
      await binding(this.env.INFLOWS, "INFLOWS").send(message, { contentType: "v8" });
      log.info("inflow candidate", {
        routerId: router.routerId,
        delta: hit.delta,
        slot: hit.slot,
      });
    }
    this.recordSweep(now, routers.length, fresh.length, null);
    return fresh;
  }

  /** Lets the RouterActor release a router so an unchanged balance can be queued again. */
  release(routerPda: string): void {
    this.recent.delete(routerPda);
  }

  private recordSweep(at: number, routers: number, hits: number, error: string | null): void {
    this.ctx.storage.sql.exec(
      `insert into sweeps (id, at, routers, hits, error) values (1, ?, ?, ?, ?)
        on conflict (id) do update set at = excluded.at, routers = excluded.routers,
          hits = excluded.hits, error = excluded.error`,
      at,
      routers,
      hits,
      error,
    );
  }

  private storedEpoch(): ForkEpoch | null {
    const row = this.ctx.storage.sql
      .exec<{ epoch: string; started_at: number }>(
        "select epoch, started_at from fork_epoch where id = 1",
      )
      .toArray()[0];
    return row ? { id: row.epoch, startedAt: row.started_at } : null;
  }

  /**
   * The fork's current epoch, read from its marker at most every 10 seconds. A fork without the
   * marker is fresh from the snapshot: state tied to the previous fork is cleared first, then the
   * fork is marked. An unreachable fork reports the last epoch seen.
   */
  forkView(): Promise<ForkView> {
    const now = Date.now();
    if (this.forkCheck && now - this.forkCheck.at < EPOCH_CHECK_MS) return this.forkCheck.view;
    const view = this.checkFork(now);
    this.forkCheck = { at: now, view };
    view.catch(() => {
      this.forkCheck = null;
    });
    return view;
  }

  private async checkFork(now: number): Promise<ForkView> {
    const stored = this.storedEpoch();
    let onFork: ForkEpoch | null;
    try {
      onFork = await readEpoch(this.env);
    } catch (error) {
      log.warn("fork unreachable", { error: String(error) });
      return { epoch: stored, reachable: false };
    }
    if (stored && onFork?.id === stored.id) return { epoch: stored, reachable: true };
    if (stored) await this.clearFork(stored);
    const current = onFork ?? (await markEpoch(this.env, now));
    this.ctx.storage.sql.exec(
      `insert into fork_epoch (id, epoch, started_at) values (1, ?, ?)
        on conflict (id) do update set epoch = excluded.epoch, started_at = excluded.started_at`,
      current.id,
      current.startedAt,
    );
    log.info("fork epoch", { epoch: current.id, previous: stored?.id ?? null });
    return { epoch: current, reachable: true };
  }

  /** Forgets every router of the previous fork: its actor, its watch and its database rows. */
  private async clearFork(previous: ForkEpoch): Promise<void> {
    const db = createDb(binding(this.env.HYPERDRIVE, "HYPERDRIVE"));
    const ids = new Set(this.watched().map((router) => router.routerId));
    for (const row of await db.select({ id: routerRows.id }).from(routerRows)) ids.add(row.id);
    for (const id of ids) await routerActorFor(this.env, id).reset();
    await clearForkRows(db, previous.id);
    this.ctx.storage.sql.exec("delete from watched");
    this.ctx.storage.sql.exec("delete from sweeps");
    this.recent.clear();
    log.info("fork reset: previous fork state cleared", {
      previous: previous.id,
      routers: ids.size,
    });
  }

  override async alarm(): Promise<void> {
    if (this.env.RESET_EVERY_HOURS) {
      try {
        await this.forkView();
      } catch (error) {
        log.warn("fork epoch check failed", { error });
      }
    }
    try {
      await this.sweep();
    } catch (error) {
      log.warn("reconcile sweep failed", { error });
    }
    if (this.surfnet) await this.ctx.storage.setAlarm(Date.now() + SURFNET_SWEEP_MS);
  }
}
