import { type api, assetByMint } from "@paycheck-router/shared";
import { address } from "@solana/kit";
import { and, eq, inArray } from "drizzle-orm";
import { authorityPdaFor, payInFor, routerPdaFor } from "../chain/accounts.ts";
import type { Db } from "../db/client.ts";
import { payerTags, routerLegs, routers, wallets } from "../db/schema.ts";
import { inflowWatcher, routerActorFor } from "../do/stubs.ts";
import type { RouterRef, RouterState } from "../engine/types.ts";
import type { Env } from "../env.ts";
import type { Services } from "../http/context.ts";

type RouterRow = typeof routers.$inferSelect;

/**
 * Adopts a router that exists onchain for one of the user's wallets: writes the Supabase row and
 * its legs, then hands it to its RouterActor and to the InflowWatcher.
 */
export async function registerRouter(
  env: Env,
  services: Services,
  input: { userId: string; walletId: string; owner: string; createdSig: string | null },
): Promise<RouterRow> {
  const routerPda = await routerPdaFor(address(env.PROGRAM_ID), address(input.owner));
  const state = await services.engine().readRouter(routerPda);
  if (!state) throw new Error(`router ${routerPda} does not exist onchain`);
  const authority = await authorityPdaFor(address(env.PROGRAM_ID), routerPda);
  const values = {
    userId: input.userId,
    walletId: input.walletId,
    owner: input.owner,
    routerPda,
    authorityPda: authority,
    payInAta: state.payIn,
    status: state.paused ? ("paused" as const) : ("active" as const),
    investBps: state.investBps,
    minInflow: state.minInflow,
    dailyCap: state.dailyCap,
    maxWaitSecs: state.maxWaitSecs,
    autoConvert: state.autoConvert,
    recorder: state.recorder,
    watermark: state.watermark,
    paycheckSeq: state.paycheckSeq,
    onchainSnapshot: snapshotOf(state),
    createdSig: input.createdSig,
    closedAt: null,
    updatedAt: services.now(),
  };
  const row = await services.db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(routers)
      .values(values)
      .onConflictDoUpdate({
        target: routers.routerPda,
        set: { ...values, createdSig: input.createdSig ?? undefined },
      })
      .returning();
    if (!saved) throw new Error("router upsert returned no row");
    await tx.delete(routerLegs).where(eq(routerLegs.routerId, saved.id));
    const legs = state.legs.map((leg, idx) => ({
      routerId: saved.id,
      idx,
      assetMint: leg.mint,
      weightBps: leg.weightBps,
      bandBps: leg.bandBps,
      enabled: leg.enabled,
      colorSlot: idx + 1,
    }));
    if (legs.length > 0) await tx.insert(routerLegs).values(legs);
    return saved;
  });
  await activateRouter(env, services.db, row);
  return row;
}

export function refOf(row: RouterRow): RouterRef {
  return {
    routerId: row.id,
    userId: row.userId,
    routerPda: row.routerPda,
    owner: row.owner,
    payIn: row.payInAta,
    authority: row.authorityPda,
  };
}

/** (Re)initialises the actor with the owner's rules and puts the pay-in account under watch. */
export async function activateRouter(env: Env, db: Db, row: RouterRow): Promise<void> {
  const tags = await db
    .select({ payer: payerTags.payerOwner })
    .from(payerTags)
    .where(eq(payerTags.routerId, row.id));
  const ref = refOf(row);
  await routerActorFor(env, row.id).init(ref, {
    minInflow: row.minInflow,
    appThreshold: row.appThreshold ?? 0n,
    taggedPayersOnly: row.payerRule === "tagged",
    taggedPayers: tags.map((tag) => tag.payer),
  });
  if (row.status !== "closed") await inflowWatcher(env).watch(ref);
}

function snapshotOf(state: RouterState): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(state, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
  ) as Record<string, unknown>;
}

/** Registers routers the user's wallets hold onchain but Supabase has not seen yet. */
export async function syncUserRouters(env: Env, services: Services, userId: string): Promise<void> {
  const owned = await services.db
    .select({ id: wallets.id, address: wallets.address })
    .from(wallets)
    .where(eq(wallets.userId, userId));
  if (owned.length === 0) return;
  const known = await services.db
    .select({ owner: routers.owner })
    .from(routers)
    .where(
      inArray(
        routers.owner,
        owned.map((wallet) => wallet.address),
      ),
    );
  const knownOwners = new Set(known.map((row) => row.owner));
  for (const wallet of owned) {
    if (knownOwners.has(wallet.address)) continue;
    const payIn = await payInFor(env, services.chain, wallet.address);
    if (!payIn.routerExists) continue;
    await registerRouter(env, services, {
      userId,
      walletId: wallet.id,
      owner: wallet.address,
      createdSig: null,
    });
  }
}

export async function routersOf(db: Db, userId: string): Promise<RouterRow[]> {
  return db.select().from(routers).where(eq(routers.userId, userId));
}

export async function routerView(
  env: Env,
  services: Services,
  row: RouterRow,
): Promise<api.Router> {
  const [legRows, payIn] = await Promise.all([
    services.db
      .select()
      .from(routerLegs)
      .where(eq(routerLegs.routerId, row.id))
      .orderBy(routerLegs.idx),
    payInFor(env, services.chain, row.owner),
  ]);
  const delegated = payIn.delegate === row.authorityPda ? payIn.delegatedAmount : 0n;
  return {
    id: row.id,
    routerPda: row.routerPda,
    authorityPda: row.authorityPda,
    owner: row.owner,
    payInAta: row.payInAta,
    status: row.status,
    investBps: row.investBps,
    minInflow: row.minInflow.toString(),
    appThreshold: row.appThreshold?.toString() ?? null,
    dailyCap: row.dailyCap.toString(),
    maxWaitSecs: row.maxWaitSecs,
    autoConvert: row.autoConvert,
    recorder: row.recorder,
    payerRule: row.payerRule,
    legs: legRows.map((leg) => ({
      idx: leg.idx,
      mint: leg.assetMint,
      symbol: assetByMint(leg.assetMint)?.symbol ?? leg.assetMint.slice(0, 4),
      weightBps: leg.weightBps,
      bandBps: leg.bandBps,
      enabled: leg.enabled,
      colorSlot: Math.min(7, Math.max(0, leg.colorSlot - 1)),
    })),
    allowance: { delegate: payIn.delegate, amount: delegated.toString() },
    usdcBalance: payIn.balance.toString(),
    watermark: (row.watermark ?? 0n).toString(),
    createdSig: row.createdSig,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function ownedRouter(
  db: Db,
  userId: string,
  routerId: string,
): Promise<RouterRow | null> {
  const [row] = await db
    .select()
    .from(routers)
    .where(and(eq(routers.id, routerId), eq(routers.userId, userId)))
    .limit(1);
  return row ?? null;
}
