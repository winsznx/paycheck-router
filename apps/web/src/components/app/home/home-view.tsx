"use client";

import type { api } from "@paycheck-router/shared";
import {
  AddressField,
  AllowanceMeter,
  AssetChip,
  Banner,
  buttonClassName,
  EmptyState,
  QrCode,
  Skeleton,
  StatusChip,
  splitBarLabel,
} from "@paycheck-router/ui/components";
import {
  formatPercent,
  formatShares,
  formatTime,
  formatTimestamp,
  formatUsd,
  formatUsdWhole,
} from "@paycheck-router/ui/format";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { fetchers, keys } from "@/lib/data.ts";
import { explorerUrl } from "@/lib/env.ts";
import { usdc, usdcNumber, walletShares } from "@/lib/money.ts";
import { colorSlotFor, toSegments } from "@/lib/paycheck-view.ts";
import { useQuery } from "@/lib/query.ts";
import { useLegCopy } from "@/lib/use-leg-copy.ts";
import { PaycheckCardLink } from "../paycheck/paycheck-card-link.tsx";
import { routerHealth } from "../router-status.tsx";

const SplitSequence = dynamic(
  () => import("../split-sequence.tsx").then((mod) => mod.SplitSequence),
  {
    loading: () => <Skeleton height={88} />,
  },
);

const JUST_LANDED_MS = 2 * 60 * 1000;

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

function RouterCard({ router, lastInflow }: { router: api.Router; lastInflow: string | null }) {
  const t = useTranslations("app.home");
  const locale = useLocale();
  const health = routerHealth(router);
  const allowance = usdcNumber(router.allowance.amount);
  const perPaycheck = lastInflow ? (usdcNumber(lastInflow) * router.investBps) / 10_000 : 0;
  const capacity = Math.max(allowance, perPaycheck * 3, 1);
  const meterState =
    health === "attention"
      ? "revoked"
      : perPaycheck > 0 && allowance < perPaycheck
        ? "low"
        : "healthy";
  return (
    <section className="pr-card stack" aria-labelledby="router-title">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="router-title" className="pr-h3">
          {t("router")}
        </h2>
        <StatusChip
          status={health === "live" ? "verified" : "waiting"}
          label={t(`health.${health}`)}
        />
      </div>
      <p className="pr-body">
        {t("investShare", { percent: formatPercent(router.investBps, locale) })}
      </p>
      <ul className="row" aria-label={t("split")}>
        {router.legs
          .filter((leg) => leg.enabled)
          .map((leg) => (
            <li key={leg.mint}>
              <AssetChip
                ticker={leg.symbol}
                colorSlot={colorSlotFor(leg.mint, leg.idx, router.legs)}
                name={formatPercent(leg.weightBps, locale)}
              />
            </li>
          ))}
      </ul>
      <AllowanceMeter
        remaining={allowance}
        perPaycheck={perPaycheck}
        capacity={capacity}
        state={meterState}
        label={t("allowance")}
        valueText={t("allowanceValue", { amount: formatUsd(allowance, locale) })}
        caption={t("allowanceLeft", { amount: formatUsd(allowance, locale) })}
        captionEnd={
          perPaycheck > 0
            ? t("allowancePaychecks", { count: Math.floor(allowance / perPaycheck) })
            : undefined
        }
      />
      {lastInflow ? (
        <p className="pr-small">
          {t("nextPreview", {
            amount: formatUsdWhole(usdc(lastInflow), locale),
            invested: formatUsdWhole(perPaycheck, locale),
          })}
        </p>
      ) : null}
    </section>
  );
}

