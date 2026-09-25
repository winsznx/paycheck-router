import { AssetKind, api, REGISTRY, type RegistryAsset } from "@paycheck-router/shared";
import { Banner, PreIpoBadge, Table } from "@paycheck-router/ui/components";
import { formatPremiumBps, formatPrice, formatTimestamp } from "@paycheck-router/ui/format";
import type { Metadata } from "next";
import { pythPrice } from "@/components/site/asset-strip.tsx";
import { CONTENT_ID } from "@/components/skip-link.tsx";
import { Link } from "@/i18n/navigation.ts";
import { fetchPublic } from "@/lib/api/public.ts";
import { priceE9 } from "@/lib/money.ts";
import { fetchPreStocks } from "@/lib/prestocks.ts";
import { pageMetadata, pageTranslations } from "@/lib/site-page.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/assets">): Promise<Metadata> {
  return pageMetadata((await params).locale, "assets");
}

type Row = {
  asset: RegistryAsset;
  live: api.Asset | undefined;
  reference: number | null;
  onchain: number | null;
  premiumBps: number | null;
};

/** PRD 18.3: every registry asset with its live reference, onchain price and premium now. */
export default async function AssetsPage({ params }: PageProps<"/[locale]/assets">) {
  const { locale } = await params;
  const [t, assets, prestocks] = await Promise.all([
    pageTranslations(locale, "assets"),
    fetchPublic("/assets", api.AssetsResponse),
    fetchPreStocks(),
  ]);
  const rows: Row[] = REGISTRY.map((asset) => {
    const live = assets.ok ? assets.data.assets.find((a) => a.mint === asset.mint) : undefined;
    const quote = prestocks?.quotes.find((q) => q.mint === asset.mint);
    const preIpo = asset.kind === AssetKind.preIpo;
    return {
      asset,
      live,
      reference: preIpo
        ? (priceE9(live?.markPriceE9) ?? quote?.markPrice ?? null)
        : pythPrice(live?.reference ?? null),
      onchain: priceE9(live?.onchainPriceE9) ?? (preIpo ? (quote?.tokenPrice ?? null) : null),
      premiumBps: live?.premiumBps ?? (preIpo ? (quote?.premiumBps ?? null) : null),
    };
  });

  return (
    <main id={CONTENT_ID} className="page site-page stack-lg">
      <header className="stack reading">
        <h1 className="pr-h1">{t("title")}</h1>
        <p className="pr-body-l pr-muted">{t("lead")}</p>
      </header>
      {assets.ok ? null : <Banner tone="warn">{t("pricesUnavailable")}</Banner>}
      <Table
        caption={t("title")}
        columns={[
          {
            key: "ticker",
            header: t("columns.ticker"),
            cell: (row: Row) => (
              <span className="row">
                <Link href={`/assets/${row.asset.symbol}`} translate="no">
                  {row.asset.symbol}
                </Link>
                {row.asset.kind === AssetKind.preIpo ? <PreIpoBadge label={t("preIpo")} /> : null}
              </span>
            ),
          },
          { key: "name", header: t("columns.name"), cell: (row: Row) => row.asset.name },
          {
            key: "reference",
            header: t("columns.referenceSource"),
            cell: (row: Row) =>
              t(
                row.asset.kind === AssetKind.preIpo
                  ? "source.mark"
                  : row.asset.feedId247
                    ? "source.pyth247"
                    : "source.pyth",
              ),
          },
          {
            key: "market",
            header: t("columns.market"),
            cell: (row: Row) =>
              row.live
                ? t(`market.${row.live.market.state}`, {
                    next: row.live.market.nextOpen
                      ? formatTimestamp(row.live.market.nextOpen, locale, "America/New_York")
                      : "",
                  })
                : "—",
          },
          {
            key: "price",
            header: t("columns.referencePrice"),
            numeric: true,
            cell: (row: Row) =>
              row.reference === null ? t("priceUnavailable") : formatPrice(row.reference, locale),
          },
          {
            key: "onchain",
            header: t("columns.onchainPrice"),
            numeric: true,
            cell: (row: Row) => (row.onchain === null ? "—" : formatPrice(row.onchain, locale)),
          },
          {
            key: "premium",
            header: t("columns.premium"),
            numeric: true,
            cell: (row: Row) =>
              row.premiumBps === null ? "—" : formatPremiumBps(row.premiumBps, locale),
          },
        ]}
        rows={rows}
        rowKey={(row) => row.asset.mint}
      />
      <p className="pr-small pr-muted">{t("sources")}</p>
    </main>
  );
}
