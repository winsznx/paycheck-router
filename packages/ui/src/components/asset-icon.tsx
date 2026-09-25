import manifest from "../icons/manifest.json";

export type AssetIconSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_PX: Record<AssetIconSize, number> = { xs: 16, sm: 20, md: 24, lg: 32, xl: 48 };

export type AssetIconEntry = (typeof manifest.icons)[keyof typeof manifest.icons];

const BY_MINT: Readonly<Record<string, AssetIconEntry>> = manifest.icons;
const BY_SYMBOL = new Map(
  Object.values(BY_MINT).map((entry) => [entry.symbol.toLowerCase(), entry] as const),
);

/** The pinned logo for a mint or registry symbol (`pnpm icons:sync`). */
export function assetIconFor(mintOrSymbol: string): AssetIconEntry | undefined {
  return BY_MINT[mintOrSymbol] ?? BY_SYMBOL.get(mintOrSymbol.toLowerCase());
}

export type AssetIconProps = {
  /** Mint, or registry symbol where the mint isn't at hand. */
  asset: string;
  size?: AssetIconSize | undefined;
  /** Set when the asset's ticker or name is already beside the icon, so it isn't read twice. */
  decorative?: boolean | undefined;
  /** Above-the-fold icons load eagerly. */
  eager?: boolean | undefined;
};

/**
 * The issuer's logo, served from this site with its provenance in the icon manifest. Every
 * registry asset and USDC has one, which a test enforces, so there is no letter fallback.
 */
export function AssetIcon({ asset, size = "sm", decorative, eager }: AssetIconProps) {
  const entry = assetIconFor(asset);
  if (!entry) return null;
  const px = SIZE_PX[size];
  return (
    <img
      className="pr-asset-icon"
      src={entry.localPath}
      width={px}
      height={px}
      alt={decorative ? "" : entry.name}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
    />
  );
}

/** Overlapping logos for a set of assets, e.g. a preset; the caller names the set in text. */
export function AssetIconStack({
  assets,
  size = "xs",
}: {
  assets: readonly string[];
  size?: AssetIconSize | undefined;
}) {
  return (
    <span className="pr-asset-stack" aria-hidden="true">
      {assets.map((asset) => (
        <AssetIcon key={asset} asset={asset} size={size} decorative />
      ))}
    </span>
  );
}

export type AssetTickerProps = {
  asset: string;
  ticker: string;
  size?: AssetIconSize | undefined;
  /** Type class for the ticker text. */
  className?: string | undefined;
  eager?: boolean | undefined;
};

/** Logo and ticker, the way an asset is named anywhere outside a chip. */
export function AssetTicker({
  asset,
  ticker,
  size = "sm",
  className = "pr-num",
  eager,
}: AssetTickerProps) {
  return (
    <span className="pr-asset-ticker">
      <AssetIcon asset={asset} size={size} decorative eager={eager} />
      <span translate="no" className={className}>
        {ticker}
      </span>
    </span>
  );
}
