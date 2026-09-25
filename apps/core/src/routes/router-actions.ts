import { api } from "@paycheck-router/shared";
import { Hono } from "hono";
import type { RouterAction } from "../engine/types.ts";
import type { AppContext, AppEnv } from "../http/context.ts";
import { readJson } from "../http/json.ts";
import { ApiError, notFound, parseOrThrow } from "../http/problem.ts";
import { rateLimit } from "../http/rate-limit.ts";
import { requireSession, sessionOf } from "../http/session.ts";
import { ownedRouter } from "../services/routers.ts";

export const routerActionRoutes = new Hono<AppEnv>();

routerActionRoutes.use("/routers/:id/tx/*", requireSession, rateLimit("TX_LIMITER", "user"));

const BUILDER_TTL_MS = 60_000;

async function build(c: AppContext, action: (owner: string) => RouterAction): Promise<Response> {
  const services = c.var.services;
  const { userId } = sessionOf(c);
  const router = await ownedRouter(services.db, userId, parseOrThrow(api.Uuid, c.req.param("id")));
  if (!router) throw notFound("Router");
  if (router.status === "closed") throw new ApiError(409, "conflict", "This router is closed");
  const built = await services.engine().buildRouterAction(action(router.owner));
  const response: api.TxBuildResponse = {
    tx: built.tx,
    summary: built.summary,
    expiresAt: new Date(services.now().getTime() + BUILDER_TTL_MS).toISOString(),
    feePayer: built.feePayer,
    lastValidBlockHeight: built.lastValidBlockHeight.toString(),
  };
  return c.json(response);
}

routerActionRoutes.post("/routers/:id/tx/update", async (c) => {
  const body = parseOrThrow(api.UpdateRouterTxRequest, await readJson(c));
  return build(c, (owner) => ({
    kind: "update",
    owner,
    investBps: body.investBps,
    legs: body.legs,
    minInflow: BigInt(body.minInflow),
    dailyCap: BigInt(body.dailyCap),
    maxWaitSecs: body.maxWaitSecs,
    autoConvert: body.autoConvert,
  }));
});

routerActionRoutes.post("/routers/:id/tx/pause", async (c) => {
  const body = parseOrThrow(api.PauseRouterTxRequest, await readJson(c));
  return build(c, (owner) => ({ kind: "pause", owner, paused: body.paused }));
});

routerActionRoutes.post("/routers/:id/tx/allowance", async (c) => {
  const body = parseOrThrow(api.AllowanceTxRequest, await readJson(c));
  return build(c, (owner) => ({ kind: "allowance", owner, amount: BigInt(body.amount) }));
});

routerActionRoutes.post("/routers/:id/tx/revoke", (c) =>
  build(c, (owner) => ({ kind: "revoke", owner })),
);

routerActionRoutes.post("/routers/:id/tx/close", (c) =>
  build(c, (owner) => ({ kind: "close", owner })),
);
