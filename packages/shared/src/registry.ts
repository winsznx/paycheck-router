import { type Address, address } from "@solana/kit";
import { DEFAULT_BANDS, HARD_CAPS } from "./caps.ts";
import { TOKEN_2022_PROGRAM_ID, USDC_MINT } from "./program.ts";

/** Onchain `Asset.kind`. */
export const AssetKind = { listedEquity: 0, preIpo: 1 } as const;
export type AssetKind = (typeof AssetKind)[keyof typeof AssetKind];

/** Onchain `Asset.issuer`. */
export const Issuer = { xStocks: 0, preStocks: 1, other: 2 } as const;
export type Issuer = (typeof Issuer)[keyof typeof Issuer];

/** Onchain `Asset.status`. */
export const AssetStatus = { active: 0, buysPaused: 1, converting: 2, delisted: 3 } as const;
export type AssetStatus = (typeof AssetStatus)[keyof typeof AssetStatus];

/** 32-byte Pyth feed id as lowercase hex without a 0x prefix. */
export type FeedId = string;

export type RegistryAsset = {
  symbol: string;
  name: string;
  mint: Address;
  tokenProgram: Address;
  decimals: number;
  kind: AssetKind;
  issuer: Issuer;
  status: AssetStatus;
  feedId: FeedId | null;
  feedId247: FeedId | null;
  defaultBandBps: number;
  maxBandBps: number;
  band247ExtraBps: number;
};

type XStockSeed = [
  symbol: string,
  name: string,
  mint: string,
  feed: string,
  feed247: string | null,
];

const XSTOCK_SEEDS: readonly XStockSeed[] = [
  [
    "SPYx",
    "SP500 xStock",
    "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
    null,
  ],
  [
    "QQQx",
    "Nasdaq xStock",
    "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    "9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d",
    null,
  ],
  [
    "NVDAx",
    "NVIDIA xStock",
    "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
    "a470c4ac46f44b547b2cba52338f311fb642b79375ce5f0cfd5cb5b99227b852",
  ],
  [
    "AAPLx",
    "Apple xStock",
    "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
    "aaba35e6f33fb973bb2201d48a79ae24795affa6ba8bd50a93dcaf7da0030f36",
  ],
  [
    "TSLAx",
    "Tesla xStock",
    "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
    "e6da44bff5b8b06897a3739dd331b440d6662595bb862e37046892c568ae3fc0",
  ],
  [
    "MSFTx",
    "Microsoft xStock",
    "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX",
    "d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1",
    "d9144b30a3a162a2748d384dc53387571f3ec77b9edfe31739349396ed67a63a",
  ],
  [
    "GOOGLx",
    "Alphabet xStock",
    "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    "5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6",
    "ad519718d387de4f0d7d29ea16a3730ce42e49c59fef6fba6fc9bac477645f6f",
  ],
  [
    "AMZNx",
    "Amazon xStock",
    "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg",
    "b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a",
    "329635cf9e705e01ed2d842fafbb6c426d7e5630e75847740d89957222fd68b8",
  ],
  [
    "METAx",
    "Meta xStock",
    "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    "78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe",
    "2cc0c022f7f37920485a5947f3cea8633783b6cb7fff6d94ee52f48687b7783d",
  ],
];

type PreStockSeed = [symbol: string, name: string, mint: string, status: AssetStatus];

const PRESTOCK_SEEDS: readonly PreStockSeed[] = [
  ["OpenAI", "OpenAI PreStocks", "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", AssetStatus.active],
  [
    "Anthropic",
    "Anthropic PreStocks",
    "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
    AssetStatus.active,
  ],
  [
    "Anduril",
    "Anduril PreStocks",
    "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB",
    AssetStatus.active,
  ],
  [
    "FigureAI",
    "Figure AI PreStocks",
    "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd",
    AssetStatus.active,
  ],
  ["Kalshi", "Kalshi PreStocks", "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua", AssetStatus.active],
  [
    "Polymarket",
    "Polymarket PreStocks",
    "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP",
    AssetStatus.active,
  ],
  [
    "Neuralink",
    "Neuralink PreStocks",
    "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S",
    AssetStatus.active,
  ],
  [
    "SpaceX",
    "SpaceX PreStocks",
    "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh",
    AssetStatus.converting,
  ],
];

/** Every xStock in the launch registry is Token-2022 with 8 decimals. */
export const XSTOCK_DECIMALS = 8;
/** PreStocks mints read from mainnet on Sep 25, 2026: Token-2022 with 9 decimals. */
export const PRESTOCK_DECIMALS = 9;

export const XSTOCKS: readonly RegistryAsset[] = XSTOCK_SEEDS.map(
  ([symbol, name, mint, feedId, feedId247]) => ({
    symbol,
    name,
    mint: address(mint),
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    decimals: XSTOCK_DECIMALS,
    kind: AssetKind.listedEquity,
    issuer: Issuer.xStocks,
    status: AssetStatus.active,
    feedId,
    feedId247,
    defaultBandBps: DEFAULT_BANDS.listedEquityBps,
    // The program caps the widest band, max band plus the 24/7 extra, at the equity cap.
    maxBandBps: HARD_CAPS.maxBandEquityBps - DEFAULT_BANDS.band247ExtraBps,
    band247ExtraBps: DEFAULT_BANDS.band247ExtraBps,
  }),
);

export const PRESTOCKS: readonly RegistryAsset[] = PRESTOCK_SEEDS.map(
  ([symbol, name, mint, status]) => ({
    symbol,
    name,
    mint: address(mint),
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    decimals: PRESTOCK_DECIMALS,
    kind: AssetKind.preIpo,
    issuer: Issuer.preStocks,
    status,
    feedId: null,
    feedId247: null,
    defaultBandBps: DEFAULT_BANDS.preIpoBps,
    maxBandBps: HARD_CAPS.maxBandPreIpoBps,
    band247ExtraBps: 0,
  }),
);

export const REGISTRY: readonly RegistryAsset[] = [...XSTOCKS, ...PRESTOCKS];

export const USDC_FEED_ID: FeedId =
  "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

export const USDC = { mint: USDC_MINT, feedId: USDC_FEED_ID } as const;

/** Pyth 24/7 feeds used only to monitor pre-IPO marks and conversions, never as a guard. */
export const PRE_IPO_MONITOR_FEEDS: Readonly<Record<string, FeedId>> = {
  OpenAI: "96d4bb23a3db78fdb72b3a03ce80ead686096f324319166534d9a27c0519c483",
  Anthropic: "5da511a7c68b17a3bc94380cab4756bc83ab87f86307af10ea58467a64b6689d",
  SpaceX: "2dbfb1791e75725227a90dbd23c6bdd83b80cc9d13011973c948b6aeacdf17b9",
};

const byMint = new Map<string, RegistryAsset>(REGISTRY.map((asset) => [asset.mint, asset]));
const bySymbol = new Map<string, RegistryAsset>(REGISTRY.map((asset) => [asset.symbol, asset]));

export function assetByMint(mint: Address | string): RegistryAsset | undefined {
  return byMint.get(mint);
}

export function assetBySymbol(symbol: string): RegistryAsset {
  const asset = bySymbol.get(symbol);
  if (!asset) throw new Error(`unknown registry symbol ${symbol}`);
  return asset;
}
