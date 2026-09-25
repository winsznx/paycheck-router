import { api, assetByMint, TOKEN_2022_PROGRAM_ID } from "@paycheck-router/shared";
import { address } from "@solana/kit";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { Hono } from "hono";
import { explorerAddressUrl, explorerTxUrl } from "../config.ts";
import type { Db } from "../db/client.ts";
import { attempts, legs, paychecks, routerLegs, routers, verifications } from "../db/schema.ts";
import type { AppEnv } from "../http/context.ts";
import { readJson } from "../http/json.ts";
import { ApiError, notFound, parseOrThrow } from "../http/problem.ts";
import { rateLimit } from "../http/rate-limit.ts";
import { requireSession, sessionOf } from "../http/session.ts";
import { priceBoard } from "../pricing/reference.ts";
import { refOf } from "../services/routers.ts";

export const paycheckRoutes = new Hono<AppEnv>();

paycheckRoutes.use("/paychecks", requireSession, rateLimit("USER_LIMITER", "user"));
paycheckRoutes.use("/paychecks/*", requireSession, rateLimit("USER_LIMITER", "user"));
paycheckRoutes.use("/portfolio", requireSession, rateLimit("USER_LIMITER", "user"));
paycheckRoutes.use("/legs/*", requireSession, rateLimit("TX_LIMITER", "user"));

type LegRecord = typeof legs.$inferSelect;
type PaycheckRecord = typeof paychecks.$inferSelect;

const iso = (value: Date | null) => value?.toISOString() ?? null;
const str = (value: bigint | null) => value?.toString() ?? null;

export function legApi(leg: LegRecord): api.Leg {
  const reason = api.WaitReasonSchema.safeParse(leg.waitReason);
  return {
    id: leg.id,
    idx: leg.idx,
    mint: leg.assetMint,
    symbol: assetByMint(leg.assetMint)?.symbol ?? leg.assetMint.slice(0, 4),
    amountIn: leg.amountIn.toString(),
    status: leg.status,
    waitReason: reason.success ? reason.data : null,
    nextAttemptAt: iso(leg.nextAttemptAt),
    outAmount: str(leg.outAmount),
    fee: str(leg.fee),
    issuerFee: str(leg.issuerFee),
    refPriceE9: str(leg.refPriceE9),
    execPriceE9: str(leg.execPriceE9),
    premiumBps: leg.premiumBps,
    executedSig: leg.executedSig,
    executedAt: iso(leg.executedAt),
    verifiedAt: iso(leg.verifiedAt),
  };
}

function paycheckApi(row: PaycheckRecord, legRows: LegRecord[]): api.PaycheckSummary {
  return {
    id: row.id,
    routerId: row.routerId,
    seq: row.seq.toString(),
    paycheckPda: row.paycheckPda,
    inflow: row.inflow.toString(),
    investTotal: row.investTotal.toString(),
    sender: row.senderOwner,
    inflowSig: row.inflowSig,
    recordedSig: row.recordedSig,
    recordedAt: row.recordedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    status: api.PaycheckStatus.parse(row.status),
    legs: legRows.sort((a, b) => a.idx - b.idx).map(legApi),
  };
}

