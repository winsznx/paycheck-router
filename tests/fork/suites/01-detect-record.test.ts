import { recordPaycheck } from "@paycheck-router/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ForkPaycheck, forkWithPaycheck, PAYCHECK_USDC, readPaycheck } from "../helpers.ts";

describe("paycheck detection and recording on a fresh surfnet", () => {
  let fork: ForkPaycheck;

  beforeAll(async () => {
    fork = await forkWithPaycheck([
      { symbol: "NVDAx", weightBps: 5_000, bandBps: 50 },
      { symbol: "Anthropic", weightBps: 5_000, bandBps: 300 },
    ]);
  });

  afterAll(async () => {
    await fork?.surfnet.stop();
  });

  it("detects the employer's transferChecked and records the whole inflow", () => {
    expect(fork.account.inflow).toBe(PAYCHECK_USDC);
    expect(fork.account.seq).toBe(0n);
  });

  it("invests 20% split evenly across the router's legs", () => {
    expect(fork.account.investTotal).toBe(370_000_000n);
    expect(fork.account.legs.map((leg) => leg.amountIn)).toEqual([185_000_000n, 185_000_000n]);
    expect(fork.account.legs.every((leg) => leg.status === 0)).toBe(true);
  });

  it("changes nothing when record_paycheck is replayed without new USDC", async () => {
    const replay = await recordPaycheck(fork.surfnet.rpc, {
      recorder: fork.signers.recorder,
      payer: fork.signers.crank,
      router: fork.demo.router,
      payIn: fork.demo.payIn,
      detectedSlot: fork.detectedSlot,
    });
    expect(replay.outcome.status).toBe("failed");
    expect(
      JSON.stringify(replay.outcome.err, (_, v) => (typeof v === "bigint" ? Number(v) : v)),
    ).toContain("6007");
    const after = await readPaycheck(fork);
    expect(after.inflow).toBe(fork.account.inflow);
    expect(after.legs).toEqual(fork.account.legs);
  });
});
