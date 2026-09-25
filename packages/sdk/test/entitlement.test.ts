import { assetBySymbol, USDC_FEED_ID, WaitReason } from "@paycheck-router/shared";
import { address, generateKeyPairSigner } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { fetchEntitledUpdate, HermesError } from "../src/hermes.ts";
import { executePaycheckLegs, type PendingLeg, requiredFeeds } from "../src/leg.ts";
import type { SolanaRpc } from "../src/rpc.ts";

const NVDA = "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593";
/** Hermes' body for a key without equity grants, recorded 2026-09-25. */
const NOT_ENTITLED = `Not entitled: feed ${NVDA} (no grant accepts this feed (asset type 'equity', instrument type 'spot', exchange 1))`;

const usdcOnly = JSON.stringify({
  binary: { encoding: "base64", data: [] },
  parsed: [
    {
      id: USDC_FEED_ID,
      price: { price: "99986997", conf: "23503", expo: -8, publish_time: 1_790_338_397 },
      ema_price: { price: "99986997", conf: "23503", expo: -8, publish_time: 1_790_338_397 },
      metadata: null,
    },
  ],
});

function hermesStub(refuse: (ids: string[]) => string | null) {
  const requests: string[][] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const ids = [...new URL(String(input)).searchParams.getAll("ids[]")];
    requests.push(ids);
    const refusal = refuse(ids);
    return refusal ? new Response(refusal, { status: 403 }) : new Response(usdcOnly);
  };
  return { requests, fetchImpl };
}

describe("per-feed Hermes refusals", () => {
  it("reads the refused feed out of a 403 body", () => {
    const error = new HermesError(403, "https://hermes.pyth.network", NOT_ENTITLED);
    expect(error.rejectedFeeds()).toEqual([NVDA]);
    expect(new HermesError(401, "", "unauthorized").rejectedFeeds()).toEqual([]);
  });

  it("drops a refused feed and asks again for the rest in one update", async () => {
    const { requests, fetchImpl } = hermesStub((ids) => (ids.includes(NVDA) ? NOT_ENTITLED : null));
    const result = await fetchEntitledUpdate([USDC_FEED_ID, NVDA], { fetch: fetchImpl });
    expect(requests).toEqual([[USDC_FEED_ID, NVDA], [USDC_FEED_ID]]);
    expect(result.update?.response.parsed[0]?.id).toBe(USDC_FEED_ID);
    expect(result.rejected).toEqual([{ feedId: NVDA, status: 403, body: NOT_ENTITLED }]);
  });

  it("still fails on refusals it cannot attribute to a feed", async () => {
    const { fetchImpl } = hermesStub(() => "forbidden");
    await expect(fetchEntitledUpdate([USDC_FEED_ID], { fetch: fetchImpl })).rejects.toBeInstanceOf(
      HermesError,
    );
  });

  it("needs USDC/USD for every leg and the regular feed for listed equities", () => {
    const leg = (symbol: string) => ({ asset: assetBySymbol(symbol) }) as PendingLeg;
    expect(requiredFeeds(leg("NVDAx"))).toEqual([USDC_FEED_ID, NVDA]);
    expect(requiredFeeds(leg("Anthropic"))).toEqual([USDC_FEED_ID]);
  });

  it("parks every leg on PRICE_UNAVAILABLE when Hermes refuses every feed, sending nothing", async () => {
    const { fetchImpl } = hermesStub((ids) => `Not entitled: feed ${ids[0]} (no grant)`);
    const owner = address("hoyjKyffP55yKjj8aEGARUQi5xKC3bZTYv4j4ih3dBy");
    const legs: PendingLeg[] = ["NVDAx", "Anthropic"].map((symbol, legIndex) => ({
      router: owner,
      owner,
      authority: owner,
      paycheck: owner,
      seq: 0n,
      legIndex,
      asset: assetBySymbol(symbol),
      amountIn: 100_000_000n,
      bandBps: 50,
    }));
    const unreachable = new Proxy(
      {},
      {
        get() {
          throw new Error("no RPC call expected");
        },
      },
    ) as SolanaRpc;
    const run = await executePaycheckLegs(
      {
        rpc: unreachable,
        rpcUrl: "http://127.0.0.1:1",
        surfnet: true,
        crank: await generateKeyPairSigner(),
        attester: null,
        jupiter: {},
        hermes: { fetch: fetchImpl },
        protocolLookupTable: {},
        feeBps: 20,
      },
      legs,
      async () => {
        throw new Error("no execute instruction expected");
      },
      async () => null,
    );
    expect(run.posts).toEqual([]);
    expect(run.rejected.map((r) => r.feedId).sort()).toEqual(
      [NVDA, assetBySymbol("NVDAx").feedId247, USDC_FEED_ID].sort(),
    );
    for (const legRun of run.legs) {
      expect(legRun.attempts).toHaveLength(1);
      expect(legRun.attempts[0]?.waitReason).toBe(WaitReason.PRICE_UNAVAILABLE);
      expect(legRun.attempts[0]?.signature).toBeNull();
      expect(legRun.attempts[0]?.priceRejections.length).toBeGreaterThan(0);
    }
  });
});
