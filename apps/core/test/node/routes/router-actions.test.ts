import { api } from "@paycheck-router/shared";
import { generateKeyPairSigner } from "@solana/kit";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createChainClient } from "../../../src/chain/client.ts";
import { chainEndpoints } from "../../../src/config.ts";
import type { Db } from "../../../src/db/client.ts";
import { routers } from "../../../src/db/schema.ts";
import type { Engine, RouterAction } from "../../../src/engine/types.ts";
import { createTestDb, testApp, testEnv } from "../helpers/app.ts";
import { bearer, sessionFor } from "../helpers/session.ts";

const addr = (seed: string) => seed.padEnd(44, "1");

describe("router action builders", () => {
  const env = testEnv();
  const seen: RouterAction[] = [];
  /** Engine double: records the action and answers with a fixed sponsor-signed transaction. */
  const engine = {
    buildRouterAction: async (action: RouterAction) => {
      seen.push(action);
      return {
        tx: "AQID",
        feePayer: "CuZDTZrPcGrRcjjFEF4UmcxgGq75Jm8eFFaxAWnSBBGA",
        lastValidBlockHeight: 1000n,
        summary: [action.kind],
      };
    },
  } as unknown as Engine;
  let app: ReturnType<typeof testApp>;
  let db: Db;

  beforeAll(async () => {
    ({ db } = await createTestDb());
    app = testApp(db, createChainClient(chainEndpoints(env)), engine);
  });

  async function setup() {
    const owner = await generateKeyPairSigner();
    const session = await sessionFor(app, env, owner);
    const [router] = await db
      .insert(routers)
      .values({
        userId: session.user.id,
        owner: owner.address,
        routerPda: addr(`R${owner.address.slice(0, 6)}`),
        authorityPda: addr("Auth"),
        payInAta: addr("Pay"),
        investBps: 2000,
        minInflow: 20_000_000n,
        dailyCap: 5_000_000_000n,
        maxWaitSecs: 259_200,
        autoConvert: true,
        recorder: "EGaHpAB9Svfv6zW8ZcNrSEayvMPNsg1gJqQUPDYfNKqL",
      })
      .returning();
    if (!router) throw new Error("router insert failed");
    return { owner, session, router };
  }

  const post = (path: string, session: api.SessionResponse, body?: unknown) =>
    app.request(
      path,
      {
        method: "POST",
        headers: { ...bearer(session), "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
    );

  it("builds pause, allowance, revoke and close for the owner", async () => {
    const { owner, session, router } = await setup();
    const pause = await post(`/routers/${router.id}/tx/pause`, session, { paused: true });
    expect(pause.status).toBe(200);
    expect(api.TxBuildResponse.parse(await pause.json()).summary).toEqual(["pause"]);
    expect(
      (await post(`/routers/${router.id}/tx/allowance`, session, { amount: "1500000000" })).status,
    ).toBe(200);
    expect((await post(`/routers/${router.id}/tx/revoke`, session)).status).toBe(200);
    expect((await post(`/routers/${router.id}/tx/close`, session)).status).toBe(200);
    expect(seen.filter((action) => action.owner === owner.address)).toEqual([
      { kind: "pause", owner: owner.address, paused: true },
      { kind: "allowance", owner: owner.address, amount: 1_500_000_000n },
      { kind: "revoke", owner: owner.address },
      { kind: "close", owner: owner.address },
    ]);
  });

  it("validates an update like create", async () => {
    const { session, router } = await setup();
    const res = await post(`/routers/${router.id}/tx/update`, session, {
      investBps: 2000,
      legs: [{ mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", weightBps: 9000, bandBps: 50 }],
      minInflow: "20000000",
      dailyCap: "5000000000",
      maxWaitSecs: 259200,
      autoConvert: true,
    });
    expect(res.status).toBe(400);
  });

  it("refuses strangers and closed routers", async () => {
    const { router } = await setup();
    const stranger = await sessionFor(app, env, await generateKeyPairSigner());
    expect((await post(`/routers/${router.id}/tx/revoke`, stranger)).status).toBe(404);

    const { session, router: closed } = await setup();
    await db.update(routers).set({ status: "closed" }).where(eq(routers.id, closed.id));
    expect((await post(`/routers/${closed.id}/tx/pause`, session, { paused: false })).status).toBe(
      409,
    );
  });
});
