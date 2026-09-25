import { describe, expect, it } from "vitest";
import {
  AssetKind,
  AssetStatus,
  assetByMint,
  assetBySymbol,
  FeedIdHex,
  HARD_CAPS,
  PRESTOCKS,
  PROGRAM_ERRORS,
  programErrorByCode,
  programErrorByName,
  REGISTRY,
  RETRY_SCHEDULES,
  RunManifest,
  retryDelaySecs,
  USDC_FEED_ID,
  WaitReason,
  XSTOCKS,
} from "../src/index.ts";

describe("registry", () => {
  it("lists nine xStocks and eight PreStocks with unique mints", () => {
    expect(XSTOCKS).toHaveLength(9);
    expect(PRESTOCKS).toHaveLength(8);
    expect(new Set(REGISTRY.map((a) => a.mint)).size).toBe(REGISTRY.length);
    expect(new Set(REGISTRY.map((a) => a.symbol)).size).toBe(REGISTRY.length);
  });

  it("gives every xStock a regular feed and a band inside the equity cap", () => {
    for (const asset of XSTOCKS) {
      expect(asset.kind).toBe(AssetKind.listedEquity);
      expect(FeedIdHex.safeParse(asset.feedId).success).toBe(true);
      if (asset.feedId247 !== null) expect(FeedIdHex.safeParse(asset.feedId247).success).toBe(true);
      expect(asset.decimals).toBe(8);
      expect(asset.defaultBandBps).toBeLessThanOrEqual(asset.maxBandBps);
      expect(asset.maxBandBps).toBeLessThanOrEqual(HARD_CAPS.maxBandEquityBps);
    }
  });

  it("leaves SPYx and QQQx without a 24/7 feed", () => {
    expect(assetBySymbol("SPYx").feedId247).toBeNull();
    expect(assetBySymbol("QQQx").feedId247).toBeNull();
    expect(assetBySymbol("NVDAx").feedId247).not.toBeNull();
  });

  it("prices PreStocks from attestations only, with SpaceX converting", () => {
    for (const asset of PRESTOCKS) {
      expect(asset.kind).toBe(AssetKind.preIpo);
      expect(asset.feedId).toBeNull();
      expect(asset.maxBandBps).toBeLessThanOrEqual(HARD_CAPS.maxBandPreIpoBps);
    }
    expect(assetBySymbol("SpaceX").status).toBe(AssetStatus.converting);
  });

  it("looks assets up by mint", () => {
    const nvda = assetBySymbol("NVDAx");
    expect(assetByMint(nvda.mint)).toBe(nvda);
    expect(assetByMint("11111111111111111111111111111111")).toBeUndefined();
    expect(() => assetBySymbol("NOPE")).toThrow();
  });

  it("carries the Crypto.USDC/USD feed", () => {
    expect(FeedIdHex.safeParse(USDC_FEED_ID).success).toBe(true);
  });
});

describe("program errors", () => {
  it("covers every code the program defines, 6000 to 6034, exactly once", () => {
    expect(PROGRAM_ERRORS.map((e) => e.code)).toEqual(
      Array.from({ length: 35 }, (_, i) => 6000 + i),
    );
  });

  it("maps every wait action to a reason the owner can see", () => {
    for (const info of PROGRAM_ERRORS.filter((e) => e.action === "wait")) {
      expect(info.reason, info.name).not.toBeNull();
    }
  });

  it("looks errors up by code and name", () => {
    expect(programErrorByCode(6022)?.reason).toBe(WaitReason.PREMIUM_TOO_HIGH);
    expect(programErrorByCode(6012)?.reason).toBe(WaitReason.MARKET_CLOSED);
    expect(programErrorByName("DelegateMismatch")?.reason).toBe(WaitReason.ALLOWANCE_REVOKED);
    expect(programErrorByName("AttestationStale")?.action).toBe("resign");
    expect(programErrorByCode(7000)).toBeUndefined();
  });
});

describe("retry schedules", () => {
  it("defines a schedule for every reason", () => {
    for (const reason of Object.values(WaitReason)) {
      expect(RETRY_SCHEDULES[reason]).toBeDefined();
    }
  });

  it("backs off a premium wait 1, 2, 5, 10, 15, 30 minutes then every 30", () => {
    const delays = Array.from({ length: 8 }, (_, i) => retryDelaySecs("PREMIUM_TOO_HIGH", i));
    expect(delays).toEqual([60, 120, 300, 600, 900, 1800, 1800, 1800]);
  });

  it("retries landing five times immediately, then every minute", () => {
    const delays = Array.from({ length: 7 }, (_, i) => retryDelaySecs("LANDING", i));
    expect(delays).toEqual([0, 0, 0, 0, 0, 60, 60]);
  });

  it("defers session and terminal schedules to the caller", () => {
    expect(retryDelaySecs("MARKET_CLOSED", 0)).toBeNull();
    expect(retryDelaySecs("EXPIRED", 0)).toBeNull();
    expect(retryDelaySecs("ALLOWANCE_REVOKED", 3)).toBe(6 * 3600);
  });
});

describe("run manifest schema", () => {
  const minimal = {
    schemaVersion: 1,
    runId: "2026-09-25T13-30-00-000Z",
    environment: "fork",
    fork: {
      startSlot: 370000000,
      rpcUrl: "http://127.0.0.1:8899",
      datasource: "mainnet",
      surfpoolVersion: "1.5.0",
      clockDriftSecs: 0.4,
    },
    startedAt: "2026-09-25T13:30:00.000Z",
    finishedAt: null,
    commit: "12593c0",
    programId: "PayEFo1ZAPXKf5H4DoqrsEceYzdSvXJBAGBD7AMQY6H",
    programSha256: null,
    programExecutableHash: null,
    crankVersion: "0.1.0",
    rpc: { sender: "http://127.0.0.1:8899", verifier: "http://127.0.0.1:8899" },
    feedIds: [USDC_FEED_ID],
    keys: { crank: "7okuGKwRkoLvcGsu1wXHC3gqJQk41FZT9mo363Qsefwu" },
    router: null,
    paycheck: null,
    transactions: [],
    legs: [],
    artifacts: [],
    error: null,
  };

  it("accepts a run that stopped before any leg", () => {
    expect(RunManifest.parse(minimal).environment).toBe("fork");
  });

  it("rejects amounts that are not integer strings", () => {
    const bad = {
      ...minimal,
      paycheck: {
        address: "PayEFo1ZAPXKf5H4DoqrsEceYzdSvXJBAGBD7AMQY6H",
        seq: "0",
        inflow: "12.5",
        investTotal: "1",
        sender: null,
        inflowSignature: null,
        recordSignature: "1".repeat(64),
      },
    };
    expect(RunManifest.safeParse(bad).success).toBe(false);
  });
});
