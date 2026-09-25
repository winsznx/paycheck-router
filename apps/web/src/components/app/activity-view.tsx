"use client";

import type { api } from "@paycheck-router/shared";
import { Banner, EmptyState, Skeleton, StatusChip } from "@paycheck-router/ui/components";
import { formatTime, formatTimestamp } from "@paycheck-router/ui/format";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { fetchers, keys } from "@/lib/data.ts";
import { useQuery } from "@/lib/query.ts";
import { useLegCopy } from "@/lib/use-leg-copy.ts";

const FILTERS = ["all", "bought", "waiting", "ended"] as const;
type Filter = (typeof FILTERS)[number];

const MATCH: Record<Filter, (status: api.LegStatus) => boolean> = {
  all: () => true,
  bought: (s) => s === "executed" || s === "verified" || s === "unverified",
  waiting: (s) => s === "waiting" || s === "pending" || s === "executing",
  ended: (s) => s === "expired" || s === "cancelled",
};

/** PRD 13.1 `/app/activity`: every slice's latest state across paychecks, filterable. */
export function ActivityView() {
  const t = useTranslations("app.activity");
  const locale = useLocale();
  const copy = useLegCopy();
  const paychecks = useQuery(keys.paychecks, fetchers.paychecks);
  const [filter, setFilter] = useState<Filter>("all");

  if (paychecks.status === "loading") return <Skeleton height={240} />;
  if (!paychecks.data) {
    return (
      <Banner tone="danger" live="alert">
        {t("loadError")}
      </Banner>
    );
  }
  const events = paychecks.data.paychecks
    .flatMap((p) =>
      p.legs.map((leg) => ({
        leg,
        paycheckId: p.id,
        at: leg.verifiedAt ?? leg.executedAt ?? p.recordedAt,
      })),
    )
    .filter(({ leg }) => MATCH[filter](leg.status))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return (
    <div className="stack-lg">
      <h1 className="pr-h1">{t("title")}</h1>
      <fieldset className="stack">
        <legend className="pr-sr-only">{t("filter")}</legend>
        <div className="segmented segmented--4">
          {FILTERS.map((value) => (
            <label key={value} className="segmented__option">
              <input
                type="radio"
                name="activity-filter"
                value={value}
                checked={filter === value}
                onChange={() => setFilter(value)}
              />
              <span>{t(`filters.${value}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {events.length === 0 ? (
        <EmptyState>{t("empty")}</EmptyState>
      ) : (
        <ul className="activity-list pr-card">
          {events.map(({ leg, paycheckId, at }) => (
            <li key={leg.id}>
              <Link href={`/app/paychecks/${paycheckId}`} className="activity-row">
                <StatusChip
                  status={leg.status}
                  label={copy.statusLabel(leg)}
                  description={copy.statusDescription(leg)}
                />
                <span className="pr-body">
                  {leg.status === "waiting" || leg.status === "expired"
                    ? copy.reasonSentence(leg)
                    : (copy.bought(leg) ?? leg.symbol)}
                </span>
                <time
                  className="pr-small pr-muted"
                  dateTime={at}
                  title={formatTimestamp(at, locale)}
                >
                  {formatTime(at, locale)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
