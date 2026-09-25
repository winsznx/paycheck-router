import { api } from "@paycheck-router/shared";
import { generateKeyPairSigner } from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { createChainClient } from "../../../src/chain/client.ts";
import { chainEndpoints } from "../../../src/config.ts";
import type { Db } from "../../../src/db/client.ts";
import { inflows, routers } from "../../../src/db/schema.ts";
import { createTestDb, testApp, testEnv } from "../helpers/app.ts";
import { bearer, sessionFor } from "../helpers/session.ts";

const EMPLOYER = "75uzrnEcXXKf7fi53BxTBh5kTJCY7o6WD2qLvjMMShZd";
const addr = (seed: string) => seed.padEnd(44, "1");
const sig = (seed: string) => seed.padEnd(88, "1");

describe("router settings routes", () => {
  const env = testEnv();
  let app: ReturnType<typeof testApp>;
  let db: Db;

  beforeAll(async () => {
    ({ db } = await createTestDb());
    app = testApp(db, createChainClient(chainEndpoints(env)));
  });

  async function routerFor(userId: string, owner: string) {
    const [router] = await db
      .insert(routers)
      .values({
        userId,
        owner,
        routerPda: addr(`R${owner.slice(0, 5)}`),
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
    return router;
  }

  it("groups recent inflows by sender", async () => {
    const owner = await generateKeyPairSigner();
    const session = await sessionFor(app, env, owner);
    const router = await routerFor(session.user.id, owner.address);
    await db.insert(inflows).values([
      {
        routerId: router.id,
        signature: sig("A"),
        slot: 1n,
        amount: 1_850_000_000n,
        senderOwner: EMPLOYER,
        source: "reconcile",
      },
      {
        routerId: router.id,
        signature: sig("B"),
        slot: 2n,
        amount: 1_850_000_000n,
        senderOwner: EMPLOYER,
        source: "reconcile",
      },
    ]);
    const res = await app.request(
      `/routers/${router.id}/inflows`,
      { headers: bearer(session) },
      env,
    );
    expect(res.status).toBe(200);
    const body = api.RouterInflowsResponse.parse(await res.json());
    expect(body.senders).toEqual([
      expect.objectContaining({ sender: EMPLOYER, count: 2, total: "3700000000", tagged: false }),
    ]);
  });

  it("hides another user's router", async () => {
    const owner = await generateKeyPairSigner();
    const session = await sessionFor(app, env, owner);
    const router = await routerFor(session.user.id, owner.address);
    const stranger = await sessionFor(app, env, await generateKeyPairSigner());
    const res = await app.request(
      `/routers/${router.id}/inflows`,
      { headers: bearer(stranger) },
      env,
    );
    expect(res.status).toBe(404);
  });
});
