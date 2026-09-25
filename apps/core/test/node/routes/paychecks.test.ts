import { api } from "@paycheck-router/shared";
import { generateKeyPairSigner } from "@solana/kit";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createChainClient } from "../../../src/chain/client.ts";
import { chainEndpoints } from "../../../src/config.ts";
import type { Db } from "../../../src/db/client.ts";
import {
  attempts,
  legs,
  paychecks,
  routers,
  verifications,
  wallets,
} from "../../../src/db/schema.ts";
import { createTestDb, testApp, testEnv } from "../helpers/app.ts";
import { bearer, sessionFor } from "../helpers/session.ts";

const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const sig = (seed: string) => seed.padEnd(88, "1");
const addr = (seed: string) => seed.padEnd(44, "1");

/** Test rows shaped like what the RouterActor mirrors after one paycheck. */
async function seedPaycheck(db: Db, userId: string, owner: string) {
  const [wallet] = await db.select().from(wallets).where(eq(wallets.address, owner));
  const [router] = await db
    .insert(routers)
    .values({
      userId,
      walletId: wallet?.id ?? null,
      owner,
      routerPda: addr(`R${owner.slice(0, 6)}`),
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
      paycheckPda: addr(`P${owner.slice(0, 6)}`),
      inflowSig: sig("Zn"),
      senderOwner: "75uzrnEcXXKf7fi53BxTBh5kTJCY7o6WD2qLvjMMShZd",
      inflow: 1_850_000_000n,
      investTotal: 370_000_000n,
      recordedSig: sig(`Rec${owner.slice(0, 6)}`),
      recordedAt: new Date("2026-09-25T13:30:00Z"),
      expiresAt: new Date("2026-09-28T13:30:00Z"),
    })
    .returning();
  if (!paycheck) throw new Error("paycheck insert failed");
  const executedSig = sig(`Ex${owner.slice(0, 6)}`);
  const [spyx, nvdax] = await db
    .insert(legs)
    .values([
      {
        paycheckId: paycheck.id,
        idx: 0,
        assetMint: SPYX,
        amountIn: 259_000_000n,
        status: "verified",
        outAmount: 41_130_000n,
        fee: 518_000n,
        issuerFee: 0n,
        refPriceE9: 628_000_000_000n,
        premiumBps: 12,
        executedSig,
        executedAt: new Date("2026-09-25T13:30:20Z"),
        verifiedAt: new Date("2026-09-25T13:31:00Z"),
      },
      {
        paycheckId: paycheck.id,
        idx: 1,
        assetMint: NVDAX,
        amountIn: 111_000_000n,
        status: "waiting",
        waitReason: "PREMIUM_TOO_HIGH",
        nextAttemptAt: new Date("2026-09-25T13:32:00Z"),
      },
    ])
    .returning();
  if (!spyx || !nvdax) throw new Error("leg insert failed");
  await db.insert(attempts).values([
    { legId: spyx.id, attemptNo: 0, kind: "send", outcome: "executed", signature: executedSig },
    {
      legId: nvdax.id,
      attemptNo: 0,
      kind: "simulate",
      outcome: "waiting",
      programErrorCode: 6022,
      reason: "PREMIUM_TOO_HIGH",
    },
  ]);
  await db.insert(verifications).values({
    legId: spyx.id,
    rpcProvider: "surfnet",
    finalizedSlot: 400n,
    ownerDeltaRaw: 41_130_000n,
    ownerUsdcDelta: -259_000_000n,
    recomputedMinOut: 41_000_000n,
    recomputedPremiumBps: 12,
    matches: true,
  });
  return { router, paycheck, spyx, nvdax, executedSig };
}

describe("paycheck and proof routes", () => {
  const env = testEnv();
  let app: ReturnType<typeof testApp>;
  let db: Db;

  beforeAll(async () => {
    ({ db } = await createTestDb());
    app = testApp(db, createChainClient(chainEndpoints(env)));
  });

  it("lists the owner's paychecks with legs and hides other users' paychecks", async () => {
    const owner = await generateKeyPairSigner();
    const other = await generateKeyPairSigner();
    const session = await sessionFor(app, env, owner);
    const otherSession = await sessionFor(app, env, other);
    await seedPaycheck(db, session.user.id, owner.address);

    const res = await app.request("/paychecks", { headers: bearer(session) }, env);
    expect(res.status).toBe(200);
    const body = api.PaychecksResponse.parse(await res.json());
    expect(body.paychecks).toHaveLength(1);
    expect(body.paychecks[0]?.legs.map((leg) => [leg.symbol, leg.status, leg.waitReason])).toEqual([
      ["SPYx", "verified", null],
      ["NVDAx", "waiting", "PREMIUM_TOO_HIGH"],
    ]);

    const empty = await app.request("/paychecks", { headers: bearer(otherSession) }, env);
    expect(api.PaychecksResponse.parse(await empty.json()).paychecks).toEqual([]);
  });

  it("returns paycheck detail with attempts, verification and fork explorer links", async () => {
    const owner = await generateKeyPairSigner();
    const session = await sessionFor(app, env, owner);
    const { paycheck } = await seedPaycheck(db, session.user.id, owner.address);
    const res = await app.request(`/paychecks/${paycheck.id}`, { headers: bearer(session) }, env);
    expect(res.status).toBe(200);
    const detail = api.PaycheckDetail.parse(await res.json());
    const [spyx, nvdax] = detail.legs;
    expect(spyx?.verification?.matches).toBe(true);
    expect(spyx?.verification?.ownerUsdcDelta).toBe("-259000000");
    expect(spyx?.links[0]?.url).toContain("cluster=custom");
    expect(nvdax?.attempts[0]).toMatchObject({
      programErrorCode: 6022,
      reason: "PREMIUM_TOO_HIGH",
    });

    const stranger = await sessionFor(app, env, await generateKeyPairSigner());
    const hidden = await app.request(
      `/paychecks/${paycheck.id}`,
      { headers: bearer(stranger) },
      env,
    );
    expect(hidden.status).toBe(404);
  });

  it("publishes proof without personal data", async () => {
    const owner = await generateKeyPairSigner();
    const session = await sessionFor(app, env, owner);
    const { executedSig } = await seedPaycheck(db, session.user.id, owner.address);

    const res = await app.request("/proof", {}, env);
    expect(res.status).toBe(200);
    const proof = api.ProofResponse.parse(await res.json());
    expect(proof.fork).toBe(true);
    expect(proof.campaign.slicesVerified).toBeGreaterThanOrEqual(1);
    expect(proof.campaign.waitsByReason.PREMIUM_TOO_HIGH).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(proof)).not.toContain(owner.address);

    const leg = await app.request(`/proof/legs/${executedSig}`, {}, env);
    expect(leg.status).toBe(200);
    expect(api.ProofLeg.parse(await leg.json()).verification?.matches).toBe(true);
    expect((await app.request(`/proof/legs/${sig("Nope")}`, {}, env)).status).toBe(404);
  });
});
