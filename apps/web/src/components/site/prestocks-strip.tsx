import { DEFAULT_BANDS } from "@paycheck-router/shared";
import { AssetTicker, Banner, PriceCheckBadge, Table } from "@paycheck-router/ui/components";
import { formatPremiumBps, formatPrice, formatTimestamp } from "@paycheck-router/ui/format";
import { getLocale, getTranslations } from "next-intl/server";
import type { PreStocksQuote, PreStocksSnapshot } from "@/lib/prestocks.ts";

/** Live PreStocks marks against token prices; slices over the band would wait (PRD 7.2). */
export async function PreStocksStrip({ snapshot }: { snapshot: PreStocksSnapshot | null }) {
  const t = await getTranslations("site.prestocks");
  const locale = await getLocale();
  if (!snapshot) return <Banner tone="warn">{t("unavailable")}</Banner>;
  const band = DEFAULT_BANDS.preIpoBps;
  return (
    <div className="stack">
      <Table
        caption={t("caption")}
        columns={[
          {
            key: "name",
            header: t("name"),
            cell: (q: PreStocksQuote) => (
              <AssetTicker asset={q.mint} ticker={q.name} className="" />
            ),
          },
          {
            key: "mark",
            header: t("mark"),
            numeric: true,
            cell: (q: PreStocksQuote) => formatPrice(q.markPrice, locale),
          },
          {
            key: "token",
            header: t("token"),
            numeric: true,
            cell: (q: PreStocksQuote) => formatPrice(q.tokenPrice, locale),
          },
          {
            key: "premium",
            header: t("premium"),
            numeric: true,
            cell: (q: PreStocksQuote) => (
              <PriceCheckBadge
                tone={q.premiumBps <= band ? "in-band" : "out-of-band"}
                text={t(q.premiumBps <= band ? "wouldBuy" : "wouldWait", {
                  premium: formatPremiumBps(q.premiumBps, locale),
                })}
              />
            ),
          },
        ]}
        rows={snapshot.quotes}
        rowKey={(q) => q.mint}
      />
      <p className="pr-small pr-muted">
        {t("source", { time: formatTimestamp(snapshot.fetchedAt, locale, "UTC") })}
      </p>
    </div>
  );
}
