import { count } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  attempts,
  demoFundings,
  demoPaychecks,
  idempotencyKeys,
  inflows,
  legs,
  paychecks,
  routerLegs,
  routers,
  submittedTxs,
  users,
  verifications,
  wallets,
} from "../../../src/db/schema.ts";
import { clearForkRows, demoStatus, resetIntervalMs } from "../../../src/demo/fork-state.ts";
import { createTestDb, testEnv } from "../helpers/app.ts";

const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const HOUR = 3_600_000;
const START = Date.parse("2026-09-26T12:00:00Z");
const epoch = { id: "ab".repeat(16), startedAt: START };
const addr = (seed: string) => seed.padEnd(44, "1");
const sig = (seed: string) => seed.padEnd(88, "1");

describe("demo fork status", () => {
  it("reads RESET_EVERY_HOURS only where it is set", () => {
    expect(resetIntervalMs(testEnv({ RESET_EVERY_HOURS: "6" }))).toBe(6 * HOUR);
    expect(resetIntervalMs(testEnv())).toBeNull();
    expect(resetIntervalMs(testEnv({ RESET_EVERY_HOURS: "soon" }))).toBeNull();
  });

  it("reports the epoch start and the next reset while the fork is up", () => {
    expect(demoStatus({ epoch, reachable: true }, 6 * HOUR, START + HOUR)).toEqual({
      state: "up",
      lastResetAt: "2026-09-26T12:00:00.000Z",
      resetsAt: "2026-09-26T18:00:00.000Z",
    });
  });

  it("calls an unreachable fork resetting near its reset and down otherwise", () => {
    const unreachable = { epoch, reachable: false };
    expect(demoStatus(unreachable, 6 * HOUR, START + 6 * HOUR + 60_000).state).toBe("resetting");
    expect(demoStatus(unreachable, 6 * HOUR, START + 6 * HOUR - 60_000).state).toBe("resetting");
    expect(demoStatus(unreachable, 6 * HOUR, START + 2 * HOUR).state).toBe("down");
    expect(demoStatus({ epoch: null, reachable: false }, 6 * HOUR, START)).toEqual({
      state: "down",
      resetsAt: null,
      lastResetAt: null,
    });
  });

  it("gives no reset time where the fork does not reset on a schedule", () => {
    expect(demoStatus({ epoch, reachable: true }, null, START).resetsAt).toBeNull();
  });
});

describe("clearing the previous fork's rows", () => {
  it("drops routers, paychecks and fork transactions but keeps people signed in", async () => {
    const { db } = await createTestDb();
    const [user] = await db.insert(users).values({}).returning();
    if (!user) throw new Error("user insert failed");
    const [wallet] = await db
      .insert(wallets)
      .values({ userId: user.id, address: addr("Owner"), kind: "external" })
      .returning();
    const [router] = await db
      .insert(routers)
      .values({
        userId: user.id,
        walletId: wallet?.id ?? null,
        owner: addr("Owner"),
        routerPda: addr("Router"),
        authorityPda: addr("Auth"),
        payInAta: addr("Pay"),
        investBps: 2000,
        minInflow: 20_000_000n,
        dailyCap: 5_000_000_000n,
        maxWaitSecs: 259_200,
        autoConvert: true,
        recorder: addr("Recorder"),
      })
      .returning();
    if (!router) throw new Error("router insert failed");
    await db.insert(routerLegs).values({
      routerId: router.id,
      idx: 0,
      assetMint: SPYX,
      weightBps: 10_000,
      bandBps: 50,
      colorSlot: 1,
    });
    const [inflow] = await db
      .insert(inflows)
      .values({
        routerId: router.id,
        signature: sig("Inflow"),
        slot: 10n,
        amount: 1_850_000_000n,
        source: "reconcile",
      })
      .returning();
    const [paycheck] = await db
      .insert(paychecks)
      .values({
        routerId: router.id,
        seq: 1n,
        paycheckPda: addr("Paycheck"),
        inflowId: inflow?.id ?? null,
        inflow: 1_850_000_000n,
        investTotal: 370_000_000n,
        recordedSig: sig("Record"),
        recordedAt: new Date(START),
        expiresAt: new Date(START + 72 * HOUR),
      })
      .returning();
    if (!paycheck) throw new Error("paycheck insert failed");
    const [leg] = await db
      .insert(legs)
      .values({ paycheckId: paycheck.id, idx: 0, assetMint: SPYX, amountIn: 370_000_000n })
      .returning();
    if (!leg) throw new Error("leg insert failed");
    await db.insert(attempts).values({ legId: leg.id, attemptNo: 1, kind: "send", outcome: "ok" });
    await db.insert(verifications).values({ legId: leg.id, rpcProvider: "surfnet", matches: true });
    await db
      .insert(submittedTxs)
      .values({ signature: sig("Create"), userId: user.id, kind: "create" });
    await db.insert(idempotencyKeys).values({
      scope: `user:${user.id}`,
      key: "fund-once",
      requestHash: "h",
      statusCode: 200,
      response: {},
      expiresAt: new Date(START + HOUR),
    });
    await db.insert(demoFundings).values([
      { wallet: addr("Owner"), epoch: epoch.id },
      { wallet: addr("Owner"), epoch: "cd".repeat(16) },
    ]);
    await db.insert(demoPaychecks).values({
      wallet: addr("Owner"),
      epoch: epoch.id,
      amount: 1_850_000_000n,
      signature: sig("Paycheck"),
    });

    await clearForkRows(db, epoch.id);

    const rows = async (table: PgTable) => (await db.select({ n: count() }).from(table))[0]?.n;
    for (const table of [
      routers,
      routerLegs,
      inflows,
      paychecks,
      legs,
      attempts,
      verifications,
      submittedTxs,
      idempotencyKeys,
      demoPaychecks,
    ]) {
      expect(await rows(table)).toBe(0);
    }
    expect(await rows(demoFundings)).toBe(1);
    expect(await rows(users)).toBe(1);
    expect(await rows(wallets)).toBe(1);
  });
});