function Holdings({ portfolio }: { portfolio: api.PortfolioResponse }) {
  const t = useTranslations("app.home");
  const locale = useLocale();
  const top = [...portfolio.holdings]
    .sort((a, b) => Number(b.valueUsdc ?? 0) - Number(a.valueUsdc ?? 0))
    .slice(0, 5);
  return (
    <section className="pr-card stack" aria-labelledby="holdings-title">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="holdings-title" className="pr-h3">
          {t("holdings")}
        </h2>
        <Link href="/app/portfolio">{t("seeAll")}</Link>
      </div>
      {top.length === 0 ? (
        <p className="pr-body pr-muted">{t("noHoldings")}</p>
      ) : (
        <ul className="holding-list">
          {top.map((holding, index) => (
            <li key={holding.mint} className="holding-row">
              <AssetChip
                ticker={holding.symbol}
                colorSlot={colorSlotFor(holding.mint, index, undefined)}
              />
              <span className="pr-num">
                {formatShares(
                  walletShares(holding, holding.amountRaw, holding.decimals) ?? "0",
                  locale,
                )}
              </span>
              <span className="pr-num">
                {holding.valueUsdc ? formatUsd(usdc(holding.valueUsdc), locale) : "—"}
              </span>
              <span className="pr-small pr-muted">
                {t("weightVsTarget", {
                  actual:
                    holding.actualWeightBps === null
                      ? "—"
                      : formatPercent(holding.actualWeightBps, locale),
                  target: formatPercent(holding.targetWeightBps, locale),
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Activity({ paychecks }: { paychecks: readonly api.PaycheckSummary[] }) {
  const t = useTranslations("app.home");
  const locale = useLocale();
  const copy = useLegCopy();
  const events = paychecks
    .flatMap((p) =>
      p.legs.map((leg) => ({
        leg,
        paycheckId: p.id,
        at: leg.verifiedAt ?? leg.executedAt ?? p.recordedAt,
      })),
    )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 5);
  if (events.length === 0) return null;
  return (
    <section className="pr-card stack" aria-labelledby="activity-title">
      <h2 id="activity-title" className="pr-h3">
        {t("activity")}
      </h2>
      <ul className="activity-list">
        {events.map(({ leg, paycheckId, at }) => (
          <li key={`${leg.id}-${leg.status}`}>
            <Link href={`/app/paychecks/${paycheckId}`} className="activity-row">
              <StatusChip
                status={leg.status}
                label={copy.statusLabel(leg)}
                description={copy.statusDescription(leg)}
              />
              <span className="pr-small">
                {leg.status === "waiting"
                  ? copy.reasonSentence(leg)
                  : (copy.bought(leg) ?? leg.symbol)}
              </span>
              <time className="pr-small pr-muted" dateTime={at} title={formatTimestamp(at, locale)}>
                {formatTime(at, locale)}
              </time>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HomeView() {
  const t = useTranslations("app.home");
  const locale = useLocale();
  const online = useOnline();
  const routers = useQuery(keys.routers, fetchers.routers);
  const paychecks = useQuery(keys.paychecks, fetchers.paychecks);
  const portfolio = useQuery(keys.portfolio, fetchers.portfolio);

  if (routers.status === "loading") {
    return (
      <div className="home-grid" aria-busy="true">
        <Skeleton height={112} />
        <Skeleton height={240} />
        <Skeleton height={180} />
      </div>
    );
  }
  if (!routers.data) {
    return (
      <Banner tone="danger" live="alert">
        {t("loadError")}
      </Banner>
    );
  }

  const router = routers.data.routers.find((r) => r.status !== "closed");
  if (!router) {
    return (
      <section className="pr-card stack home-hero" aria-labelledby="setup-title">
        <h1 id="setup-title" className="pr-h1">
          {t("noRouterTitle")}
        </h1>
        <p className="pr-body-l pr-muted">{t("noRouterBody")}</p>
        <p>
          <Link href="/app/onboarding/eligibility" className={buttonClassName({ size: "l" })}>
            {t("setUp")}
          </Link>
        </p>
      </section>
    );
  }

  const health = routerHealth(router);
  const list = paychecks.data?.paychecks ?? [];
  const latest = list[0];
  const updatedAt =
    portfolio.status === "success" || portfolio.status === "error"
      ? portfolio.updatedAt
      : undefined;
  const value = portfolio.data?.totals.valueUsdc;

  return (
    <div className="home-grid">
      {!online && updatedAt ? (
        <Banner tone="info" live="status" className="home-grid__wide">
          {t("offline", { time: formatTime(new Date(updatedAt), locale) })}
        </Banner>
      ) : null}
      {health === "paused" ? (
        <Banner tone="warn" className="home-grid__wide">
          {t("pausedBanner")}
        </Banner>
      ) : null}
      {health === "attention" ? (
        <Banner tone="warn" className="home-grid__wide">
          {t("revokedBanner")}
        </Banner>
      ) : null}

      <section className="home-value" aria-labelledby="value-title">
        <h1 id="value-title" className="pr-label pr-muted">
          {t("portfolioValue")}
        </h1>
        <p className="pr-num-xl">
          {value ? formatUsd(usdc(value), locale) : portfolio.status === "loading" ? "…" : "—"}
        </p>
        {portfolio.data ? (
          <p className="pr-small pr-muted">
            {t("invested", { amount: formatUsd(usdc(portfolio.data.totals.investedUsdc), locale) })}
          </p>
        ) : null}
      </section>

      <RouterCard router={router} lastInflow={latest?.inflow ?? null} />

      <section className="stack home-latest" aria-labelledby="latest-title">
        <h2 id="latest-title" className="pr-h3">
          {t("latestPaycheck")}
        </h2>
        {latest ? (
          <LatestPaycheck paycheck={latest} routerLegs={router.legs} investBps={router.investBps} />
        ) : (
          <div className="pr-card stack">
            <EmptyState>{t("sendTest")}</EmptyState>
            <AddressField
              address={router.owner}
              label={t("payInAddress")}
              copyLabel={t("copy")}
              copiedLabel={t("copied")}
              explorerHref={explorerUrl("address", router.owner)}
              explorerLabel={t("explorer")}
            />
            <QrCode value={router.owner} label={t("payInQr")} />
          </div>
        )}
      </section>

      {portfolio.data ? <Holdings portfolio={portfolio.data} /> : null}
      <Activity paychecks={list} />
    </div>
  );
}

function LatestPaycheck({
  paycheck,
  routerLegs,
  investBps,
}: {
  paycheck: api.PaycheckSummary;
  routerLegs: readonly api.RouterLeg[];
  investBps: number;
}) {
  const t = useTranslations("app.paycheck");
  const locale = useLocale();
  const copy = useLegCopy();
  const justLanded = Date.now() - Date.parse(paycheck.recordedAt) < JUST_LANDED_MS;
  if (!justLanded) return <PaycheckCardLink paycheck={paycheck} routerLegs={routerLegs} />;
  const total = Number(paycheck.investTotal) || 1;
  const segments = toSegments(
    paycheck.legs,
    routerLegs,
    (leg) => formatPercent((Number(leg.amountIn) / total) * 10_000, locale),
    (leg) => (leg.status === "waiting" ? copy.statusLabel(leg) : undefined),
  );
  return (
    <Link href={`/app/paychecks/${paycheck.id}`} className="pr-card pr-card--interactive stack">
      <SplitSequence
        inflowText={`${formatUsd(usdc(paycheck.inflow), locale)} USDC`}
        investedText={t("invested", { amount: formatUsd(usdc(paycheck.investTotal), locale) })}
        investBps={investBps}
        segments={segments}
        label={splitBarLabel(segments)}
      />
      <p className="pr-small">
        {t("arrived", {
          amount: formatUsdWhole(usdc(paycheck.inflow), locale),
          invested: formatUsdWhole(usdc(paycheck.investTotal), locale),
        })}
      </p>
    </Link>
  );
}
