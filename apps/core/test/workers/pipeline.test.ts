import { env } from "cloudflare:workers";
import { api } from "@paycheck-router/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../../src/db/client.ts";
import { legs, paychecks, routers, verifications } from "../../src/db/schema.ts";
import { inflowWatcher, routerActorFor, userHubFor } from "../../src/do/stubs.ts";
import { provideEngine } from "../../src/engine/factory.ts";
import type {
  Engine,
  LegJob,
  RecordedPaycheck,
  RouterRef,
  SweepHit,
} from "../../src/engine/types.ts";
import type { Env } from "../../src/env.ts";

const testEnv = env as unknown as Env;

const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";

/** Base58 stand-ins with the right shape; the scripted engine never touches a chain. */
const address = (seed: string) => seed.padEnd(44, "1");
const signature = (seed: string) => seed.padEnd(88, "1");

function routerRef(suffix: string): RouterRef {
  return {
    routerId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    routerPda: address(`Router${suffix}`),
    owner: "hoyjKyffP55yKjj8aEGARUQi5xKC3bZTYv4j4ih3dBy",
    payIn: address(`PayZn${suffix}`),
    authority: address(`Authority${suffix}`),
  };
}

const RULES = {
  minInflow: 20_000_000n,
  appThreshold: 0n,
  taggedPayersOnly: false,
  taggedPayers: [],
};

/** A scripted chain: one paycheck of 1,850 USDC split 70/30, the NVDAx slice waits once. */
class ScriptedEngine implements Engine {
  balance = 1_850_000_000n;
  watermark = 0n;
  recorded: RecordedPaycheck | null = null;
  executed: string[] = [];
  nvdaxAttempts = 0;

  async sweep(routers: readonly RouterRef[]): Promise<SweepHit[]> {
    return routers
      .filter(() => this.balance >= this.watermark + RULES.minInflow)
      .map((router) => ({
        routerPda: router.routerPda,
        balance: this.balance,
        watermark: this.watermark,
        delta: this.balance - this.watermark,
        slot: 100n,
      }));
  }
  async resolveInflows() {
    return [
      {
        signature: signature("Zn2f3w"),
        slot: 99n,
        amount: 1_850_000_000n,
        sender: "75uzrnEcXXKf7fi53BxTBh5kTJCY7o6WD2qLvjMMShZd",
      },
    ];
  }
  classify() {
    return { action: "record" as const };
  }
  async recordPaycheck() {
    this.watermark = this.balance;
    this.recorded = {
      signature: signature("Record"),
      paycheckPda: address("Paycheck"),
      seq: 0n,
      inflow: 1_850_000_000n,
      investTotal: 370_000_000n,
      recordedAt: new Date(),
      expiresAt: new Date(Date.now() + 3 * 86_400_000),
      legs: [
        { idx: 0, mint: SPYX, amountIn: 259_000_000n, bandBps: 50 },
        { idx: 1, mint: NVDAX, amountIn: 111_000_000n, bandBps: 50 },
      ],
    };
    return { kind: "recorded" as const, paycheck: this.recorded };
  }
  async skipInflow() {
    return { signature: "SkipSig" };
  }
  async executeLegs(jobs: readonly LegJob[], hooks: Parameters<Engine["executeLegs"]>[1]) {
    for (const job of [...jobs].sort((a, b) => Number(b.amountIn - a.amountIn))) {
      await hooks.executing(job);
      if (job.mint === NVDAX && this.nvdaxAttempts++ === 0) {
        await hooks.outcome(job, {
          kind: "waiting",
          reason: "PREMIUM_TOO_HIGH",
          programErrorCode: 6022,
          attempts: [],
          measured: { refPriceE9: 181_500_000_000n, premiumBps: 84 },
        });
        continue;
      }
      this.executed.push(job.mint);
      await hooks.outcome(job, {
        kind: "executed",
        attempts: [],
        leg: {
          signature: signature(`Exec${job.idx + 2}`),
          slot: 120n,
          outAmount: 41_130_000n,
          fee: job.amountIn / 500n,
          issuerFee: 0n,
          uiMultiplier: "1.0009180758490996",
          refPriceE9: 628_000_000_000n,
          execPriceE9: 629_000_000_000n,
          premiumBps: 15,
          evidence: {},
        },
      });
    }
  }
  async expireLeg() {
    return { signature: "ExpireSig" };
  }
  async verifyLeg() {
    return {
      rpcProvider: "surfnet",
      finalizedSlot: 130n,
      ownerDeltaRaw: 41_130_000n,
      ownerUsdcDelta: -259_000_000n,
      recomputedMinOut: 41_000_000n,
      recomputedPremiumBps: 15,
      matches: true,
      diff: null,
      hermesPublishTime: new Date(),
    };
  }
  async readRouter() {
    return null;
  }
  buildCreateRouter(): never {
    throw new Error("not used");
  }
  buildCancelLeg(): never {
    throw new Error("not used");
  }
  buildBuyNow(): never {
    throw new Error("not used");
  }
  buildRouterAction(): never {
    throw new Error("not used");
  }
}

