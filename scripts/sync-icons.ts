/**
 * Downloads the logo of every registry asset and USDC, pins it under apps/web/public/assets/icons
 * and records its provenance in packages/ui/src/icons/manifest.json. The app serves only these
 * committed files, never a third-party hotlink.
 *
 * Every logo is resolved by exact mint, never by ticker:
 *   xStocks   the issuer's public API, matched on the Solana deployment address
 *   PreStocks the issuer's public API, matched on `contract_address`
 *   USDC      Jupiter's token API for the USDC mint
 *
 * Fails when any shipped asset can't be resolved. There is no letter-badge fallback. An entry
 * marked PINNED in the manifest was verified by hand and is kept as is.
 *
 *   pnpm icons:sync
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Issuer, REGISTRY, USDC_MINT } from "@paycheck-router/shared";

const ROOT = resolve(import.meta.dirname, "..");
const PUBLIC_DIR = join(ROOT, "apps", "web", "public");
const MANIFEST_PATH = join(ROOT, "packages", "ui", "src", "icons", "manifest.json");

const XSTOCKS_ASSETS_URL = "https://api.xstocks.fi/api/v2/public/assets";
const PRESTOCKS_URL = "https://prestocks.com/api/prestocks";
const JUPITER_TOKEN_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIN_EDGE_PX = 64;

type SourceKind = "ISSUER" | "TOKEN_REGISTRY" | "PINNED";

type IconEntry = {
  symbol: string;
  name: string;
  sourceUrl: string;
  sourceKind: SourceKind;
  note?: string;
  retrievedAt: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  localPath: string;
};

type IconManifest = { icons: Record<string, IconEntry> };

type Shipped = { mint: string; symbol: string; name: string; dir: string };

type Resolved = { url: string; kind: SourceKind; note: string };

const SHIPPED: readonly Shipped[] = [
  ...REGISTRY.map((asset) => ({
    mint: asset.mint,
    symbol: asset.symbol,
    name: asset.name,
    dir: asset.issuer === Issuer.xStocks ? "xstocks" : "prestocks",
  })),
  { mint: USDC_MINT, symbol: "USDC", name: "USD Coin", dir: "tokens" },
];

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

type XStocksPage = {
  nodes: { symbol: string; logo: string; deployments: { network: string; address: string }[] }[];
  page: { hasNextPage: boolean };
};

/** Logo by Solana mint. The API pages at 100, so a first-page-only read misses most assets. */
async function xStocksLogos(): Promise<Map<string, string>> {
  const logos = new Map<string, string>();
  for (let page = 0; ; page++) {
    const body = (await getJson(`${XSTOCKS_ASSETS_URL}?page=${page}`)) as XStocksPage;
    for (const asset of body.nodes) {
      for (const deployment of asset.deployments) {
        if (deployment.network === "Solana" && asset.logo)
          logos.set(deployment.address, asset.logo);
      }
    }
    if (!body.page.hasNextPage) return logos;
  }
}

async function preStocksLogos(): Promise<Map<string, string>> {
  const body = (await getJson(PRESTOCKS_URL)) as { contract_address: string; image?: string }[];
  return new Map(
    body.flatMap((token) => (token.image ? [[token.contract_address, token.image] as const] : [])),
  );
}

async function jupiterLogo(mint: string): Promise<string | undefined> {
  const body = (await getJson(`${JUPITER_TOKEN_SEARCH_URL}?query=${mint}`)) as {
    id: string;
    icon?: string;
  }[];
  return body.find((token) => token.id === mint)?.icon;
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { headers: { accept: "image/png,image/*" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Width and height from the IHDR chunk; throws unless the bytes are a usable PNG. */
function pngSize(bytes: Buffer, url: string): { width: number; height: number } {
  if (bytes.length < 400 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`not a PNG (${bytes.length} bytes) from ${url}`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (Math.min(width, height) < MIN_EDGE_PX) {
    throw new Error(`${width}×${height} is under ${MIN_EDGE_PX}px from ${url}`);
  }
  return { width, height };
}

function readManifest(): IconManifest | null {
  if (!existsSync(MANIFEST_PATH)) return null;
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as IconManifest;
}

async function main(): Promise<void> {
  const prior = readManifest();
  const [xStocks, preStocks, usdc] = await Promise.all([
    xStocksLogos(),
    preStocksLogos(),
    jupiterLogo(USDC_MINT),
  ]);

  const resolveSource = (asset: Shipped): Resolved | undefined => {
    const [url, kind, note]: [string | undefined, SourceKind, string] =
      asset.dir === "xstocks"
        ? [xStocks.get(asset.mint), "ISSUER", "xStocks API, Solana deployment"]
        : asset.dir === "prestocks"
          ? [preStocks.get(asset.mint), "ISSUER", "PreStocks API, contract_address"]
          : [usdc, "TOKEN_REGISTRY", "Jupiter token API, exact mint"];
    return url ? { url, kind, note } : undefined;
  };

  const icons: Record<string, IconEntry> = {};
  const failures: string[] = [];

  for (const asset of SHIPPED) {
    const previous = prior?.icons[asset.mint];
    if (previous?.sourceKind === "PINNED") {
      icons[asset.mint] = previous;
      console.log(`  keep  ${asset.symbol.padEnd(11)} pinned: ${previous.note ?? ""}`);
      continue;
    }
    const source = resolveSource(asset);
    if (!source) {
      failures.push(`${asset.symbol} (${asset.mint}): the issuer publishes no logo for this mint`);
      continue;
    }
    try {
      const bytes = await download(source.url);
      const { width, height } = pngSize(bytes, source.url);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const localPath = `/assets/icons/${asset.dir}/${asset.symbol.toLowerCase()}.png`;
      const file = join(PUBLIC_DIR, localPath);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      icons[asset.mint] = {
        symbol: asset.symbol,
        name: asset.name,
        sourceUrl: source.url,
        sourceKind: source.kind,
        note: source.note,
        retrievedAt: previous?.sha256 === sha256 ? previous.retrievedAt : new Date().toISOString(),
        sha256,
        bytes: bytes.length,
        width,
        height,
        localPath,
      };
      console.log(
        `  ok    ${asset.symbol.padEnd(11)} ${String(bytes.length).padStart(7)} B  ${width}×${height}`,
      );
    } catch (error) {
      failures.push(`${asset.symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures.length > 0) {
    console.error("\nEvery shipped asset needs a real logo. Unresolved:");
    for (const failure of failures) console.error(`  ${failure}`);
    console.error(
      "\nThe manifest was not written. Pin a verified source by hand instead of a placeholder.",
    );
    process.exit(1);
  }

  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, `${JSON.stringify({ icons } satisfies IconManifest, null, 2)}\n`);
  console.log(
    `\n${Object.keys(icons).length}/${SHIPPED.length} icons pinned in packages/ui/src/icons/manifest.json`,
  );
}

await main();
