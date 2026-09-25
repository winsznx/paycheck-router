import { DurableObject } from "cloudflare:workers";
import { createEngine } from "../engine/factory.ts";
import type { Engine, RouterRef, SweepHit } from "../engine/types.ts";
import type { Env } from "../env.ts";
import { log } from "../log.ts";

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
      await this.env.INFLOWS.send(message, { contentType: "v8" });
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

  override async alarm(): Promise<void> {
    try {
      await this.sweep();
    } catch (error) {
      log.warn("reconcile sweep failed", { error });
    }
    if (this.surfnet) await this.ctx.storage.setAlarm(Date.now() + SURFNET_SWEEP_MS);
  }
}
