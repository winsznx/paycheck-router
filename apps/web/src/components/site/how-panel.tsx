import { AssetIcon, SplitBar, StatusChip, splitBarLabel } from "@paycheck-router/ui/components";
import {
  formatPercent,
  formatPremiumBps,
  formatTimestamp,
  formatUsd,
} from "@paycheck-router/ui/format";
import { isSeriesSlot } from "@paycheck-router/ui/tokens";
import { getLocale, getTranslations } from "next-intl/server";
import type { CanonicalPaycheck, CanonicalSlice } from "@/lib/canonical.ts";
import { isPreIpo, usdc } from "@/lib/money.ts";

/** What one How-it-works step looked like in the recorded run. */
export async function HowPanel({
  step,
  paycheck,
}: {
  step: "point" | "pick" | "watch";
  paycheck: CanonicalPaycheck;
}) {
  const [t, tp, ts, locale] = await Promise.all([
    getTranslations("landing.how"),
    getTranslations("app.paycheck"),
    getTranslations("app.slice"),
    getLocale(),
  ]);
  const money = (raw: bigint | string) => formatUsd(usdc(raw), locale);
  const total = paycheck.slices.reduce((sum, s) => sum + BigInt(s.amountIn), 0n);

  if (step === "point") {
    return (
      <div className="how-panel">
        <p className="how-panel__label">{t("pointLabel")}</p>
        <p className="how-panel__figure">{money(paycheck.inflow)}</p>
        <p className="pr-body">
          {t("point", {
            payer: tp("forkEmployer"),
            time: formatTimestamp(paycheck.recordedAt, locale, "UTC"),
          })}
        </p>
      </div>
    );
  }

  if (step === "pick") {
    const segments = paycheck.slices.map((slice, index) => {
      const slot = index + 1;
      return {
        key: slice.mint,
        asset: slice.mint,
        ticker: slice.symbol,
        weightBps: Number(slice.amountIn),
        colorSlot: isSeriesSlot(slot) ? slot : 1,
        state: "planned" as const,
        valueText: formatPercent((Number(slice.amountIn) / Number(total || 1n)) * 10_000, locale),
      };
    });
    return (
      <div className="how-panel">
        <p className="how-panel__label">{t("pickLabel")}</p>
        <p className="how-panel__figure">{money(total)}</p>
        <SplitBar segments={segments} label={splitBarLabel(segments)} />
        <p className="pr-body">{t("pick", { count: paycheck.slices.length })}</p>
      </div>
    );
  }

  const why = (slice: CanonicalSlice): string | null => {
    const reference = isPreIpo(slice.mint) ? "mark" : "pyth";
    if (slice.status === "waiting") {
      return ts(`reasonShort.${slice.waitReason ?? "LANDING"}`, {
        premium:
          slice.premiumBps === null
            ? ""
            : formatPremiumBps(Math.abs(slice.premiumBps), locale).replace("+", ""),
        reference,
      });
    }
    return slice.premiumBps === null
      ? null
      : t("fill", { premium: formatPremiumBps(slice.premiumBps, locale), reference });
  };
  const waited = paycheck.slices.filter((s) => s.status === "waiting").length;
  return (
    <div className="how-panel">
      <p className="how-panel__label">{t("watchLabel")}</p>
      <ul className="how-panel__slices">
        {paycheck.slices.map((slice) => (
          <li key={slice.mint}>
            <AssetIcon asset={slice.mint} size="md" decorative />
            <span translate="no" className="how-panel__ticker">
              {slice.symbol}
            </span>
            <StatusChip status={slice.status} label={ts(`status.${slice.status}`)} />
            <span className="pr-small pr-muted how-panel__why">{why(slice)}</span>
          </li>
        ))}
      </ul>
      <p className="pr-small pr-muted">
        {t("watch", { bought: paycheck.slices.length - waited, waited })}
      </p>
    </div>
  );
}
