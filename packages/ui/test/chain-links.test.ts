import { describe, expect, it } from "vitest";
import { type ChainEnv, type ChainMode, chainLinks, pythFeedUrl } from "../src/chain/links.ts";

/** Real values from the recorded fork run (evidence/stocklana-fork/manifest.json). */
const SIGNATURE =
  "5qYWdx9GYynbLttsZRWJtfxE4GHS8i2CzdEnYXQJQorvyzxe6DnsoD6UPoXc4aqygjemjRAJoFB1bA94h2LkKZTC";
const ROUTER = "5ByR6txmiXKiTfHxDMbxw1QBkwq89L8QucyKH1xbVv2e";
const ANTHROPIC_MINT = "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw";
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const PROGRAM = "PayEFo1ZAPXKf5H4DoqrsEceYzdSvXJBAGBD7AMQY6H";
const SPY_FEED = "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5";
const SURFNET = "http://127.0.0.1:8899";
const REPO = "https://github.com/winsznx/paycheck-router";

const env = (mode: ChainMode): ChainEnv => ({
  mode,
  surfnetRpcUrl: SURFNET,
  repoUrl: REPO,
  evidencePath: "evidence/stocklana-fork",
});

const customCluster = `cluster=custom&customUrl=${encodeURIComponent(SURFNET)}`;

describe("chainLinks", () => {
  it("links a fork signature to Explorer on the surfnet in a live fork run", () => {
    expect(chainLinks("tx", SIGNATURE, env("fork-live"))).toEqual([
      {
        href: `https://explorer.solana.com/tx/${SIGNATURE}?${customCluster}`,
        role: "explorer",
        external: true,
      },
    ]);
  });

  it("links a recorded fork signature to its proof page and recorded JSON, never mainnet", () => {
    const links = chainLinks("tx", SIGNATURE, env("fork-recorded"));
    expect(links).toEqual([
      { href: `/proof/${SIGNATURE}`, role: "proof", external: false },
      {
        href: `${REPO}/blob/main/evidence/stocklana-fork/raw/tx/${SIGNATURE}.json`,
        role: "recorded",
        external: true,
      },
    ]);
    expect(links.some((link) => link.href.includes("explorer.solana.com"))).toBe(false);
  });

  it("links a mainnet signature to mainnet Explorer", () => {
    expect(chainLinks("tx", SIGNATURE, env("mainnet"))[0]?.href).toBe(
      `https://explorer.solana.com/tx/${SIGNATURE}`,
    );
  });

  it("links fork accounts to the surfnet live and to the recorded manifest after", () => {
    expect(chainLinks("account", ROUTER, env("fork-live"))[0]?.href).toBe(
      `https://explorer.solana.com/address/${ROUTER}?${customCluster}`,
    );
    expect(chainLinks("account", ROUTER, env("fork-recorded"))).toEqual([
      {
        href: `${REPO}/blob/main/evidence/stocklana-fork/manifest.json`,
        role: "recorded",
        external: true,
      },
    ]);
    expect(chainLinks("account", ROUTER, env("mainnet"))[0]?.href).toBe(
      `https://explorer.solana.com/address/${ROUTER}`,
    );
  });

  it("always links real mainnet mints and programs to mainnet Explorer", () => {
    for (const mode of ["fork-live", "fork-recorded", "mainnet"] as const) {
      expect(chainLinks("mint", ANTHROPIC_MINT, env(mode))[0]?.href).toBe(
        `https://explorer.solana.com/address/${ANTHROPIC_MINT}`,
      );
      expect(chainLinks("program", JUPITER, env(mode))[0]?.href).toBe(
        `https://explorer.solana.com/address/${JUPITER}`,
      );
    }
  });

  it("links our program to its verifiable build until the mainnet deploy", () => {
    expect(chainLinks("own-program", PROGRAM, env("fork-live"))[0]?.href).toBe(`${REPO}/releases`);
    expect(chainLinks("own-program", PROGRAM, env("fork-recorded"))[0]?.href).toBe(
      `${REPO}/releases`,
    );
    expect(chainLinks("own-program", PROGRAM, env("mainnet"))[0]?.href).toBe(
      `https://explorer.solana.com/address/${PROGRAM}`,
    );
  });

  it("links a feed id to Pyth Insights when its symbol is known, else copy only", () => {
    expect(chainLinks("feed", SPY_FEED, env("fork-live"), "Equity.US.SPY/USD")).toEqual([
      { href: pythFeedUrl("Equity.US.SPY/USD"), role: "pyth", external: true },
    ]);
    expect(pythFeedUrl("Equity.US.SPY/USD")).toBe(
      "https://insights.pyth.network/price-feeds/Equity.US.SPY%2FUSD",
    );
    expect(chainLinks("feed", SPY_FEED, env("fork-live"), null)).toEqual([]);
  });
});
