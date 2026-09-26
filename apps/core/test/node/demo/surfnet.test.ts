import { jsonRpc } from "@paycheck-router/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChainClient } from "../../../src/chain/client.ts";
import { chainEndpoints } from "../../../src/config.ts";
import {
  decodeEpoch,
  encodeEpoch,
  epochMarker,
  markEpoch,
  readEpoch,
  setLamports,
  setTokenBalance,
  surfnetRpc,
} from "../../../src/demo/surfnet.ts";
import { ApiError } from "../../../src/http/problem.ts";
import { testEnv } from "../helpers/app.ts";
import { FakeFork } from "../helpers/fork.ts";

const FORK = "https://fork.test";
const KEY = "vitest-surfnet-key";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const WALLET = "hoyjKyffP55yKjj8aEGARUQi5xKC3bZTYv4j4ih3dBy";

describe("hosted fork access", () => {
  let fork: FakeFork;
  const env = testEnv({ SURFNET_RPC_URL: FORK, SURFNET_RPC_KEY: KEY });

  beforeEach(() => {
    fork = new FakeFork(FORK);
    vi.stubGlobal("fetch", fork.fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the key header from core's kit clients", async () => {
    fork.on("getSlot", () => 42);
    const chain = createChainClient(chainEndpoints(env));
    expect(await chain.rpc.getSlot().send()).toBe(42n);
    expect(await chain.verifyRpc.getSlot().send()).toBe(42n);
    expect(fork.called("getSlot").map((call) => call.key)).toEqual([KEY, KEY]);
  });

  it("adds the key to SDK calls that only know the URL, and to nothing else", async () => {
    fork.on("getTransaction", () => null);
    chainEndpoints(env);
    await jsonRpc(FORK, "getTransaction", ["sig"]);
    expect(fork.called("getTransaction")[0]?.key).toBe(KEY);
    await expect(fetch("https://elsewhere.test/")).rejects.toThrow(/unexpected fetch/);
  });

  it("sends no key where none is configured", async () => {
    fork.on("getSlot", () => 1);
    const plain = createChainClient(chainEndpoints(testEnv({ SURFNET_RPC_URL: FORK })));
    await plain.rpc.getSlot().send();
    expect(fork.called("getSlot")[0]?.key).toBeNull();
  });

  it("sets balances with the surfnet cheatcodes", async () => {
    fork.on("surfnet_setAccount", () => null).on("surfnet_setTokenAccount", () => null);
    await setLamports(env, WALLET, 50_000_000n);
    await setTokenBalance(env, WALLET, env.USDC_MINT, 5_000_000_000n, TOKEN_PROGRAM);
    expect(fork.calls).toEqual([
      {
        url: `${FORK}/`,
        method: "surfnet_setAccount",
        params: [WALLET, { lamports: 50_000_000 }],
        key: KEY,
      },
      {
        url: `${FORK}/`,
        method: "surfnet_setTokenAccount",
        params: [
          WALLET,
          env.USDC_MINT,
          { amount: 5_000_000_000, state: "initialized" },
          TOKEN_PROGRAM,
        ],
        key: KEY,
      },
    ]);
  });

  it("reports a fork that is down as upstream_unavailable and an RPC error as chain_error", async () => {
    fork.down = true;
    const down = await surfnetRpc(env, "getSlot", []).catch((error: unknown) => error);
    expect(down).toBeInstanceOf(ApiError);
    expect(down).toMatchObject({ status: 503, code: "upstream_unavailable" });

    fork.down = false;
    const refused = await surfnetRpc(env, "surfnet_nope", []).catch((error: unknown) => error);
    expect(refused).toMatchObject({ status: 502, code: "chain_error" });

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("connection refused")));
    const unreachable = await surfnetRpc(env, "getSlot", []).catch((error: unknown) => error);
    expect(unreachable).toMatchObject({ status: 503, code: "upstream_unavailable" });
  });

  it("marks a fresh fork and reads the epoch back", async () => {
    const accounts = new Map<string, string>();
    fork
      .on("getAccountInfo", ([pubkey]) => {
        const data = accounts.get(pubkey as string);
        return {
          context: { slot: 1 },
          value: data
            ? {
                data: [Buffer.from(data, "hex").toString("base64"), "base64"],
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

    expect(await readEpoch(env)).toBeNull();
    const epoch = await markEpoch(env, 1_790_000_000_000);
    expect(epoch.id).toMatch(/^[0-9a-f]{32}$/);
    expect(fork.called("surfnet_setAccount")[0]?.params).toEqual([
      await epochMarker(),
      {
        lamports: 1_000_000,
        data: Buffer.from(encodeEpoch(epoch)).toString("hex"),
        owner: "11111111111111111111111111111111",
      },
    ]);
    expect(await readEpoch(env)).toEqual(epoch);
  });

  it("round-trips the marker encoding and rejects other data", () => {
    const epoch = { id: "00ff".repeat(8), startedAt: 1_790_000_123_456 };
    expect(decodeEpoch(encodeEpoch(epoch))).toEqual(epoch);
    expect(decodeEpoch(new Uint8Array(16))).toBeNull();
  });
});
