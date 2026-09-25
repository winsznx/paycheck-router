import { USDC_MINT } from "@paycheck-router/shared";
import { type Address, address, getBase64Decoder } from "@solana/kit";
import { AccountState, getTokenEncoder } from "@solana-program/token";
import { describe, expect, it } from "vitest";
import { classifyInflow, type InflowRules } from "../src/classify.ts";
import {
  inflowFromTransaction,
  type RouterSnapshot,
  reconcileSweep,
  SWEEP_BATCH_SIZE,
} from "../src/reconcile.ts";
import type { SolanaRpc } from "../src/rpc.ts";

const owner = address("hoyjKyffP55yKjj8aEGARUQi5xKC3bZTYv4j4ih3dBy");
const employer = address("75uzrnEcXXKf7fi53BxTBh5kTJCY7o6WD2qLvjMMShZd");
const authority = address("5ZiE3vAkrdXBgyFL7KqG3RoEGBws4CjRcXVbABDLZTgx");
const payIn = address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
const employerUsdc = address("CuZDTZrPcGrRcjjFEF4UmcxgGq75Jm8eFFaxAWnSBBGA");

const rules: InflowRules = {
  owner,
  authority,
  routerMinInflow: 1_000_000n,
  appThreshold: 5_000_000n,
  taggedPayersOnly: false,
  taggedPayers: new Set(),
};

describe("classifyInflow", () => {
  it("records pay above both minimums from another wallet", () => {
    expect(classifyInflow({ amount: 100_000_000n, sender: employer }, rules)).toEqual({
      action: "record",
    });
  });

  it("skips below the higher of the router and app minimums", () => {
    expect(classifyInflow({ amount: 4_999_999n, sender: employer }, rules)).toEqual({
      action: "skip",
      reason: "below_minimum",
    });
  });

  it("skips self-transfers and protocol sweep-backs", () => {
    expect(classifyInflow({ amount: 100_000_000n, sender: owner }, rules)).toMatchObject({
      reason: "self_transfer",
    });
    expect(classifyInflow({ amount: 100_000_000n, sender: authority }, rules)).toMatchObject({
      reason: "protocol_movement",
    });
  });

  it("skips untagged senders when tagged payers only is on", () => {
    const tagged = { ...rules, taggedPayersOnly: true, taggedPayers: new Set<Address>([employer]) };
    expect(classifyInflow({ amount: 100_000_000n, sender: employer }, tagged).action).toBe(
      "record",
    );
    expect(classifyInflow({ amount: 100_000_000n, sender: null }, tagged)).toMatchObject({
      reason: "untagged_sender",
    });
  });
});

describe("inflowFromTransaction", () => {
  const tx = {
    slot: 100,
    meta: {
      err: null,
      preTokenBalances: [
        {
          accountIndex: 1,
          mint: USDC_MINT,
          owner: employer,
          uiTokenAmount: { amount: "900000000" },
        },
        { accountIndex: 2, mint: USDC_MINT, owner, uiTokenAmount: { amount: "5000000" } },
      ],
      postTokenBalances: [
        {
          accountIndex: 1,
          mint: USDC_MINT,
          owner: employer,
          uiTokenAmount: { amount: "400000000" },
        },
        { accountIndex: 2, mint: USDC_MINT, owner, uiTokenAmount: { amount: "505000000" } },
      ],
    },
    transaction: {
      message: { accountKeys: [{ pubkey: employer }, { pubkey: employerUsdc }, { pubkey: payIn }] },
    },
  };

  it("reads the credit to the pay-in account and the payer's wallet", () => {
    expect(inflowFromTransaction(tx, payIn)).toEqual({ amount: 500_000_000n, sender: employer });
  });

  it("ignores failed transactions and ones that do not touch the pay-in account", () => {
    expect(
      inflowFromTransaction({ ...tx, meta: { ...tx.meta, err: { x: 1 } } }, payIn).amount,
    ).toBe(0n);
    expect(inflowFromTransaction(tx, authority).amount).toBe(0n);
  });
});

describe("reconcileSweep", () => {
  function tokenAccount(amount: bigint): string {
    const bytes = getTokenEncoder().encode({
      mint: USDC_MINT,
      owner,
      amount,
      delegate: null,
      state: AccountState.Initialized,
      isNative: null,
      delegatedAmount: 0n,
      closeAuthority: null,
    });
    return getBase64Decoder().decode(bytes);
  }

  function stubRpc(balances: Map<string, bigint>, batches: number[]): SolanaRpc {
    const rpc = {
      getMultipleAccounts: (addresses: Address[]) => ({
        send: async () => {
          batches.push(addresses.length);
          return {
            context: { slot: 42n },
            value: addresses.map((a) =>
              balances.has(a)
                ? { data: [tokenAccount(balances.get(a) ?? 0n), "base64"] }
                : { data: ["AAAAAAAAAAA=", "base64"] },
            ),
          };
        },
      }),
    };
    return rpc as unknown as SolanaRpc;
  }

  const decodeRouter = (watermark: bigint) => (): RouterSnapshot => ({
    owner,
    payIn,
    watermark,
    minInflow: 1_000_000n,
    paused: false,
  });

  it("flags a balance above watermark plus the minimum", async () => {
    const router = address("7okuGKwRkoLvcGsu1wXHC3gqJQk41FZT9mo363Qsefwu");
    const batches: number[] = [];
    const rpc = stubRpc(new Map([[payIn, 505_000_000n]]), batches);
    const found = await reconcileSweep(rpc, [{ router, payIn }], decodeRouter(5_000_000n));
    expect(found).toEqual([
      {
        router,
        payIn,
        owner,
        balance: 505_000_000n,
        watermark: 5_000_000n,
        delta: 500_000_000n,
        slot: 42n,
      },
    ]);
  });

  it("ignores dust and routers with a record in flight", async () => {
    const router = address("7okuGKwRkoLvcGsu1wXHC3gqJQk41FZT9mo363Qsefwu");
    const rpc = stubRpc(new Map([[payIn, 5_500_000n]]), []);
    expect(await reconcileSweep(rpc, [{ router, payIn }], decodeRouter(5_000_000n))).toEqual([]);
    const rich = stubRpc(new Map([[payIn, 505_000_000n]]), []);
    expect(
      await reconcileSweep(rich, [{ router, payIn }], decodeRouter(5_000_000n), new Set([router])),
    ).toEqual([]);
  });

  it("reads at most 100 accounts per call", async () => {
    const targets = Array.from({ length: 120 }, () => ({ router: authority, payIn }));
    const batches: number[] = [];
    await reconcileSweep(stubRpc(new Map([[payIn, 0n]]), batches), targets, decodeRouter(0n));
    expect(batches).toEqual([SWEEP_BATCH_SIZE, SWEEP_BATCH_SIZE, 40]);
  });
});
