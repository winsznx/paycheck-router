import type { api } from "@paycheck-router/shared";
import { PriceCheckBadge, SplitBar, splitBarLabel } from "@paycheck-router/ui/components";
import {
  formatPercent,
  formatPremiumBps,
  formatTimestamp,
  formatUsd,
} from "@paycheck-router/ui/format";
import { isSeriesSlot } from "@paycheck-router/ui/tokens";
import { getLocale, getTranslations } from "next-intl/server";
import { isPreIpo, usdc } from "@/lib/money.ts";

/** The canonical paycheck from the proof run, split by asset with its price checks. */
export async function CanonicalRun({ proof }: { proof: api.ProofResponse }) {
  const t = await getTranslations("site.canonical");
  const locale = await getLocale();
  const first = proof.recentLegs[0];
  if (!first) return null;
  const legs = proof.recentLegs.filter(
    (leg) => leg.paycheck.recordedSig === first.paycheck.recordedSig,
  );
  const total = legs.reduce((sum, leg) => sum + Number(leg.amountIn), 0) || 1;
  const segments = legs.map((leg, index) => {
    const slot = index + 1;
    return {
      key: leg.signature,
      ticker: leg.symbol,
      weightBps: Number(leg.amountIn),
      colorSlot: isSeriesSlot(slot) ? slot : 1,
      state: "filled" as const,
      valueText: formatPercent((Number(leg.amountIn) / total) * 10_000, locale),
    };
  });
  return (
    <figure className="pr-card stack canonical-run">
      <figcaption className="stack">
        <p className="pr-label pr-muted">
          {proof.fork ? t("forkLabel") : t("mainnetLabel")} ·{" "}
          {formatTimestamp(first.paycheck.recordedAt, locale, "UTC")}
        </p>
        <p className="pr-h3">
          {t("line", {
            amount: formatUsd(usdc(first.paycheck.inflow), locale),
            invested: formatUsd(usdc(first.paycheck.investTotal), locale),
          })}
        </p>
      </figcaption>
      <SplitBar segments={segments} label={splitBarLabel(segments)} />
      <ul className="stack">
        {legs.map((leg) => (
          <li key={leg.signature} className="row">
            <span className="pr-num" translate="no">
              {leg.symbol}
            </span>
            {leg.premiumBps === null ? null : (
              <PriceCheckBadge
                tone="in-band"
                text={t("check", {
                  premium: formatPremiumBps(leg.premiumBps, locale),
                  reference: isPreIpo(leg.mint) ? "mark" : "pyth",
                })}
              />
            )}
            {leg.verification?.matches ? (
              <span className="pr-small pr-muted">{t("verified")}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </figure>
  );
}
