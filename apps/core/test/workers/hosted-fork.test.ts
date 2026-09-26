import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { jsonRpc } from "@paycheck-router/sdk";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChainClient } from "../../src/chain/client.ts";
import { chainEndpoints } from "../../src/config.ts";
import { createDb } from "../../src/db/client.ts";
import { routers, users } from "../../src/db/schema.ts";
import { inflowWatcher, routerActorFor } from "../../src/do/stubs.ts";
import { provideEngine } from "../../src/engine/factory.ts";
import type { Engine } from "../../src/engine/types.ts";
import type { Env } from "../../src/env.ts";
import { FakeFork } from "../node/helpers/fork.ts";

const testEnv = env as unknown as Env;
const KEY = "vitest-surfnet-key";
const address = (seed: string) => seed.padEnd(44, "1");

describe("hosted fork access inside workerd", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends X-Surfnet-Key from the kit client and from URL-only SDK calls", async () => {
    const fork = new FakeFork("https://fork.test");
    fork.on("getSlot", () => 7).on("getTransaction", () => null);
    vi.stubGlobal("fetch", fork.fetch);
    const hosted = { ...testEnv, SURFNET_RPC_URL: "https://fork.test", SURFNET_RPC_KEY: KEY };

    const chain = createChainClient(chainEndpoints(hosted));
    expect(await chain.rpc.getSlot().send()).toBe(7n);
    await jsonRpc("https://fork.test", "getTransaction", ["sig"]);

    expect(fork.calls.map((call) => [call.method, call.key])).toEqual([
      ["getSlot", KEY],
      ["getTransaction", KEY],
    ]);
  });
});

describe("InflowWatcher across a fork reset", () => {
  let fork: FakeFork;
  const accounts = new Map<string, string>();

  beforeEach(() => {
    accounts.clear();
    fork = new FakeFork(testEnv.SURFNET_RPC_URL);
    fork
      .on("getAccountInfo", ([pubkey]) => {
        const data = accounts.get(pubkey as string);
        return {
          context: { slot: 1 },
          value: data
            ? {
                data: [btoa(String.fromCharCode(...hexBytes(data))), "base64"],
                executable: false,
                lamports: 1_000_000,
                owner: "11111111111111111111111111111111",
                rentEpoch: 0,
                space: data.length / 2,
              }
            : null,
        };
      })
      .on("surfnet_setAccount", ([pubkey, update]) => {
        accounts.set(pubkey as string, (update as { data: string }).data);
        return null;
      });
    vi.stubGlobal("fetch", fork.fetch);
    vi.useFakeTimers({ toFake: ["Date"] });
    provideEngine(() => ({ sweep: async () => [] }) as unknown as Engine);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("marks a fresh fork, clears the old fork's routers after a reset, and reports an outage", async () => {
    const watcher = inflowWatcher(testEnv);
    const first = await watcher.forkView();
    expect(first.reachable).toBe(true);
    expect(accounts.size).toBe(1);

    const db = createDb(testEnv.HYPERDRIVE as Hyperdrive);
    const [user] = await db.insert(users).values({}).returning();
    const [router] = await db
      .insert(routers)
      .values({
        userId: user?.id ?? null,
        owner: address("ResetOwner"),
        routerPda: address("ResetRouter"),
        authorityPda: address("ResetAuth"),
        payInAta: address("ResetPay"),
        investBps: 2000,
        minInflow: 20_000_000n,
        dailyCap: 5_000_000_000n,
        maxWaitSecs: 259_200,
        autoConvert: true,
        recorder: address("Recorder"),
      })
      .returning();
    if (!router) throw new Error("router insert failed");
    const ref = {
      routerId: router.id,
      userId: router.userId,
      routerPda: router.routerPda,
      owner: router.owner,
      payIn: router.payInAta,
      authority: router.authorityPda,
    };
    const actor = routerActorFor(testEnv, router.id);
    await actor.init(ref, {
      minInflow: 20_000_000n,
      appThreshold: 0n,
      taggedPayersOnly: false,
      taggedPayers: [],
    });
    await watcher.watch(ref);

    // The VPS restores the snapshot: the marker is gone.
    accounts.clear();
    vi.setSystemTime(Date.now() + 11_000);
    const second = await watcher.forkView();
    expect(second.reachable).toBe(true);
    expect(second.epoch?.id).not.toBe(first.epoch?.id);
    expect(await watcher.watched()).toEqual([]);
    expect(await db.select().from(routers).where(eq(routers.id, router.id))).toEqual([]);
    const metaRows = await runInDurableObject(actor, (_instance, state) =>
      state.storage.sql.exec("select count(*) as n from meta").one(),
    );
    expect(metaRows.n).toBe(0);

    fork.down = true;
    vi.setSystemTime(Date.now() + 11_000);
    expect(await watcher.forkView()).toEqual({ epoch: second.epoch, reachable: false });
  });
});

function hexBytes(hex: string): number[] {
  return Array.from({ length: hex.length / 2 }, (_, i) =>
    Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16),
  );
}
