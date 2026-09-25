import { api } from "@paycheck-router/shared";
import { generateKeyPairSigner } from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { createChainClient } from "../../../src/chain/client.ts";
import { chainEndpoints } from "../../../src/config.ts";
import type { Db } from "../../../src/db/client.ts";
import { legs, paychecks, routers } from "../../../src/db/schema.ts";
import { createTestDb, testApp, testEnv } from "../helpers/app.ts";
import { bearer, sessionFor } from "../helpers/session.ts";

/** R2 test double backed by a Map. */
function memoryBucket(): R2Bucket {
  const objects = new Map<string, string>();
  return {
    put: async (key: string, value: string) => {
      objects.set(key, value);
      return null;
    },
    get: async (key: string) => {
      const value = objects.get(key);
      return value === undefined ? null : { body: new Response(value).body };
    },
  } as unknown as R2Bucket;
}

const addr = (seed: string) => seed.padEnd(44, "1");
const sig = (seed: string) => seed.padEnd(88, "1");

describe("CSV exports", () => {
  const env = testEnv({ EXPORTS: memoryBucket() });
  let app: ReturnType<typeof testApp>;
  let db: Db;

  beforeAll(async () => {
    ({ db } = await createTestDb());
    app = testApp(db, createChainClient(chainEndpoints(env)));
  });

  it("exports the user's slices behind a link only its token opens", async () => {
    const owner = await generateKeyPairSigner();
    const session = await sessionFor(app, env, owner);
    const [router] = await db
      .insert(routers)
      .values({
        userId: session.user.id,
        owner: owner.address,
        routerPda: addr("Rexp"),
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
    const [paycheck] = await db
      .insert(paychecks)
      .values({
        routerId: router.id,
        seq: 0n,
        paycheckPda: addr("Pexp"),
        inflow: 1_850_000_000n,
        investTotal: 370_000_000n,
        recordedSig: sig("Recexp"),
        recordedAt: new Date("2026-09-25T13:30:00Z"),
        expiresAt: new Date("2026-09-28T13:30:00Z"),
      })
      .returning();
    if (!paycheck) throw new Error("paycheck insert failed");
    await db.insert(legs).values({
      paycheckId: paycheck.id,
      idx: 0,
      assetMint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF",
      amountIn: 92_500_000n,
      status: "verified",
      outAmount: 86_315_830n,
      fee: 185_000n,
      uiMultiplier: "1.4861347",
      premiumBps: 40,
    });

    const res = await app.request("/exports", { method: "POST", headers: bearer(session) }, env);
    expect(res.status).toBe(201);
    const link = api.ExportResponse.parse(await res.json());
    expect(link.rows).toBe(1);

    const download = await app.request(link.url, {}, env);
    expect(download.status).toBe(200);
    const [header, row] = (await download.text()).trim().split("\n");
    expect(header?.split(",")).toContain("shares");
    expect(row).toContain(
      "OpenAI,PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF,verified,,92.5,0.185",
    );
    expect(row).toContain(",0.128276950122301,86315830,");

    const forged = await app.request("/exports/download?token=abc", {}, env);
    expect(forged.status).toBe(401);
  });
});
