import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FORK_EXCLUDED_DEXES, USDC_MINT } from "@paycheck-router/shared";
import { AccountRole, address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  buildJupiterSwap,
  JupiterBuildError,
  JupiterBuildResponse,
  jupiterBuildQuery,
  toKitInstruction,
  toLookupTables,
} from "../src/jupiter.ts";

const recorded = readFileSync(
  resolve(import.meta.dirname, "fixtures", "jupiter-build.json"),
  "utf8",
);

const params = {
  inputMint: USDC_MINT,
  outputMint: address("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"),
  amount: 19_960_000n,
  taker: address("5ZiE3vAkrdXBgyFL7KqG3RoEGBws4CjRcXVbABDLZTgx"),
  payer: address("7okuGKwRkoLvcGsu1wXHC3gqJQk41FZT9mo363Qsefwu"),
  destinationTokenAccount: address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"),
  slippageBps: 50,
  surfnet: true,
};

describe("jupiterBuildQuery", () => {
  it("builds with the PDA taker, crank payer, owner destination and the band as slippage", () => {
    const query = jupiterBuildQuery(params);
    expect(query.get("taker")).toBe(params.taker);
    expect(query.get("payer")).toBe(params.payer);
    expect(query.get("destinationTokenAccount")).toBe(params.destinationTokenAccount);
    expect(query.get("slippageBps")).toBe("50");
    expect(query.get("maxAccounts")).toBe("40");
    expect(query.get("computeUnitPricePercentile")).toBe("high");
    expect(query.get("amount")).toBe("19960000");
  });

  it("excludes proprietary AMMs on surfnets only", () => {
    expect(jupiterBuildQuery(params).get("excludeDexes")).toBe(FORK_EXCLUDED_DEXES.join(","));
    expect(jupiterBuildQuery({ ...params, surfnet: false }).has("excludeDexes")).toBe(false);
  });
});

describe("buildJupiterSwap", () => {
  it("parses a recorded /swap/v2/build response and keeps the raw body", async () => {
    let seenHeaders: HeadersInit | undefined;
    const result = await buildJupiterSwap(params, {
      apiKey: "test-key",
      fetch: async (_url, init) => {
        seenHeaders = init?.headers;
        return new Response(recorded);
      },
    });
    expect(result.raw).toBe(recorded);
    expect(result.response.swapInstruction.accounts.length).toBeGreaterThan(0);
    expect(seenHeaders).toEqual({ "x-api-key": "test-key" });
  });

  it("raises the status and body on failure", async () => {
    await expect(
      buildJupiterSwap(params, {
        fetch: async () => new Response("rate limited", { status: 429 }),
      }),
    ).rejects.toBeInstanceOf(JupiterBuildError);
  });
});

describe("instruction conversion", () => {
  const response = JupiterBuildResponse.parse(JSON.parse(recorded));

  it("maps signer and writable flags to kit roles", () => {
    const ix = toKitInstruction({
      programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
      data: "AQID",
      accounts: [
        { pubkey: params.taker, isSigner: true, isWritable: true },
        { pubkey: params.payer, isSigner: true, isWritable: false },
        { pubkey: params.destinationTokenAccount, isSigner: false, isWritable: true },
        { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      ],
    });
    expect(ix.accounts?.map((a) => a.role)).toEqual([
      AccountRole.WRITABLE_SIGNER,
      AccountRole.READONLY_SIGNER,
      AccountRole.WRITABLE,
      AccountRole.READONLY,
    ]);
    expect([...(ix.data ?? [])]).toEqual([1, 2, 3]);
  });

  it("converts the recorded lookup tables", () => {
    const tables = toLookupTables(response.addressesByLookupTableAddress);
    expect(Object.keys(tables).length).toBeGreaterThan(0);
    expect(toLookupTables(null)).toEqual({});
  });
});
