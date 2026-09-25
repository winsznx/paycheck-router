"use client";

import type { api } from "@paycheck-router/shared";
import { formatPercent, formatTime, formatUsd } from "@paycheck-router/ui/format";
import { Coins, Hourglass, type LucideIcon, ReceiptText, Split } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { InvestPoint } from "@/lib/invest-history.ts";
import { usdc } from "@/lib/money.ts";

function Tile({
  icon: Icon,
  label,
  value,
  note,
  trend,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note: string;
  trend?: ReactNode;
}) {
  return (
    <li className="kpi">
      <span className="kpi__icon" aria-hidden="true">
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <span className="kpi__label">{label}</span>
      <span className="kpi__value">{value}</span>
      <span className="kpi__note">{note}</span>
      {trend}
    </li>
  );
}

/** The running total as a small step line, the latest paycheck's step in the accent. */
function Sparkline({ points }: { points: readonly InvestPoint[] }) {
  if (points.length < 2) return null;
  const values = points.map((p) => Number(usdc(p.total)));
  const max = Math.max(...values, 1);
  const w = 96;
  const h = 24;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - 2 - (v / max) * (h - 4);
  const path = values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
  const last = values.length - 1;
  return (
    <svg className="kpi__spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={path} />
      <circle cx={x(last)} cy={y(values[last] ?? 0)} r={3} />
    </svg>
  );
}

/** Four figures that answer "what has my money done", each with where it came from. */
export function KpiTiles({
  points,
  router,
  waitingSlices,
}: {
  points: readonly InvestPoint[];
  router: api.Router;
  waitingSlices: number;
}) {
  const t = useTranslations("app.home.kpi");
  const locale = useLocale();
  const latest = points[points.length - 1];
  const total = latest?.total ?? 0n;
  const open = points.reduce((sum, p) => sum + p.open, 0n);
  const assets = router.legs.filter((leg) => leg.enabled).length;
  return (
    <ul className="kpi-row home-grid__wide">
      <Tile
        icon={Coins}
        label={t("investedLabel")}
        value={formatUsd(usdc(total), locale)}
        note={
          latest && latest.bought > 0n
            ? t("investedDelta", {
                amount: formatUsd(usdc(latest.bought), locale),
                n: latest.number,
              })
            : t("investedNone")
        }
        trend={<Sparkline points={points} />}
      />
      <Tile
        icon={Hourglass}
        label={t("waitingLabel")}
        value={formatUsd(usdc(open), locale)}
        note={waitingSlices > 0 ? t("waitingDelta", { count: waitingSlices }) : t("waitingNone")}
      />
      <Tile
        icon={ReceiptText}
        label={t("paychecksLabel")}
        value={String(points.length)}
        note={
          latest
            ? t("paychecksDelta", { time: formatTime(latest.recordedAt, locale) })
            : t("paychecksNone")
        }
      />
      <Tile
        icon={Split}
        label={t("shareLabel")}
        value={formatPercent(router.investBps, locale)}
        note={t("shareDelta", { count: assets })}
      />
    </ul>
  );
}
