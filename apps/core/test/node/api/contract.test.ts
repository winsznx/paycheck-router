import { api } from "@paycheck-router/shared";
import { describe, expect, it } from "vitest";

const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const ANTHROPIC = "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw";

describe("API contract", () => {
  const createBody = {
    wallet: "hoyjKyffP55yKjj8aEGARUQi5xKC3bZTYv4j4ih3dBy",
    investBps: 2000,
    legs: [
      { mint: SPYX, weightBps: 7000, bandBps: 50 },
      { mint: NVDAX, weightBps: 2000, bandBps: 50 },
      { mint: ANTHROPIC, weightBps: 1000, bandBps: 300 },
    ],
    minInflow: "20000000",
    dailyCap: "5000000000",
    maxWaitSecs: 259200,
    autoConvert: true,
    allowance: "1500000000",
  };

  it("accepts the create-router example and rejects bad splits", () => {
    expect(api.CreateRouterTxRequest.safeParse(createBody).success).toBe(true);
    const short = { ...createBody, legs: createBody.legs.slice(0, 2) };
    expect(api.CreateRouterTxRequest.safeParse(short).error?.issues[0]?.message).toBe(
      "leg weights must sum to 10000 bps",
    );
    const duplicate = {
      ...createBody,
      legs: [
        { mint: SPYX, weightBps: 5000, bandBps: 50 },
        { mint: SPYX, weightBps: 5000, bandBps: 50 },
      ],
    };
    expect(api.CreateRouterTxRequest.safeParse(duplicate).success).toBe(false);
  });

  it("parses the compact legs query of /quote/preview", () => {
    const parsed = api.QuotePreviewQuery.parse({
      amount: "1850000000",
      investBps: "2000",
      legs: `${SPYX}:7000:50,${NVDAX}:3000:50`,
    });
    expect(parsed.investBps).toBe(2000);
    expect(parsed.legs).toEqual([
      { mint: SPYX, weightBps: 7000, bandBps: 50 },
      { mint: NVDAX, weightBps: 3000, bandBps: 50 },
    ]);
    expect(
      api.QuotePreviewQuery.safeParse({ amount: "1", investBps: "2000", legs: "nope" }).success,
    ).toBe(false);
  });

  it("validates realtime envelopes by type", () => {
    const event = {
      type: "paycheck.detected",
      id: "01J8Z3N6Q7R8S9T0V1W2X3Y4Z5",
      ts: "2026-09-25T13:30:00.000Z",
      data: {
        routerId: "6b1f3c0e-1d2a-4c8e-9f51-0a7c2b9d4e11",
        routerPda: SPYX,
        amount: "1850000000",
        sender: null,
        signature: null,
        detectedAt: "2026-09-25T13:30:00.000Z",
      },
    };
    expect(api.ServerEvent.safeParse(event).success).toBe(true);
    expect(api.ServerEvent.safeParse({ ...event, data: { amount: 1 } }).success).toBe(false);
    expect(api.ClientMessage.parse({ type: "resume", lastEventId: null })).toEqual({
      type: "resume",
      lastEventId: null,
    });
  });
});
