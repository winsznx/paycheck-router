import {
  AssetKind,
  AssetStatus,
  Issuer,
  REGISTRY,
  type RegistryAsset,
} from "@paycheck-router/shared";

/** Registry metadata the market routes show; the program's registry is seeded from the same list. */
export type AssetMeta = {
  mint: string;
  symbol: string;
  name: string;
  kind: "listed_equity" | "pre_ipo";
  issuer: "xstocks" | "prestocks" | "other";
  decimals: number;
  tokenProgram: string;
  status: "active" | "buys_paused" | "converting" | "delisted";
  defaultBandBps: number;
  maxBandBps: number;
  feedId: string | null;
  feedId247: string | null;
};

const STATUS: Record<RegistryAsset["status"], AssetMeta["status"]> = {
  [AssetStatus.active]: "active",
  [AssetStatus.buysPaused]: "buys_paused",
  [AssetStatus.converting]: "converting",
  [AssetStatus.delisted]: "delisted",
};

const ISSUER: Record<RegistryAsset["issuer"], AssetMeta["issuer"]> = {
  [Issuer.xStocks]: "xstocks",
  [Issuer.preStocks]: "prestocks",
  [Issuer.other]: "other",
};

function meta(asset: RegistryAsset): AssetMeta {
  return {
    mint: asset.mint,
    symbol: asset.symbol,
    name: asset.name,
    kind: asset.kind === AssetKind.preIpo ? "pre_ipo" : "listed_equity",
    issuer: ISSUER[asset.issuer],
    decimals: asset.decimals,
    tokenProgram: asset.tokenProgram,
    status: STATUS[asset.status],
    defaultBandBps: asset.defaultBandBps,
    maxBandBps: asset.maxBandBps,
    feedId: asset.feedId,
    feedId247: asset.feedId247,
  };
}

/** The launch registry from `packages/shared`, in listing order; needs no database. */
export const REGISTRY_ASSETS: readonly AssetMeta[] = REGISTRY.map(meta);

export function registryAsset(mint: string): AssetMeta | undefined {
  return REGISTRY_ASSETS.find((asset) => asset.mint === mint);
}
