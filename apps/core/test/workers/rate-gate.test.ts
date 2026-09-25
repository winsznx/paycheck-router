import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../../src/env.ts";

const testEnv = env as unknown as Env;

describe("RateGate", () => {
  it("queues Jupiter callers one second apart", async () => {
    const gate = testEnv.RATE_GATE.get(testEnv.RATE_GATE.idFromName("jupiter-spacing"));
    const t0 = 1_000_000;
    expect(await gate.reserve("jupiter", t0)).toEqual({ granted: true, waitMs: 0 });
    expect(await gate.reserve("jupiter", t0)).toEqual({ granted: true, waitMs: 1000 });
    expect(await gate.reserve("jupiter", t0)).toEqual({ granted: true, waitMs: 2000 });
    expect(await gate.reserve("jupiter", t0 + 5_000)).toEqual({ granted: true, waitMs: 0 });
  });

  it("turns callers away once the queue is longer than 30 s", async () => {
    const gate = testEnv.RATE_GATE.get(testEnv.RATE_GATE.idFromName("jupiter-full"));
    const t0 = 2_000_000;
    for (let i = 0; i <= 30; i++) await gate.reserve("jupiter", t0);
    const reservation = await gate.reserve("jupiter", t0);
    expect(reservation.granted).toBe(false);
  });

  it("lets Hermes burst to ten", async () => {
    const gate = testEnv.RATE_GATE.get(testEnv.RATE_GATE.idFromName("hermes-burst"));
    const t0 = 3_000_000;
    for (let i = 0; i < 10; i++) {
      expect(await gate.reserve("hermes", t0)).toEqual({ granted: true, waitMs: 0 });
    }
    expect(await gate.reserve("hermes", t0)).toEqual({ granted: true, waitMs: 100 });
  });
});
