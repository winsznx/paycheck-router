import { api } from "@paycheck-router/shared";
import { generateKeyPairSigner } from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { createChainClient } from "../../../src/chain/client.ts";
import { chainEndpoints } from "../../../src/config.ts";
import type { Db } from "../../../src/db/client.ts";
import { adminUsers, auditLog, priceSnapshots } from "../../../src/db/schema.ts";
import { CRANK_PAUSED_KEY } from "../../../src/flags.ts";
import { createTestDb, testApp, testEnv } from "../helpers/app.ts";
import { bearer, sessionFor } from "../helpers/session.ts";

const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const SPY_FEED = "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5";

describe("admin and asset detail routes", () => {
  const env = testEnv();
  let app: ReturnType<typeof testApp>;
  let db: Db;

  beforeAll(async () => {
    ({ db } = await createTestDb());
    app = testApp(db, createChainClient(chainEndpoints(env)));
  });

  it("keeps admin routes to admin users and audits a crank pause", async () => {
    const plain = await sessionFor(app, env, await generateKeyPairSigner());
    expect((await app.request("/admin/overview", { headers: bearer(plain) }, env)).status).toBe(
      403,
    );

    const admin = await sessionFor(app, env, await generateKeyPairSigner());
    await db.insert(adminUsers).values({ userId: admin.user.id, role: "admin" });
    const overview = await app.request("/admin/overview", { headers: bearer(admin) }, env);
    expect(overview.status).toBe(200);
    expect(await overview.json()).toMatchObject({ crankPaused: false });

    const pause = await app.request(
      "/admin/crank/pause",
      {
        method: "POST",
        headers: { ...bearer(admin), "content-type": "application/json" },
        body: JSON.stringify({ paused: true, reason: "drill" }),
      },
      env,
    );
    expect(pause.status).toBe(200);
    expect(await env.REGISTRY.get(CRANK_PAUSED_KEY)).toBe("1");
    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({ action: "crank.pause", actorId: admin.user.id });
  });

  it("lets a viewer read but not pause", async () => {
    const viewer = await sessionFor(app, env, await generateKeyPairSigner());
    await db.insert(adminUsers).values({ userId: viewer.user.id, role: "viewer" });
    expect((await app.request("/admin/audit", { headers: bearer(viewer) }, env)).status).toBe(200);
    const pause = await app.request(
      "/admin/crank/pause",
      {
        method: "POST",
        headers: { ...bearer(viewer), "content-type": "application/json" },
        body: JSON.stringify({ paused: false, reason: "no" }),
      },
      env,
    );
    expect(pause.status).toBe(403);
  });

  it("returns an asset with its daily closes from stored snapshots", async () => {
    const day = (iso: string, price: bigint) => ({
      feedId: SPY_FEED,
      price,
      conf: 10n,
      expo: -5,
      publishTime: new Date(iso),
    });
    const now = Date.now();
    const yesterday = new Date(now - 86_400_000).toISOString().slice(0, 10);
    await db
      .insert(priceSnapshots)
      .values([
        day(`${yesterday}T14:00:00Z`, 62_800_000n),
        day(`${yesterday}T19:59:00Z`, 63_000_000n),
      ]);
    const res = await app.request(`/assets/${SPYX}`, {}, env);
    expect(res.status).toBe(200);
    const detail = api.AssetDetail.parse(await res.json());
    expect(detail.symbol).toBe("SPYx");
    expect(detail.series).toEqual([
      { day: yesterday, closeE9: "630000000000", publishTime: `${yesterday}T19:59:00.000Z` },
    ]);
    expect((await app.request("/assets/11111111111111111111111111111111", {}, env)).status).toBe(
      404,
    );
  });
});