export function verificationApi(row: typeof verifications.$inferSelect): api.Verification {
  return {
    rpcProvider: row.rpcProvider,
    finalizedSlot: str(row.finalizedSlot),
    ownerDeltaRaw: str(row.ownerDeltaRaw),
    ownerUsdcDelta: str(row.ownerUsdcDelta),
    recomputedMinOut: str(row.recomputedMinOut),
    recomputedPremiumBps: row.recomputedPremiumBps,
    matches: row.matches,
    diff: row.diff ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function legsFor(db: Db, paycheckIds: string[]): Promise<Map<string, LegRecord[]>> {
  const rows =
    paycheckIds.length === 0
      ? []
      : await db.select().from(legs).where(inArray(legs.paycheckId, paycheckIds));
  const grouped = new Map<string, LegRecord[]>();
  for (const row of rows)
    grouped.set(row.paycheckId, [...(grouped.get(row.paycheckId) ?? []), row]);
  return grouped;
}

const PAGE = 20;

paycheckRoutes.get("/paychecks", async (c) => {
  const { db } = c.var.services;
  const { userId } = sessionOf(c);
  const cursor = c.req.query("cursor");
  const before = cursor ? new Date(cursor) : null;
  if (before && Number.isNaN(before.getTime()))
    throw new ApiError(400, "bad_request", "bad cursor");
  const rows = await db
    .select({ paycheck: paychecks })
    .from(paychecks)
    .innerJoin(routers, eq(routers.id, paychecks.routerId))
    .where(
      before
        ? and(eq(routers.userId, userId), lt(paychecks.recordedAt, before))
        : eq(routers.userId, userId),
    )
    .orderBy(desc(paychecks.recordedAt))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE).map((row) => row.paycheck);
  const grouped = await legsFor(
    db,
    page.map((row) => row.id),
  );
  const body: api.PaychecksResponse = {
    paychecks: page.map((row) => paycheckApi(row, grouped.get(row.id) ?? [])),
    nextCursor: rows.length > PAGE ? (page.at(-1)?.recordedAt.toISOString() ?? null) : null,
  };
  return c.json(body);
});

paycheckRoutes.get("/paychecks/:id", async (c) => {
  const { db } = c.var.services;
  const { userId } = sessionOf(c);
  const id = parseOrThrow(api.Uuid, c.req.param("id"));
  const [row] = await db
    .select({ paycheck: paychecks })
    .from(paychecks)
    .innerJoin(routers, eq(routers.id, paychecks.routerId))
    .where(and(eq(paychecks.id, id), eq(routers.userId, userId)))
    .limit(1);
  if (!row) throw notFound("Paycheck");
  const legRows = (await legsFor(db, [id])).get(id) ?? [];
  const legIds = legRows.map((leg) => leg.id);
  const [attemptRows, verificationRows] =
    legIds.length === 0
      ? [[], []]
      : await Promise.all([
          db.select().from(attempts).where(inArray(attempts.legId, legIds)),
          db.select().from(verifications).where(inArray(verifications.legId, legIds)),
        ]);
  const summary = paycheckApi(row.paycheck, legRows);
  const links: api.ExplorerLink[] = [
    { label: "Paycheck account", url: explorerAddressUrl(c.env, row.paycheck.paycheckPda) },
    { label: "record_paycheck", url: explorerTxUrl(c.env, row.paycheck.recordedSig) },
  ];
  if (row.paycheck.inflowSig) {
    links.unshift({ label: "Inflow", url: explorerTxUrl(c.env, row.paycheck.inflowSig) });
  }
  const body: api.PaycheckDetail = {
    ...summary,
    legs: summary.legs.map((leg) => ({
      ...leg,
      attempts: attemptRows
        .filter((attempt) => attempt.legId === leg.id)
        .sort((a, b) => a.attemptNo - b.attemptNo || a.createdAt.getTime() - b.createdAt.getTime())
        .map((attempt) => ({
          attemptNo: attempt.attemptNo,
          kind: attempt.kind,
          outcome: attempt.outcome,
          programErrorCode: attempt.programErrorCode,
          reason: attempt.reason,
          signature: attempt.signature,
          priorityFeeLamports: str(attempt.priorityFeeLamports),
          cuUsed: attempt.cuUsed,
          createdAt: attempt.createdAt.toISOString(),
        })),
      verification: (() => {
        const found = verificationRows.find((verification) => verification.legId === leg.id);
        return found ? verificationApi(found) : null;
      })(),
      links: leg.executedSig
        ? [
            { label: "execute_leg", url: explorerTxUrl(c.env, leg.executedSig) },
            { label: "Proof", url: `${c.env.APP_ORIGIN}/proof/legs/${leg.executedSig}` },
          ]
        : [],
    })),
    links,
  };
  return c.json(body);
});

async function ownedLeg(db: Db, userId: string, legId: string) {
  const [row] = await db
    .select({ leg: legs, paycheck: paychecks, router: routers })
    .from(legs)
    .innerJoin(paychecks, eq(paychecks.id, legs.paycheckId))
    .innerJoin(routers, eq(routers.id, paychecks.routerId))
    .where(and(eq(legs.id, legId), eq(routers.userId, userId)))
    .limit(1);
  return row ?? null;
}

const BUILDER_TTL_MS = 60_000;

paycheckRoutes.post("/legs/:id/tx/buy-now", async (c) => {
  const services = c.var.services;
  const { userId } = sessionOf(c);
  const legId = parseOrThrow(api.Uuid, c.req.param("id"));
  const body = parseOrThrow(api.BuyNowTxRequest, await readJson(c));
  const row = await ownedLeg(services.db, userId, legId);
  if (!row) throw notFound("Leg");
  if (!["pending", "waiting"].includes(row.leg.status)) {
    throw new ApiError(409, "conflict", `Leg is ${row.leg.status}`);
  }
  const [config] = await services.db
    .select({ bandBps: routerLegs.bandBps })
    .from(routerLegs)
    .where(and(eq(routerLegs.routerId, row.router.id), eq(routerLegs.idx, row.leg.idx)))
    .limit(1);
  const built = await services.engine().buildBuyNow({
    owner: row.router.owner,
    bandBps: body.bandBps,
    job: {
      legId,
      router: refOf(row.router),
      paycheckPda: row.paycheck.paycheckPda,
      seq: row.paycheck.seq,
      idx: row.leg.idx,
      mint: row.leg.assetMint,
      amountIn: row.leg.amountIn,
      bandBps: config?.bandBps ?? body.bandBps,
      attemptNo: row.leg.attemptCount,
    },
  });
  const response: api.TxBuildResponse = {
    tx: built.tx,
    summary: built.summary,
    expiresAt: new Date(services.now().getTime() + BUILDER_TTL_MS).toISOString(),
    feePayer: built.feePayer,
    lastValidBlockHeight: built.lastValidBlockHeight.toString(),
  };
  return c.json(response);
});

paycheckRoutes.post("/legs/:id/tx/cancel", async (c) => {
  const services = c.var.services;
  const { userId } = sessionOf(c);
  const legId = parseOrThrow(api.Uuid, c.req.param("id"));
  const row = await ownedLeg(services.db, userId, legId);
  if (!row) throw notFound("Leg");
  if (!["pending", "waiting"].includes(row.leg.status)) {
    throw new ApiError(409, "conflict", `Leg is ${row.leg.status}`);
  }
  const built = await services.engine().buildCancelLeg({
    owner: row.router.owner,
    paycheckPda: row.paycheck.paycheckPda,
    idx: row.leg.idx,
  });
  const response: api.TxBuildResponse = {
    tx: built.tx,
    summary: built.summary,
    expiresAt: new Date(services.now().getTime() + BUILDER_TTL_MS).toISOString(),
    feePayer: built.feePayer,
    lastValidBlockHeight: built.lastValidBlockHeight.toString(),
  };
  return c.json(response);
});

type ParsedHolding = {
  account: {
    data: {
      parsed: {
        info: {
          mint: string;
          tokenAmount: { amount: string; decimals: number; uiAmountString?: string };
        };
      };
    };
  };
};

/** Parses a decimal string into an integer scaled by 10^scale, flooring extra digits. */
function scaled(decimal: string, scale: number): bigint {
  const [whole = "0", fraction = ""] = decimal.split(".");
  return (
    BigInt(whole) * 10n ** BigInt(scale) +
    BigInt(fraction.padEnd(scale, "0").slice(0, scale) || "0")
  );
}

paycheckRoutes.get("/portfolio", async (c) => {
  const services = c.var.services;
  const { db, chain, now } = services;
  const { userId } = sessionOf(c);
  const owned = await db.select().from(routers).where(eq(routers.userId, userId));
  const routerIds = owned.map((row) => row.id);
  const targets =
    routerIds.length === 0
      ? []
      : await db.select().from(routerLegs).where(inArray(routerLegs.routerId, routerIds));
  const executed =
    routerIds.length === 0
      ? []
      : await db
          .select({ leg: legs })
          .from(legs)
          .innerJoin(paychecks, eq(paychecks.id, legs.paycheckId))
          .where(
            and(
              inArray(paychecks.routerId, routerIds),
              inArray(legs.status, ["executed", "verified", "unverified"]),
            ),
          );

  const balances = new Map<string, { amount: bigint; decimals: number; ui: string }>();
  for (const router of owned) {
    const { value } = await chain.rpc
      .getTokenAccountsByOwner(
        address(router.owner),
        { programId: TOKEN_2022_PROGRAM_ID },
        { encoding: "jsonParsed", commitment: "confirmed" },
      )
      .send();
    for (const entry of value as unknown as ParsedHolding[]) {
      const info = entry.account.data.parsed.info;
      if (!assetByMint(info.mint)) continue;
      const prior = balances.get(info.mint);
      const amount = BigInt(info.tokenAmount.amount) + (prior?.amount ?? 0n);
      const ui = info.tokenAmount.uiAmountString ?? "0";
      balances.set(info.mint, { amount, decimals: info.tokenAmount.decimals, ui });
    }
  }

  const mints = [...new Set([...balances.keys(), ...targets.map((target) => target.assetMint)])];
  const pricing = mints.map((mint) => {
    const asset = assetByMint(mint);
    return {
      mint,
      kind: asset?.kind === 1 ? ("pre_ipo" as const) : ("listed_equity" as const),
      feedId: asset?.feedId ?? null,
      feedId247: asset?.feedId247 ?? null,
    };
  });
  const board = await priceBoard(c.env, pricing, now());

  const cost = new Map<string, bigint>();
  let invested = 0n;
  let fees = 0n;
  for (const { leg } of executed) {
    cost.set(leg.assetMint, (cost.get(leg.assetMint) ?? 0n) + leg.amountIn);
    invested += leg.amountIn;
    fees += leg.fee ?? 0n;
  }
  const targetWeight = new Map(targets.map((target) => [target.assetMint, target.weightBps]));
  const values = new Map<string, bigint | null>();
  for (const mint of mints) {
    const balance = balances.get(mint);
    const reference = board.reference.get(mint);
    values.set(
      mint,
      balance && reference
        ? (scaled(balance.ui, 9) * reference.priceE9) / 10n ** 12n
        : balance
          ? null
          : 0n,
    );
  }
  const priced = [...values.values()];
  const totalValue = priced.every((value) => value !== null)
    ? priced.reduce<bigint>((sum, value) => sum + (value ?? 0n), 0n)
    : null;
  const holdings: api.Holding[] = mints.map((mint) => {
    const value = values.get(mint) ?? null;
    const basis = cost.get(mint) ?? 0n;
    return {
      mint,
      symbol: assetByMint(mint)?.symbol ?? mint.slice(0, 4),
      amountRaw: (balances.get(mint)?.amount ?? 0n).toString(),
      decimals: balances.get(mint)?.decimals ?? assetByMint(mint)?.decimals ?? 0,
      valueUsdc: value?.toString() ?? null,
      costBasisUsdc: basis.toString(),
      pnlUsdc: value === null ? null : (value - basis).toString(),
      targetWeightBps: targetWeight.get(mint) ?? 0,
      actualWeightBps:
        value === null || totalValue === null || totalValue === 0n
          ? null
          : Number((value * 10_000n) / totalValue),
    };
  });
  const totalBasis = [...cost.values()].reduce((sum, value) => sum + value, 0n);
  const body: api.PortfolioResponse = {
    holdings,
    totals: {
      valueUsdc: totalValue?.toString() ?? null,
      costBasisUsdc: totalBasis.toString(),
      pnlUsdc: totalValue === null ? null : (totalValue - totalBasis).toString(),
      investedUsdc: invested.toString(),
      feesUsdc: fees.toString(),
    },
    asOf: board.asOf.toISOString(),
  };
  return c.json(body);
});
