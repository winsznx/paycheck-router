import { api } from "@paycheck-router/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { payInFor } from "../chain/accounts.ts";
import { eligibilityFor } from "../compliance/eligibility.ts";
import { checkSanctions } from "../compliance/sanctions.ts";
import { routers, users, wallets } from "../db/schema.ts";
import type { AppEnv } from "../http/context.ts";
import { readJson } from "../http/json.ts";
import { notFound, parseOrThrow } from "../http/problem.ts";
import { rateLimit } from "../http/rate-limit.ts";
import { requireSession, sessionOf } from "../http/session.ts";
import { countryOf } from "./auth.ts";

export const meRoutes = new Hono<AppEnv>();

meRoutes.use("/me", requireSession, rateLimit("USER_LIMITER", "user"));
meRoutes.use("/eligibility/*", requireSession, rateLimit("USER_LIMITER", "user"));
meRoutes.use("/wallets", requireSession, rateLimit("USER_LIMITER", "user"));

async function loadMe(db: AppEnv["Variables"]["services"]["db"], userId: string): Promise<api.Me> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.deletedAt) throw notFound("User");
  const linked = await db
    .select({ address: wallets.address, kind: wallets.kind })
    .from(wallets)
    .where(eq(wallets.userId, userId));
  return {
    id: user.id,
    email: user.email,
    locale: user.locale,
    refCurrency: user.refCurrency,
    countryDeclared: user.countryDeclared,
    countryIp: user.countryIpLast,
    eligibilityStatus: user.eligibilityStatus,
    tosVersion: user.tosVersion,
    riskAckVersion: user.riskAckVersion,
    ackedAt: user.ackedAt?.toISOString() ?? null,
    wallets: linked.map((wallet) => ({
      address: wallet.address,
      kind: api.WalletKind.parse(wallet.kind),
    })),
    createdAt: user.createdAt.toISOString(),
  };
}

meRoutes.get("/me", async (c) => {
  return c.json(await loadMe(c.var.services.db, sessionOf(c).userId));
});

meRoutes.patch("/me", async (c) => {
  const { db, now } = c.var.services;
  const { userId } = sessionOf(c);
  const patch = parseOrThrow(api.PatchMeRequest, await readJson(c));
  await db
    .update(users)
    .set({ ...patch, updatedAt: now() })
    .where(eq(users.id, userId));
  return c.json(await loadMe(db, userId));
});

meRoutes.post("/eligibility/attest", async (c) => {
  const { db, now } = c.var.services;
  const { userId } = sessionOf(c);
  const body = parseOrThrow(api.EligibilityAttestRequest, await readJson(c));
  const countryIp = countryOf(c);
  const linked = await db
    .select({ id: wallets.id, address: wallets.address })
    .from(wallets)
    .where(eq(wallets.userId, userId));
  const screened = await Promise.all(
    linked.map(async (wallet) => ({
      ...wallet,
      status: await checkSanctions(c.env.CHAINALYSIS_API_KEY, wallet.address),
    })),
  );
  for (const wallet of screened) {
    await db
      .update(wallets)
      .set({ sanctionsStatus: wallet.status, sanctionsCheckedAt: now() })
      .where(eq(wallets.id, wallet.id));
  }
  const status = eligibilityFor({
    countryDeclared: body.countryDeclared,
    countryIp,
    usPerson: body.usPerson,
    sanctions: screened.map((wallet) => wallet.status),
  });
  await db
    .update(users)
    .set({
      countryDeclared: body.countryDeclared,
      countryIpLast: countryIp,
      usPerson: body.usPerson,
      tosVersion: body.tosVersion,
      riskAckVersion: body.riskAckVersion,
      ackedAt: now(),
      eligibilityStatus: status,
      updatedAt: now(),
    })
    .where(eq(users.id, userId));
  const response: api.EligibilityResponse = {
    status,
    countryDeclared: body.countryDeclared,
    countryIp,
    countryMismatch: countryIp !== null && countryIp !== body.countryDeclared,
    sanctions: screened.map((wallet) => ({ address: wallet.address, status: wallet.status })),
  };
  return c.json(response);
});

meRoutes.get("/wallets", async (c) => {
  const { db, chain } = c.var.services;
  const { userId } = sessionOf(c);
  const rows = await db
    .select({ wallet: wallets, routerPda: routers.routerPda })
    .from(wallets)
    .leftJoin(routers, eq(routers.walletId, wallets.id))
    .where(eq(wallets.userId, userId));
  const body: api.WalletsResponse = {
    wallets: await Promise.all(
      rows.map(async ({ wallet, routerPda }) => {
        const payIn = await payInFor(c.env, chain, wallet.address);
        return {
          id: wallet.id,
          address: wallet.address,
          kind: api.WalletKind.parse(wallet.kind),
          verifiedAt: wallet.verifiedAt?.toISOString() ?? null,
          sanctionsStatus: wallet.sanctionsStatus,
          payInAta: payIn.ata,
          payInAtaExists: payIn.exists,
          usdcBalance: payIn.balance.toString(),
          routerPda: payIn.routerPda,
          hasRouter: routerPda !== null || payIn.routerExists,
        };
      }),
    ),
  };
  return c.json(body);
});
