import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGISTRY, USDC_MINT } from "@paycheck-router/shared";
import { AssetIcon, AssetTicker, assetIconFor } from "@paycheck-router/ui/components";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OG_ICONS } from "@/lib/og-icons.generated.ts";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const SHIPPED = [
  ...REGISTRY.map((asset) => ({ mint: asset.mint, symbol: asset.symbol })),
  { mint: USDC_MINT, symbol: "USDC" },
];

describe("asset icons", () => {
  it.each(SHIPPED)(
    "$symbol has a pinned logo whose bytes match the manifest",
    ({ mint, symbol }) => {
      const entry = assetIconFor(mint);
      expect(entry, `${symbol} has no icon; run pnpm icons:sync`).toBeDefined();
      if (!entry) return;
      expect(entry.symbol).toBe(symbol);
      expect(entry.sourceUrl).toMatch(/^https:\/\//);
      const bytes = readFileSync(path.join(publicDir, entry.localPath));
      expect(bytes.length).toBe(entry.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    },
  );

  it("finds a logo by symbol where the mint isn't at hand", () => {
    expect(assetIconFor("anthropic")?.symbol).toBe("Anthropic");
  });

  it("names the asset unless the ticker is beside it", () => {
    const spyx = REGISTRY.find((asset) => asset.symbol === "SPYx");
    if (!spyx) throw new Error("SPYx is missing from the registry");
    const alone = renderToStaticMarkup(createElement(AssetIcon, { asset: spyx.mint, size: "lg" }));
    expect(alone).toContain('alt="SP500 xStock"');
    expect(alone).toContain('width="32"');
    expect(alone).toContain('height="32"');
    expect(alone).toContain('loading="lazy"');
    expect(alone).toContain('src="/assets/icons/xstocks/spyx.png"');

    const labelled = renderToStaticMarkup(
      createElement(AssetTicker, { asset: spyx.mint, ticker: "SPYx" }),
    );
    expect(labelled).toContain('alt=""');
    expect(labelled).toContain(">SPYx</span>");
  });

  it("renders nothing for a mint outside the registry rather than a placeholder", () => {
    expect(renderToStaticMarkup(createElement(AssetIcon, { asset: "not-a-mint" }))).toBe("");
  });
});

describe("share-card logos", () => {
  it.each(SHIPPED)("$symbol is bundled for /api/og from its pinned logo", ({ mint, symbol }) => {
    // #given the logo the site serves, and the copy bundled into the OG route
    const pinned = assetIconFor(mint);
    const bundled = OG_ICONS[mint];
    // #then the bundled copy was made from exactly that file; rerun pnpm icons:og if not
    expect(bundled?.symbol).toBe(symbol);
    expect(bundled?.sourceSha256).toBe(pinned?.sha256);
    expect(bundled?.dataUri).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
  });
});
