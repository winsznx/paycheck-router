"use client";

import { formatTimestamp, formatUsd, formatUsdWhole } from "@paycheck-router/ui/format";
import { useLocale, useTranslations } from "next-intl";
import { type PointerEvent, useEffect, useId, useRef, useState } from "react";
import type { InvestPoint } from "@/lib/invest-history.ts";
import { usdc } from "@/lib/money.ts";

const HEIGHT = 220;
const PAD = { top: 20, right: 64, bottom: 30, left: 56 };

/** A 1-2-5 step that gives three or four gridlines up to at least `max`. */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 3;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let value = 0; value < max + step; value += step) ticks.push(value);
  return ticks;
}

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * USDC turned into shares, paycheck by paycheck: a step area in the accent, since the total only
 * moves when a paycheck's slices buy. The note under it shows the latest paycheck, or the one under
 * the pointer; every figure is also in a table for screen readers.
 */
export function InvestedChart({ points }: { points: readonly InvestPoint[] }) {
  const t = useTranslations("app.home.chart");
  const locale = useLocale();
  const [frame, width] = useWidth<HTMLDivElement>(640);
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();

  const values = points.map((p) => Number(usdc(p.total)));
  const ticks = niceTicks(Math.max(...values, 0));
  const top = ticks[ticks.length - 1] ?? 1;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = plotW / Math.max(points.length, 1);
  /** Each paycheck steps the total up in the middle of its own band. */
  const x = (i: number) => PAD.left + (i + 0.5) * band;
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const right = PAD.left + plotW;

  let line = `M ${PAD.left} ${y(0)}`;
  values.forEach((value, index) => {
    const previous = index === 0 ? 0 : (values[index - 1] ?? 0);
    line += ` L ${x(index)} ${y(previous)} L ${x(index)} ${y(value)}`;
  });
  line += ` L ${right} ${y(values[values.length - 1] ?? 0)}`;
  const area = `${line} L ${right} ${y(0)} L ${PAD.left} ${y(0)} Z`;
  const last = values[values.length - 1] ?? 0;
  const shown = active ?? points.length - 1;
  const point = points[shown];

  function pick(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    const index = Math.floor((px - PAD.left) / band);
    setActive(Math.min(points.length - 1, Math.max(0, index)));
  }

  return (
    <figure className="invest-chart">
      <div ref={frame} className="invest-chart__frame">
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={t("summary", { total: formatUsd(last, locale), count: points.length })}
          aria-describedby={tableId}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((tick) => (
            <g key={tick} className="invest-chart__grid">
              <line x1={PAD.left} x2={right} y1={y(tick)} y2={y(tick)} />
              <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                {formatUsdWhole(tick, locale)}
              </text>
            </g>
          ))}
          {points.map((p, index) => (
            <text
              key={p.id}
              className="invest-chart__x"
              x={x(index)}
              y={HEIGHT - 8}
              textAnchor="middle"
            >
              {p.number}
            </text>
          ))}
          <path className="invest-chart__area" d={area} />
          <path className="invest-chart__line" d={line} />
          {point ? (
            <>
              <line
                className="invest-chart__cross"
                x1={x(shown)}
                x2={x(shown)}
                y1={PAD.top}
                y2={PAD.top + plotH}
              />
              <circle
                className="invest-chart__dot"
                cx={x(shown)}
                cy={y(values[shown] ?? 0)}
                r={5}
              />
            </>
          ) : null}
          <text className="invest-chart__end" x={right + 8} y={y(last)} dy="0.32em">
            {formatUsdWhole(last, locale)}
          </text>
        </svg>
        {point ? (
          <p className="invest-chart__tip" aria-hidden="true">
            <span className="invest-chart__tip-title">
              {t("tooltip", { n: point.number })} ·{" "}
              {formatTimestamp(point.recordedAt, locale, "UTC")}
            </span>
            <span>{t("bought", { amount: formatUsd(usdc(point.bought), locale) })}</span>
            <span>{t("total", { amount: formatUsd(usdc(point.total), locale) })}</span>
            {point.open > 0n ? (
              <span className="pr-muted">
                {t("open", { amount: formatUsd(usdc(point.open), locale) })}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
      <div id={tableId} className="pr-sr-only">
        <table>
          <caption>{t("tableCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("colPaycheck")}</th>
              <th scope="col">{t("colDate")}</th>
              <th scope="col">{t("colBought")}</th>
              <th scope="col">{t("colTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.id}>
                <th scope="row">{p.number}</th>
                <td>{formatTimestamp(p.recordedAt, locale, "UTC")}</td>
                <td>{formatUsd(usdc(p.bought), locale)}</td>
                <td>{formatUsd(usdc(p.total), locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
