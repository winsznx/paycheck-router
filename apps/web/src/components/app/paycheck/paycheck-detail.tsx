"use client";

import type { api } from "@paycheck-router/shared";
import {
  Banner,
  Skeleton,
  SplitBar,
  StatusChip,
  splitBarLabel,
} from "@paycheck-router/ui/components";
import { formatPercent, formatTime, formatTimestamp, formatUsd } from "@paycheck-router/ui/format";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ChainValue } from "@/components/chain-value.tsx";
import { fetchers, keys } from "@/lib/data.ts";
import { usdc } from "@/lib/money.ts";
import {
  bandFor,
  buyNowAvailableAt,
  colorSlotFor,
  isForkEmployer,
  paycheckPhase,
  toSegments,
} from "@/lib/paycheck-view.ts";
import { useQuery } from "@/lib/query.ts";
import { useLegCopy } from "@/lib/use-leg-copy.ts";
import { SliceItem } from "./slice-item.tsx";

const PHASE_CHIP = {
  recording: "pending",
  executing: "executing",
  waiting: "waiting",
  complete: "verified",
  expired: "expired",
} as const;

/** Ticks once a minute so "Buy now" unlocks and relative times stay honest. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function PaycheckDetailView({ id }: { id: string }) {
  const t = useTranslations("app.paycheck");
  const locale = useLocale();
  const copy = useLegCopy();
  const now = useMinuteClock();
  const detail = useQuery(keys.paycheck(id), () => fetchers.paycheck(id));
  const routers = useQuery(keys.routers, fetchers.routers);

  if (detail.status === "loading") {
    return (
      <div className="stack" aria-busy="true">
        <Skeleton height={72} />
        <Skeleton height={60} />
        <Skeleton height={140} />
        <Skeleton height={140} />
      </div>
    );
  }
  if (!detail.data) {
    return (
      <Banner tone="danger" live="alert">
        {t("loadError")}
      </Banner>
    );
  }

  const paycheck = detail.data;
  const routerLegs = routers.data?.routers.find((r) => r.id === paycheck.routerId)?.legs;
  const phase = paycheckPhase(paycheck.legs);
  const payer = isForkEmployer(paycheck.sender)
    ? t("forkEmployer")
    : paycheck.sender
      ? t("payer")
      : t("unknownPayer");
  const total = Number(paycheck.investTotal) || 1;
  const segments = toSegments(
    paycheck.legs,
    routerLegs,
    (leg) => formatPercent((Number(leg.amountIn) / total) * 10_000, locale),
    (leg) => (leg.status === "waiting" ? copy.statusLabel(leg) : undefined),
  );
  const legs = [...paycheck.legs].sort((a, b) => a.idx - b.idx);
  const done = legs.filter((l) => ["executed", "verified", "unverified"].includes(l.status)).length;
  const waiting = legs.filter((l) => l.status === "waiting").length;
  const unverified = legs.some((l) => l.status === "unverified");

  return (
    <article className="stack-lg paycheck-detail">
      <header className="stack" style={{ viewTransitionName: `paycheck-${paycheck.id}` }}>
        <p className="pr-label pr-muted">{t("label", { seq: paycheck.seq })}</p>
        <h1 className="pr-h2 paycheck-detail__title">
          <span>{t("from", { amount: formatUsd(usdc(paycheck.inflow), locale), payer })}</span>{" "}
          <span className="paycheck-detail__arrow" aria-hidden="true">
            →
          </span>
          <span className="pr-sr-only">, </span>
          <span className="paycheck-detail__invested">
            {t("invested", { amount: formatUsd(usdc(paycheck.investTotal), locale) })}
          </span>
        </h1>
        <div className="row">
          <StatusChip
            status={unverified ? "unverified" : PHASE_CHIP[phase]}
            label={t(`phase.${unverified ? "unverified" : phase}`)}
          />
          <time
            className="pr-small pr-muted"
            dateTime={paycheck.recordedAt}
            title={formatTimestamp(paycheck.recordedAt, locale)}
          >
            {formatTime(paycheck.recordedAt, locale)}
          </time>
        </div>
      </header>

      {unverified ? (
        <Banner tone="danger" action={<a href="/help">{t("support")}</a>}>
          {t("unverifiedBanner")}
        </Banner>
      ) : null}

      <SplitBar
        segments={segments}
        label={splitBarLabel(segments)}
        total={formatUsd(usdc(paycheck.investTotal), locale)}
        totalCaption={t("progress", { done, total: legs.length, waiting })}
      />

      <p className="pr-sr-only" aria-live="polite">
        {t("progress", { done, total: legs.length, waiting })}
      </p>

      <section aria-labelledby="slices-title" className="stack">
        <h2 id="slices-title" className="pr-h3">
          {t("slices")}
        </h2>
        <ul className="pr-slices">
          {legs.map((leg, index) => (
            <SliceItem
              key={leg.id}
              leg={leg}
              colorSlot={colorSlotFor(leg.mint, index, routerLegs)}
              bandBps={bandFor(leg.mint, routerLegs)}
              buyNowAt={buyNowAvailableAt(leg, paycheck.recordedAt)}
              now={now}
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby="chain-title" className="stack">
        <h2 id="chain-title" className="pr-h3">
          {t("onchain")}
        </h2>
        <dl className="proof-list">
          {paycheck.inflowSig ? (
            <div>
              <dt className="pr-small pr-muted">{t("inflowTx")}</dt>
              <dd className="proof-list__value">
                <ChainValue kind="tx" value={paycheck.inflowSig} name={t("inflowTx")} />
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="pr-small pr-muted">{t("recordTx")}</dt>
            <dd className="proof-list__value">
              <ChainValue kind="tx" value={paycheck.recordedSig} name={t("recordTx")} />
            </dd>
          </div>
          {paycheck.sender ? (
            <div>
              <dt className="pr-small pr-muted">{t("payerAddress")}</dt>
              <dd className="proof-list__value">
                <ChainValue kind="account" value={paycheck.sender} name={t("payerAddress")} />
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="pr-small pr-muted">{t("paycheckAccount")}</dt>
            <dd className="proof-list__value">
              <ChainValue kind="account" value={paycheck.paycheckPda} name={t("paycheckAccount")} />
            </dd>
          </div>
        </dl>
      </section>
    </article>
  );
}

export type { api };
