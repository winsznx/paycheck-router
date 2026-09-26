"use client";

import { SplitBar, splitBarLabel } from "@paycheck-router/ui/components";
import { formatPercent, formatUsd } from "@paycheck-router/ui/format";
import { isSeriesSlot } from "@paycheck-router/ui/tokens";
import { useLocale, useTranslations } from "next-intl";
import { usdc } from "@/lib/money.ts";
import { allowanceBaseUnits, type Draft, toBaseUnits } from "@/lib/onboarding.ts";

/** The plan as the router will run it: the split, what each paycheck sets aside and the limit. */
export function PlanSummary({ draft }: { draft: Draft }) {
  const t = useTranslations("onboarding.plan");
  const locale = useLocale();
  const legs = draft.legs.filter((leg) => leg.weightBps > 0);
  const paycheck = toBaseUnits(draft.typicalPaycheckUsdc);
  const perPaycheck = paycheck ? (BigInt(paycheck) * BigInt(draft.investBps)) / 10_000n : null;
  const allowance = allowanceBaseUnits(draft);
  const segments = legs.map((leg, index) => {
    const slot = index + 1;
    return {
      key: leg.mint,
      asset: leg.mint,
      ticker: leg.symbol,
      weightBps: leg.weightBps,
      colorSlot: isSeriesSlot(slot) ? slot : 1,
      state: "planned" as const,
      valueText: formatPercent(leg.weightBps, locale),
    };
  });
  return (
    <section className="plan-summary" aria-labelledby="plan-title">
      <h2 id="plan-title" className="pr-h3">
        {t("title")}
      </h2>
      {segments.length > 0 ? (
        <SplitBar segments={segments} label={splitBarLabel(segments)} />
      ) : null}
      <dl className="plan-summary__facts">
        <div>
          <dt>{t("share")}</dt>
          <dd>{formatPercent(draft.investBps, locale)}</dd>
        </div>
        {paycheck && perPaycheck !== null ? (
          <div>
            <dt>{t("perPaycheck", { amount: formatUsd(usdc(paycheck), locale) })}</dt>
            <dd>{formatUsd(usdc(perPaycheck), locale)}</dd>
          </div>
        ) : null}
        {allowance ? (
          <div>
            <dt>{t("limit")}</dt>
            <dd>{formatUsd(usdc(allowance), locale)}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
