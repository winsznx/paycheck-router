import * as sdk from "@paycheck-router/sdk";
import { api, TOKEN_PROGRAM_ID, USDC_DECIMALS } from "@paycheck-router/shared";
import {
  type Address,
  address,
  type Base64EncodedWireTransaction,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getTransferCheckedInstruction } from "@solana-program/token";
import { and, asc, eq, gt, ne } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { usdcAtaFor } from "../chain/accounts.ts";
import type { ChainClient } from "../chain/client.ts";
import { hotSigner } from "../chain/keys.ts";
import { binding } from "../config.ts";
import { demoFundings, demoPaychecks, routers } from "../db/schema.ts";
import { demoStatus, resetIntervalMs } from "../demo/fork-state.ts";
import {
  type ForkEpoch,
  forkUnavailable,
  setLamports,
  setTokenBalance,
  surfnetRpc,
} from "../demo/surfnet.ts";
import { inflowWatcher } from "../do/stubs.ts";
import type { Env } from "../env.ts";
import type { AppContext, AppEnv } from "../http/context.ts";
import { readJson } from "../http/json.ts";
import { ApiError, conflict, notConfigured, notFound, parseOrThrow } from "../http/problem.ts";
import { rateLimit } from "../http/rate-limit.ts";
import { requireSession, sessionOf } from "../http/session.ts";
import { log } from "../log.ts";
import { syncUserRouters } from "../services/routers.ts";

/** One faucet grant per wallet per fork. */
export const DEMO_GRANT_LAMPORTS = 50_000_000n;
export const DEMO_GRANT_USDC = 5_000_000_000n;
/** Demo paychecks per wallet inside `PAYCHECK_WINDOW_MS`. */
export const PAYCHECKS_PER_WINDOW = 3;
export const PAYCHECK_WINDOW_MS = 10 * 60_000;
/** Employer-1 is topped up by cheatcode when it runs low; it pays nobody on mainnet. */
const EMPLOYER_MIN_LAMPORTS = 10_000_000n;
const EMPLOYER_LAMPORTS = 1_000_000_000n;
const EMPLOYER_FLOAT_USDC = 100_000_000_000n;
const CONFIRM_TIMEOUT_MS = 30_000;

export const demoRoutes = new Hono<AppEnv>();

/** These routes move balances by cheatcode, so they exist only where core runs on a fork. */
const forkOnly = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.env.SURFNET_RPC_URL) throw notFound(`${c.req.method} ${c.req.path}`);
  await next();
});

demoRoutes.use("/demo/*", forkOnly);
demoRoutes.use("/demo/status", rateLimit("PUBLIC_LIMITER", "ip"));
demoRoutes.use("/demo/fund", requireSession, rateLimit("TX_LIMITER", "user"));
demoRoutes.use("/demo/paycheck", requireSession, rateLimit("TX_LIMITER", "user"));
demoRoutes.use("/demo/simulate", requireSession, rateLimit("TX_LIMITER", "user"));

/** The fork's current epoch, or 503 while it is resetting or unreachable. */
async function currentEpoch(env: Env): Promise<ForkEpoch> {
  const view = await inflowWatcher(env).forkView();
  if (!view.reachable || !view.epoch) {
    throw forkUnavailable("The demo fork is resetting or unreachable; try again in a few minutes");
  }
  return view.epoch;
}

