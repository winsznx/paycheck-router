import { describe, expect, it } from "vitest";
import { fetchLatestUpdate, fetchUpdateAt, HermesError, parsedPriceFor } from "../src/hermes.ts";

const NVDA = "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593";
const USDC = "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

const body = JSON.stringify({
  binary: { encoding: "base64", data: ["UE5BVQ=="] },
  parsed: [
    {
      id: NVDA,
      price: { price: "18012345", conf: "9000", expo: -5, publish_time: 1_790_000_000 },
      ema_price: { price: "18000000", conf: "9000", expo: -5, publish_time: 1_790_000_000 },
      metadata: { slot: 1, proof_available_time: 1_790_000_001, prev_publish_time: 1_789_999_999 },
    },
  ],
});

function capture() {
  const calls: { url: string; headers: HeadersInit | undefined }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), headers: init?.headers });
    return new Response(body);
  };
  return { calls, fetchImpl };
}

describe("Hermes client", () => {
  it("asks for one base64 update covering every feed, deduplicated", async () => {
    const { calls, fetchImpl } = capture();
    await fetchLatestUpdate([NVDA, `0x${NVDA}`, USDC], { fetch: fetchImpl, apiKey: "k" });
    expect(calls[0]?.url).toBe(
      `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${NVDA}&ids[]=${USDC}&encoding=base64&parsed=true`,
    );
  });

  it("sends the API key as a bearer token", async () => {
    const { calls, fetchImpl } = capture();
    await fetchLatestUpdate([NVDA], { fetch: fetchImpl, apiKey: "secret" });
    expect(calls[0]?.headers).toEqual({ authorization: "Bearer secret" });
  });

  it("reads history by publish time from the configured base URL", async () => {
    const { calls, fetchImpl } = capture();
    const update = await fetchUpdateAt(1_790_000_000, [NVDA], {
      fetch: fetchImpl,
      baseUrl: "https://pyth.dourolabs.app/hermes",
    });
    expect(
      calls[0]?.url.startsWith("https://pyth.dourolabs.app/hermes/v2/updates/price/1790000000?"),
    ).toBe(true);
    expect(parsedPriceFor(update.response, `0x${NVDA}`)?.price.price).toBe("18012345");
    expect(parsedPriceFor(update.response, USDC)).toBeUndefined();
  });

  it("surfaces the 401 Hermes returns without a key", async () => {
    const fetchImpl: typeof fetch = async () => new Response("unauthorized", { status: 401 });
    const error = await fetchLatestUpdate([NVDA], { fetch: fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HermesError);
    expect((error as HermesError).status).toBe(401);
  });
});
