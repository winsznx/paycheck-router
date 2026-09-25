import type { CSSProperties } from "react";
import { type SeriesSlot, seriesVar } from "../tokens/series.ts";
import { AssetIcon } from "./asset-icon.tsx";
import { PreIpoBadge } from "./price-check-badge.tsx";

export type AssetChipProps = {
  /** Mint, or registry symbol, for the logo. */
  asset: string;
  ticker: string;
  colorSlot: SeriesSlot;
  name?: string | undefined;
  preIpoLabel?: string | undefined;
  selected?: boolean | undefined;
  /** When set, shows the market-closed dot with this text for screen readers. */
  marketClosedLabel?: string | undefined;
};

export function AssetChip({
  asset,
  ticker,
  colorSlot,
  name,
  preIpoLabel,
  selected,
  marketClosedLabel,
}: AssetChipProps) {
  return (
    <span
      className="pr-asset-chip"
      data-selected={selected || undefined}
      style={{ "--swatch": seriesVar(colorSlot) } as CSSProperties}
    >
      <span className="pr-asset-chip__swatch" aria-hidden="true" />
      <AssetIcon asset={asset} size="sm" decorative />
      <span translate="no">{ticker}</span>
      {name ? <span className="pr-asset-chip__name">{name}</span> : null}
      {preIpoLabel ? <PreIpoBadge label={preIpoLabel} /> : null}
      {marketClosedLabel ? (
        <>
          <span className="pr-asset-chip__closed" aria-hidden="true" />
          <span className="pr-sr-only">{marketClosedLabel}</span>
        </>
      ) : null}
    </span>
  );
}
