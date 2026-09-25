import { api } from "@paycheck-router/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../src/app.ts";
import { createServices } from "../../../src/services/factory.ts";
import { testEnv } from "../helpers/app.ts";

const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const USDC_FEED = "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

/**
 * Upstream test doubles shaped like the real answers: Hermes serves USDC/USD and refuses equity
 * feeds with 403 as the current key does, PreStocks and Jupiter answer normally.
 */
function upstreams(input: RequestInfo | URL): Response {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "hermes.pyth.network") {
    const ids = url.searchParams.getAll("ids[]");
    if (ids.length === 1 && ids[0] === USDC_FEED) {
      return Response.json({
        parsed: [
          {
            id: USDC_FEED,
            price: { price: "99994461", conf: "21539", expo: -8, publish_time: 1_790_347_219 },
          },
        ],
      });
    }
    return new Response(`Not entitled: feed ${ids[0]}`, { status: 403 });
  }
  if (url.hostname === "prestocks.com") {
    return Response.json([
      { contract_address: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", markPrice: 1023.61 },
    ]);
  }
  if (url.hostname === "api.jup.ag") {
    return Response.json({ [NVDAX]: { usdPrice: 181.5 } });
  }
  return new Response("unexpected upstream", { status: 599 });
}

describe("public routes without a database", () => {
  // The public deployment: no HYPERDRIVE binding, prices from upstreams, proof from the bundle.
  const env = testEnv({ PYTH_API_KEY: "test-key", PROOF_SOURCE: "bundle" });
  const app = createApp(createServices);

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => upstreams(input)),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serves /assets from the registry with honest price errors", async () => {
    expect(env.HYPERDRIVE).toBeUndefined();
    const res = await app.request("/assets", {}, env);
    expect(res.status).toBe(200);
    const body = api.AssetsResponse.parse(await res.json());
    expect(body.assets).toHaveLength(17);
    const nvdax = body.assets.find((asset) => asset.symbol === "NVDAx");
    expect(nvdax).toMatchObject({ reference: null, referenceError: "not_entitled" });
    expect(nvdax?.onchainPriceE9).toBe("181500000000");
    const openai = body.assets.find((asset) => asset.symbol === "OpenAI");
    expect(openai).toMatchObject({ markPriceE9: "1023610000000", referenceError: null });
  });

  it("serves /assets/:mint with the series marked not configured", async () => {
    const res = await app.request(`/assets/${NVDAX}`, {}, env);
    expect(res.status).toBe(200);
    const detail = api.AssetDetail.parse(await res.json());
    expect(detail).toMatchObject({ symbol: "NVDAx", seriesError: "not_configured", series: [] });
  });

  it("serves /proof and answers 503 only where the database is needed", async () => {
    expect((await app.request("/proof", {}, env)).status).toBe(200);
    const waitlist = await app.request(
      "/waitlist",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.co", turnstileToken: "t" }),
      },
      env,
    );
    expect(waitlist.status).toBe(503);
    expect(api.Problem.parse(await waitlist.json()).code).toBe("not_configured");
  });
});
