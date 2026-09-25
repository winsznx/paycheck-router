"use client";

import { AmountInput, Slider, SplitBar, splitBarLabel } from "@paycheck-router/ui/components";
import { formatPercent, formatPrice, formatShares, formatUsd } from "@paycheck-router/ui/format";
import { isSeriesSlot } from "@paycheck-router/ui/tokens";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { DraftLeg } from "@/lib/presets.ts";

export type CalculatorAsset = { mint: string; symbol: string; price: number | null };

const FEE_BPS = 20;
/** F-05 previews a $2,000 paycheck until the reader types their own. */
const DEFAULT_PAYCHECK = "2000";

/** PRD 18.1 §3: paycheck amount, invest %, preset, live reference prices, the resulting split. */
export function Calculator({
  assets,
  presets,
}: {
  assets: readonly CalculatorAsset[];
  presets: Readonly<Record<string, readonly DraftLeg[]>>;
}) {
  const t = useTranslations("site.calculator");
  const locale = useLocale();
  const [amount, setAmount] = useState(DEFAULT_PAYCHECK);
  const [investPercent, setInvestPercent] = useState(20);
  const [preset, setPreset] = useState("preIpoSpice");

  const paycheck = Number(amount.replace(",", "."));
  const valid = Number.isFinite(paycheck) && paycheck > 0;
  const invested = valid ? (paycheck * investPercent) / 100 : 0;
  const legs = presets[preset] ?? [];
  const rows = legs.map((leg, index) => {
    const slice = (invested * leg.weightBps) / 10_000;
    const price = assets.find((a) => a.mint === leg.mint)?.price ?? null;
    const net = slice * (1 - FEE_BPS / 10_000);
    return { ...leg, slice, price, shares: price ? net / price : null, slot: index + 1 };
  });
  const segments = rows.map((row) => ({
    key: row.mint,
    ticker: row.symbol,
    weightBps: row.weightBps,
    colorSlot: isSeriesSlot(row.slot) ? row.slot : 1,
    state: "planned" as const,
    valueText: formatUsd(row.slice, locale),
  }));

  return (
    <div className="calculator">
      <div className="stack">
        <AmountInput
          label={t("paycheck")}
          suffix="USDC"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          error={valid ? undefined : t("paycheckError")}
        />
        <Slider
          label={t("invest")}
          value={investPercent}
          min={1}
          max={100}
          onChange={setInvestPercent}
          format={(value) => formatPercent(value * 100, locale)}
          numberLabel={t("investNumber")}
        />
        <div className="pr-field">
          <label className="pr-field__label" htmlFor="calc-preset">
            {t("preset")}
          </label>
          <div className="pr-field__control">
            <select
              id="calc-preset"
              className="pr-field__input pr-select"
              value={preset}
              onChange={(event) => setPreset(event.target.value)}
            >
              {Object.keys(presets).map((name) => (
                <option key={name} value={name}>
                  {t(`presets.${name}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className="stack" aria-live="polite">
        <SplitBar
          segments={segments}
          label={splitBarLabel(segments)}
          total={formatUsd(invested, locale)}
          totalCaption={t("invested")}
        />
        <ul className="preview-list">
          {rows.map((row) => (
            <li key={row.mint} className="preview-row">
              <span className="pr-num" translate="no">
                {row.symbol}
              </span>
              <span className="pr-num">{formatUsd(row.slice, locale)}</span>
              <span className="pr-small pr-muted">
                {row.shares !== null && row.price !== null
                  ? t("shares", {
                      shares: formatShares(row.shares, locale),
                      asset: row.symbol,
                      price: formatPrice(row.price, locale),
                    })
                  : t("noPrice")}
              </span>
            </li>
          ))}
        </ul>
        <p className="pr-small pr-muted">{t("note")}</p>
      </div>
    </div>
  );
}
