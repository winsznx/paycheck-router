import { describe, expect, it } from "vitest";
import type { PreStocksRead } from "../src/attester.ts";
import { PRESTOCKS_REUSE_SECS, sharedPreStocksReader } from "../src/leg.ts";

const read = (observedAt: number): PreStocksRead => ({
  entries: [],
  rejected: [],
  raw: "[]",
  observedAt,
});

describe("sharedPreStocksReader", () => {
  it("reads once per window and again once the window has passed", async () => {
    let clock = 1_000_000;
    let calls = 0;
    const shared = sharedPreStocksReader(
      async () => read(++calls),
      () => clock,
    );
    expect((await shared()).observedAt).toBe(1);
    clock += PRESTOCKS_REUSE_SECS * 1000;
    expect((await shared()).observedAt).toBe(1);
    clock += 1;
    expect((await shared()).observedAt).toBe(2);
    expect(calls).toBe(2);
  });

  it("shares a failed read inside the window so retries don't call the API again", async () => {
    let clock = 0;
    let calls = 0;
    const shared = sharedPreStocksReader(
      async () => {
        calls++;
        throw new Error("PreStocks API 429: Too Many Requests");
      },
      () => clock,
    );
    await expect(shared()).rejects.toThrow(/429/);
    await expect(shared()).rejects.toThrow(/429/);
    expect(calls).toBe(1);
    clock += PRESTOCKS_REUSE_SECS * 1000 + 1;
    await expect(shared()).rejects.toThrow(/429/);
    expect(calls).toBe(2);
  });
});
