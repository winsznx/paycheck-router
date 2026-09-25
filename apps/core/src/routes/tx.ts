import { api } from "@paycheck-router/shared";
import {
  type Base64EncodedWireTransaction,
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
} from "@solana/kit";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { explorerTxUrl } from "../config.ts";
import { legs, paychecks, routers, submittedTxs, wallets } from "../db/schema.ts";
import { inflowWatcher, routerActorFor } from "../do/stubs.ts";
import type { AppEnv } from "../http/context.ts";
import { readJson } from "../http/json.ts";
import { ApiError, badRequest, forbidden, parseOrThrow } from "../http/problem.ts";
import { rateLimit } from "../http/rate-limit.ts";
import { requireSession, sessionOf } from "../http/session.ts";
import { log } from "../log.ts";
import { registerRouter } from "../services/routers.ts";

export const txRoutes = new Hono<AppEnv>();

txRoutes.use("/tx/*", requireSession, rateLimit("TX_LIMITER", "user"));

const CONFIRM_TIMEOUT_MS = 45_000;

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const context = (error as Error & { context?: unknown }).context;
    return context
      ? `${error.message} ${JSON.stringify(context, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`
      : error.message;
  }
  return String(error);
}

/**
 * Broadcasts a transaction the user signed and follows it to confirmation. Only transactions
 * the signed-in wallet signed are relayed; on a surfnet the surfnet is the only destination.
 */
txRoutes.post("/tx/submit", async (c) => {
  const services = c.var.services;
  const { db, chain, now } = services;
  const session = sessionOf(c);
  const body = parseOrThrow(api.SubmitTxRequest, await readJson(c));

  let decoded: ReturnType<ReturnType<typeof getTransactionDecoder>["decode"]>;
  try {
    decoded = getTransactionDecoder().decode(getBase64Encoder().encode(body.tx));
  } catch {
    throw badRequest("tx is not a serialized transaction");
  }
  const ownerSignature = decoded.signatures[session.wallet as keyof typeof decoded.signatures];
  if (!ownerSignature) throw forbidden("The signed-in wallet has not signed this transaction");
  const signature = getSignatureFromTransaction(decoded);

  await db
    .insert(submittedTxs)
    .values({
      signature,
      userId: session.userId,
      kind: body.kind,
      context: { wallet: session.wallet, ...(body.legId ? { legId: body.legId } : {}) },
      status: "submitted",
    })
    .onConflictDoNothing();

  const links = [{ label: "Explorer", url: explorerTxUrl(c.env, signature) }];
  try {
    await chain.send(body.tx as Base64EncodedWireTransaction, { skipPreflight: false });
  } catch (error) {
    const message = describeError(error);
    await db
      .update(submittedTxs)
      .set({ status: "failed", error: message })
      .where(eq(submittedTxs.signature, signature));
    const response: api.SubmitTxResponse = { signature, status: "failed", error: message, links };
    return c.json(response, 422);
  }

  const outcome = await chain.waitForSignature(signature, {
    commitment: "confirmed",
    timeoutMs: CONFIRM_TIMEOUT_MS,
  });
  if (outcome.status === "timeout") {
    const response: api.SubmitTxResponse = { signature, status: "submitted", error: null, links };
    return c.json(response, 202);
  }
  if (outcome.status === "failed") {
    const message = JSON.stringify(outcome.err, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    await db
      .update(submittedTxs)
      .set({ status: "failed", error: message, slot: outcome.slot })
      .where(eq(submittedTxs.signature, signature));
    const response: api.SubmitTxResponse = { signature, status: "failed", error: message, links };
    return c.json(response, 422);
  }
  await db
    .update(submittedTxs)
    .set({ status: outcome.status, slot: outcome.slot, confirmedAt: now() })
    .where(eq(submittedTxs.signature, signature));

  try {
    await afterConfirmed(c.env, services, session, body, signature);
  } catch (error) {
    log.error("post-confirmation update failed", { signature, kind: body.kind, error });
    throw new ApiError(
      502,
      "chain_error",
      `Transaction ${signature} confirmed, but the follow-up update failed: ${describeError(error)}`,
    );
  }
  const response: api.SubmitTxResponse = { signature, status: outcome.status, error: null, links };
  return c.json(response);
});

async function afterConfirmed(
  env: AppEnv["Bindings"],
  services: AppEnv["Variables"]["services"],
  session: { userId: string; wallet: string },
  body: api.SubmitTxRequest,
  signature: string,
): Promise<void> {
  switch (body.kind) {
    case "router.create": {
      const [wallet] = await services.db
        .select({ id: wallets.id })
        .from(wallets)
        .where(and(eq(wallets.userId, session.userId), eq(wallets.address, session.wallet)))
        .limit(1);
      if (!wallet) throw new Error("signed-in wallet is not linked");
      await registerRouter(env, services, {
        userId: session.userId,
        walletId: wallet.id,
        owner: session.wallet,
        createdSig: signature,
      });
      return;
    }
    case "router.update":
    case "router.pause": {
      const [wallet] = await services.db
        .select({ id: wallets.id })
        .from(wallets)
        .where(and(eq(wallets.userId, session.userId), eq(wallets.address, session.wallet)))
        .limit(1);
      if (!wallet) throw new Error("signed-in wallet is not linked");
      await registerRouter(env, services, {
        userId: session.userId,
        walletId: wallet.id,
        owner: session.wallet,
        createdSig: null,
      });
      return;
    }
    case "router.close": {
      const [closed] = await services.db
        .update(routers)
        .set({ status: "closed", closedAt: services.now(), updatedAt: services.now() })
        .where(and(eq(routers.owner, session.wallet), eq(routers.userId, session.userId)))
        .returning({ routerPda: routers.routerPda });
      if (closed) await inflowWatcher(env).unwatch(closed.routerPda);
      return;
    }
    case "leg.cancel": {
      if (!body.legId) return;
      const [row] = await services.db
        .select({ routerId: routers.id })
        .from(legs)
        .innerJoin(paychecks, eq(paychecks.id, legs.paycheckId))
        .innerJoin(routers, eq(routers.id, paychecks.routerId))
        .where(and(eq(legs.id, body.legId), eq(routers.userId, session.userId)))
        .limit(1);
      if (row) await routerActorFor(env, row.routerId).legCancelled(body.legId);
      return;
    }
    default:
      return;
  }
}