/** Transport failures reach the caller as `upstream_unavailable`; problems pass through. */
async function onFork<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw forkUnavailable(`${what}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

type Balances = { lamports: bigint; usdc: bigint };

async function balancesOf(env: Env, chain: ChainClient, owner: Address): Promise<Balances> {
  const ata = await usdcAtaFor(env, owner);
  const { value } = await chain.rpc
    .getMultipleAccounts([owner, ata], { encoding: "jsonParsed", commitment: "confirmed" })
    .send();
  const [wallet, token] = value;
  const parsed = (token?.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } })
    ?.parsed;
  return {
    lamports: wallet?.lamports ?? 0n,
    usdc: BigInt(parsed?.info?.tokenAmount?.amount ?? "0"),
  };
}

demoRoutes.get("/demo/status", async (c) => {
  const view = await inflowWatcher(c.env).forkView();
  return c.json(
    demoStatus(
      view,
      resetIntervalMs(c.env),
      c.var.services.now().getTime(),
    ) satisfies api.DemoStatus,
  );
});

demoRoutes.post("/demo/fund", async (c) => {
  const session = sessionOf(c);
  const { db, chain } = c.var.services;
  const epoch = await currentEpoch(c.env);
  const [funded] = await db
    .select({ at: demoFundings.fundedAt })
    .from(demoFundings)
    .where(and(eq(demoFundings.wallet, session.wallet), eq(demoFundings.epoch, epoch.id)));
  if (funded) throw conflict("This wallet already has its demo funds on this fork");

  const wallet = address(session.wallet);
  const before = await onFork("Reading balances", () => balancesOf(c.env, chain, wallet));
  const lamports = before.lamports > DEMO_GRANT_LAMPORTS ? before.lamports : DEMO_GRANT_LAMPORTS;
  const usdc = before.usdc > DEMO_GRANT_USDC ? before.usdc : DEMO_GRANT_USDC;
  if (lamports !== before.lamports) await setLamports(c.env, wallet, lamports);
  if (usdc !== before.usdc) {
    await setTokenBalance(c.env, wallet, c.env.USDC_MINT, usdc, TOKEN_PROGRAM_ID);
  }
  await db
    .insert(demoFundings)
    .values({ wallet: session.wallet, epoch: epoch.id })
    .onConflictDoNothing();
  log.info("demo wallet funded", { userId: session.userId, epoch: epoch.id });
  // Cheatcodes set balances directly; no transaction is sent for the grant.
  const body: api.DemoFundResponse = {
    wallet: session.wallet,
    lamports: lamports.toString(),
    usdc: usdc.toString(),
    signatures: [],
  };
  return c.json(body);
});

/** The wallet's live router, adopting one Supabase has not seen yet (created from another tab). */
async function routerFor(c: AppContext, wallet: string) {
  const { db } = c.var.services;
  const find = () =>
    db
      .select()
      .from(routers)
      .where(and(eq(routers.owner, wallet), ne(routers.status, "closed")));
  const [known] = await find();
  if (known) return known;
  await onFork("Looking up the router", () =>
    syncUserRouters(c.env, c.var.services, sessionOf(c).userId),
  );
  const [adopted] = await find();
  return adopted ?? null;
}

async function limitPaychecks(c: AppContext, wallet: string): Promise<void> {
  const { success } = await binding(c.env.DEMO_LIMITER, "DEMO_LIMITER").limit({ key: "global" });
  if (!success) {
    c.header("retry-after", "60");
    throw new ApiError(429, "rate_limited", "The demo employer is busy; try again in a minute");
  }
  const now = c.var.services.now().getTime();
  const recent = await c.var.services.db
    .select({ createdAt: demoPaychecks.createdAt })
    .from(demoPaychecks)
    .where(
      and(
        eq(demoPaychecks.wallet, wallet),
        gt(demoPaychecks.createdAt, new Date(now - PAYCHECK_WINDOW_MS)),
      ),
    )
    .orderBy(asc(demoPaychecks.createdAt));
  const oldest = recent[0];
  if (recent.length >= PAYCHECKS_PER_WINDOW && oldest) {
    const retryAfter = Math.max(
      1,
      Math.ceil((oldest.createdAt.getTime() + PAYCHECK_WINDOW_MS - now) / 1000),
    );
    c.header("retry-after", String(retryAfter));
    throw new ApiError(
      429,
      "rate_limited",
      `At most ${PAYCHECKS_PER_WINDOW} demo paychecks per wallet every 10 minutes`,
    );
  }
}

demoRoutes.post("/demo/paycheck", async (c) => {
  const session = sessionOf(c);
  const { amountUsdc } = parseOrThrow(api.DemoPaycheckRequest, await readJson(c));
  const amount = BigInt(amountUsdc);
  if (!c.env.EMPLOYER_KEY) throw notConfigured("EMPLOYER_KEY");
  const { db, chain } = c.var.services;
  const epoch = await currentEpoch(c.env);
  const router = await routerFor(c, session.wallet);
  if (!router) throw conflict("Create your router before sending it a paycheck");
  await limitPaychecks(c, session.wallet);

  const employer = await hotSigner(c.env, "EMPLOYER_KEY");
  const mint = address(c.env.USDC_MINT);
  const source = await usdcAtaFor(c.env, employer.address);
  const funds = await onFork("Reading the employer", () =>
    balancesOf(c.env, chain, employer.address),
  );
  if (funds.lamports < EMPLOYER_MIN_LAMPORTS) {
    await setLamports(c.env, employer.address, EMPLOYER_LAMPORTS);
  }
  if (funds.usdc < amount) {
    await setTokenBalance(
      c.env,
      employer.address,
      mint,
      amount + EMPLOYER_FLOAT_USDC,
      TOKEN_PROGRAM_ID,
    );
  }

  const lifetime = await onFork("Fetching a blockhash", () => sdk.latestLifetime(chain.rpc));
  const signed = await signTransactionMessageWithSigners(
    sdk.buildMessage(employer, lifetime, [
      getTransferCheckedInstruction({
        source,
        mint,
        destination: address(router.payInAta),
        authority: employer,
        amount,
        decimals: USDC_DECIMALS,
      }),
    ]),
  );
  const signature = getSignatureFromTransaction(signed);
  // Reserve the slot in the per-wallet limit before sending, so parallel requests cannot pass it.
  const reserved = await db
    .insert(demoPaychecks)
    .values({ wallet: session.wallet, epoch: epoch.id, amount, signature })
    .onConflictDoNothing({ target: demoPaychecks.signature })
    .returning({ id: demoPaychecks.id });
  // Same amount inside one blockhash window: the identical transaction is already on its way.
  if (reserved.length === 0) throw conflict(`This paycheck is already being sent as ${signature}`);
  const release = () => db.delete(demoPaychecks).where(eq(demoPaychecks.signature, signature));

  let outcome: Awaited<ReturnType<ChainClient["waitForSignature"]>>;
  try {
    outcome = await onFork("Sending the paycheck", async () => {
      await chain.send(getBase64EncodedWireTransaction(signed), { skipPreflight: true });
      return chain.waitForSignature(signature, {
        commitment: "confirmed",
        timeoutMs: CONFIRM_TIMEOUT_MS,
      });
    });
  } catch (error) {
    await release();
    throw error;
  }
  if (outcome.status === "timeout") {
    // It may still land, so its slot in the limit stays taken.
    throw forkUnavailable(`The paycheck ${signature} did not confirm in time`);
  }
  if (outcome.status === "failed") {
    await release();
    throw new ApiError(
      502,
      "chain_error",
      `The paycheck failed: ${JSON.stringify(outcome.err, sdk.bigintReplacer)}`,
    );
  }
  log.info("demo paycheck sent", { routerId: router.id, signature, amount });
  const body: api.DemoPaycheckResponse = {
    signature,
    amountUsdc: amount.toString(),
    slot: outcome.slot.toString(),
  };
  return c.json(body);
});

type Simulation = {
  value: { err: unknown; logs: string[] | null; unitsConsumed?: number | null };
};

demoRoutes.post("/demo/simulate", async (c) => {
  const { transaction } = parseOrThrow(api.DemoSimulateRequest, await readJson(c));
  let simulation: Simulation;
  try {
    simulation = await surfnetRpc<Simulation>(c.env, "simulateTransaction", [
      transaction as Base64EncodedWireTransaction,
      {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
      },
    ]);
  } catch (error) {
    // The fork refusing the transaction itself (it does not decode, say) is a simulation result.
    if (error instanceof ApiError && error.code === "chain_error") {
      const body: api.DemoSimulateResponse = {
        ok: false,
        unitsConsumed: null,
        logs: [],
        error: error.message,
      };
      return c.json(body);
    }
    throw error;
  }
  const { err, logs, unitsConsumed } = simulation.value;
  const body: api.DemoSimulateResponse = {
    ok: err === null || err === undefined,
    unitsConsumed: unitsConsumed ?? null,
    logs: logs ?? [],
    error: err === null || err === undefined ? null : JSON.stringify(err),
  };
  return c.json(body);
});