describe("detection to verification", () => {
  it("detects, records, executes largest first, waits, verifies and streams every event", async () => {
    const engine = new ScriptedEngine();
    provideEngine(() => engine);
    const ref = routerRef("A");
    if (!testEnv.HYPERDRIVE) throw new Error("the Workers tests bind HYPERDRIVE");
    const db = createDb(testEnv.HYPERDRIVE);
    await db.insert(routers).values({
      id: ref.routerId,
      owner: ref.owner,
      routerPda: ref.routerPda,
      authorityPda: ref.authority,
      payInAta: ref.payIn,
      investBps: 2000,
      minInflow: RULES.minInflow,
      dailyCap: 5_000_000_000n,
      maxWaitSecs: 259_200,
      autoConvert: true,
      recorder: "EGaHpAB9Svfv6zW8ZcNrSEayvMPNsg1gJqQUPDYfNKqL",
    });
    const actor = routerActorFor(testEnv, ref.routerId);
    await actor.init(ref, RULES);
    const watcher = inflowWatcher(testEnv);
    await watcher.watch(ref);

    const hits = await watcher.sweep();
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    if (!hit) throw new Error("no hit");
    expect(hit.delta).toBe(1_850_000_000n);

    // The real queues deliver: inflows -> RouterActor -> executions -> verify.
    await vi.waitUntil(
      async () => {
        const [paycheck] = await actor.paychecks();
        return paycheck?.legs.find((leg) => leg.mint === SPYX)?.status === "verified";
      },
      { timeout: 20_000, interval: 100 },
    );
    const [paycheck] = await actor.paychecks();
    const nvdax = paycheck?.legs.find((leg) => leg.mint === NVDAX);
    expect(nvdax?.status).toBe("waiting");
    expect(nvdax?.waitReason).toBe("PREMIUM_TOO_HIGH");
    expect(nvdax).toMatchObject({ refPriceE9: "181500000000", premiumBps: 84 });
    expect(nvdax?.nextAttemptAt).not.toBeNull();
    const spyx = paycheck?.legs.find((leg) => leg.mint === SPYX);
    expect(spyx?.uiMultiplier).toBe("1.0009180758490996");
    expect(spyx?.sharesUi).toBe("0.41167760459673466548");
    expect(engine.executed).toEqual([SPYX]);

    const { events } = await userHubFor(testEnv, ref.userId ?? "").replay(
      "00000000000000000000000000",
    );
    const types = events.map((event) => event.type);
    expect(types.slice(0, 2)).toEqual(["paycheck.detected", "paycheck.recorded"]);
    expect(types).toContain("leg.executing");
    expect(types).toContain("leg.executed");
    expect(types).toContain("leg.waiting");
    expect(types).toContain("leg.verified");
    for (const event of events) {
      const parsed = api.ServerEvent.safeParse(event);
      expect(parsed.error?.issues ?? [], event.type).toEqual([]);
    }

    // Every transition reaches Supabase through the actor's outbox.
    const mirroredLegs = () =>
      db
        .select({
          mint: legs.assetMint,
          status: legs.status,
          waitReason: legs.waitReason,
          premiumBps: legs.premiumBps,
        })
        .from(legs)
        .innerJoin(paychecks, eq(paychecks.id, legs.paycheckId))
        .where(eq(paychecks.routerId, ref.routerId))
        .orderBy(legs.idx);
    await vi.waitUntil(
      async () => (await mirroredLegs()).some((row) => row.status === "verified"),
      { timeout: 20_000, interval: 200 },
    );
    expect(await mirroredLegs()).toEqual([
      { mint: SPYX, status: "verified", waitReason: null, premiumBps: 15 },
      { mint: NVDAX, status: "waiting", waitReason: "PREMIUM_TOO_HIGH", premiumBps: 84 },
    ]);
    const [verification] = await db
      .select({ matches: verifications.matches })
      .from(verifications)
      .innerJoin(legs, eq(legs.id, verifications.legId))
      .innerJoin(paychecks, eq(paychecks.id, legs.paycheckId))
      .where(eq(paychecks.routerId, ref.routerId));
    expect(verification?.matches).toBe(true);
  });

  it("does not record again while the watermark covers the balance", async () => {
    const engine = new ScriptedEngine();
    engine.watermark = engine.balance;
    provideEngine(() => engine);
    const ref = routerRef("B");
    await routerActorFor(testEnv, ref.routerId).init(ref, RULES);
    const watcher = inflowWatcher(testEnv);
    await watcher.watch(ref);
    expect(await watcher.sweep()).toEqual([]);
  });
});
