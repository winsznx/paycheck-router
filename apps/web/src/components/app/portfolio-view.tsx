"use client";

import type { api } from "@paycheck-router/shared";
import { AssetChip, Banner, EmptyState, Skeleton, Table } from "@paycheck-router/ui/components";
import { formatPercent, formatShares, formatTime, formatUsd } from "@paycheck-router/ui/format";
import { useLocale, useTranslations } from "next-intl";
import { fetchers, keys } from "@/lib/data.ts";
import { usdc, walletShares } from "@/lib/money.ts";
import { colorSlotFor } from "@/lib/paycheck-view.ts";
import { useQuery } from "@/lib/query.ts";

/** Signed P&L in USDC base units, with a true minus from the formatter. */
function pnl(raw: string | null, locale: string): string {
  if (raw === null) return "—";
  const negative = raw.startsWith("-");
  const text = formatUsd(usdc(negative ? raw.slice(1) : raw), locale);
  return negative ? `−${text}` : `+${text}`;
}

export function PortfolioView() {
  const t = useTranslations("app.portfolio");
  const locale = useLocale();
  const portfolio = useQuery(keys.portfolio, fetchers.portfolio);
  const routers = useQuery(keys.routers, fetchers.routers);
  const routerLegs = routers.data?.routers[0]?.legs;

  if (portfolio.status === "loading") {
    return (
      <div className="stack" aria-busy="true">
        <Skeleton height={96} />
        <Skeleton height={220} />
      </div>
    );
  }
  if (!portfolio.data) {
    return (
      <Banner tone="danger" live="alert">
        {t("loadError")}
      </Banner>
    );
  }
  const { holdings, totals, asOf } = portfolio.data;
  const columns = [
    {
      key: "asset",
      header: t("asset"),
      cell: (h: api.Holding) => (
        <AssetChip
          asset={h.mint}
          ticker={h.symbol}
          colorSlot={colorSlotFor(h.mint, holdings.indexOf(h), routerLegs)}
        />
      ),
    },
    {
      key: "shares",
      header: t("shares"),
      numeric: true,
      cell: (h: api.Holding) =>
        formatShares(walletShares(h, h.amountRaw, h.decimals) ?? "0", locale),
    },
    {
      key: "value",
      header: t("value"),
      numeric: true,
      cell: (h: api.Holding) => (h.valueUsdc ? formatUsd(usdc(h.valueUsdc), locale) : "—"),
    },
    {
      key: "cost",
      header: t("costBasis"),
      numeric: true,
      cell: (h: api.Holding) => formatUsd(usdc(h.costBasisUsdc), locale),
    },
    {
      key: "pnl",
      header: t("pnl"),
      numeric: true,
      cell: (h: api.Holding) => pnl(h.pnlUsdc, locale),
    },
    {
      key: "weight",
      header: t("weight"),
      numeric: true,
      cell: (h: api.Holding) =>
        `${h.actualWeightBps === null ? "—" : formatPercent(h.actualWeightBps, locale)} / ${formatPercent(h.targetWeightBps, locale)}`,
    },
  ];

  return (
    <div className="stack-lg">
      <section className="stack" aria-labelledby="portfolio-title">
        <h1 id="portfolio-title" className="pr-h1">
          {t("title")}
        </h1>
        <p className="pr-num-xl">
          {totals.valueUsdc ? formatUsd(usdc(totals.valueUsdc), locale) : "—"}
        </p>
        <dl className="totals">
          <div>
            <dt className="pr-small pr-muted">{t("invested")}</dt>
            <dd className="pr-num">{formatUsd(usdc(totals.investedUsdc), locale)}</dd>
          </div>
          <div>
            <dt className="pr-small pr-muted">{t("pnl")}</dt>
            <dd className="pr-num">{pnl(totals.pnlUsdc, locale)}</dd>
          </div>
          <div>
            <dt className="pr-small pr-muted">{t("fees")}</dt>
            <dd className="pr-num">{formatUsd(usdc(totals.feesUsdc), locale)}</dd>
          </div>
        </dl>
        <p className="pr-small pr-muted">{t("asOf", { time: formatTime(asOf, locale) })}</p>
      </section>
      {holdings.length === 0 ? (
        <EmptyState>{t("empty")}</EmptyState>
      ) : (
        <>
          <div className="portfolio-table">
            <Table caption={t("title")} columns={columns} rows={holdings} rowKey={(h) => h.mint} />
          </div>
          <ul className="portfolio-cards card-list">
            {holdings.map((h, index) => (
              <li key={h.mint} className="pr-card stack">
                <AssetChip
                  asset={h.mint}
                  ticker={h.symbol}
                  colorSlot={colorSlotFor(h.mint, index, routerLegs)}
                />
                <dl className="totals">
                  {columns.slice(1).map((column) => (
                    <div key={column.key}>
                      <dt className="pr-small pr-muted">{column.header}</dt>
                      <dd className="pr-num">{column.cell(h)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
