import {
  AssetIcon,
  PriceCheckBadge,
  SplitBar,
  StatusChip,
  splitBarLabel,
} from "@paycheck-router/ui/components";
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
import { investProgress, paycheckNumber, segmentState } from "@/lib/paycheck-view.ts";

/**
 * The hero: the recorded paycheck as the app shows it, in a phone, with the two slices that tell
 * the story pinned outside the frame: one bought at a fair price, one that waited because the
 * price wasn't fair. Every figure comes from core /proof.
 */
export async function HeroPhone({ paycheck }: { paycheck: CanonicalPaycheck }) {
  const [t, tc, tp, ts, locale] = await Promise.all([
    getTranslations("site.canonical"),
    getTranslations("chrome"),
    getTranslations("app.paycheck"),
    getTranslations("app.slice"),
    getLocale(),
  ]);
  const money = (raw: bigint | string) => formatUsd(usdc(raw), locale);
  const { open, bought } = investProgress(paycheck.slices);
  const investLine =
    open === 0n
      ? tp("invested", { amount: money(bought) })
      : bought === 0n
        ? tp("toInvest", { amount: money(open) })
        : tp("toInvestBought", { total: money(open + bought), bought: money(bought) });
  const total = paycheck.slices.reduce((sum, s) => sum + Number(s.amountIn), 0) || 1;
  const segments = paycheck.slices.map((slice, index) => {
    const slot = index + 1;
    return {
      key: slice.mint,
      asset: slice.mint,
      ticker: slice.symbol,
      weightBps: Number(slice.amountIn),
      colorSlot: isSeriesSlot(slot) ? slot : 1,
      state: segmentState(slice.status),
      valueText: formatPercent((Number(slice.amountIn) / total) * 10_000, locale),
    };
  });

  const reference = (slice: CanonicalSlice) => (isPreIpo(slice.mint) ? "mark" : "pyth");
  const shortReason = (slice: CanonicalSlice) =>
    ts(`reasonShort.${slice.waitReason ?? "LANDING"}`, {
      premium:
        slice.premiumBps === null
          ? ""
          : formatPremiumBps(Math.abs(slice.premiumBps), locale).replace("+", ""),
      reference: reference(slice),
    });
  const fair = paycheck.slices.find(
    (s) => (s.status === "verified" || s.status === "executed") && s.premiumBps !== null,
  );
  const waited = paycheck.slices.find(
    (s) => s.status === "waiting" && s.waitReason === "PREMIUM_TOO_HIGH" && s.premiumBps !== null,
  );

  return (
    <figure className="hero-stage">
      <div className="phone hero-phone">
        <div className="phone__screen">
          {paycheck.fork ? (
            <p className="hero-phone__fork" aria-hidden="true">
              {tc("forkBanner")}
            </p>
          ) : null}
          <p className="pr-label pr-muted">{tp("label", { seq: paycheckNumber(paycheck.seq) })}</p>
          <p className="hero-phone__title">
            {tp("from", { amount: money(paycheck.inflow), payer: tp("forkEmployer") })}
          </p>
          <p className="hero-phone__invest">{investLine}</p>
          <SplitBar segments={segments} label={splitBarLabel(segments)} />
          <ul className="hero-phone__slices">
            {paycheck.slices.map((slice) => (
              <li key={slice.mint}>
                <AssetIcon asset={slice.mint} size="md" decorative eager />
                <span className="hero-phone__ticker" translate="no">
                  {slice.symbol}
                </span>
                <span className="pr-num hero-phone__amount">{money(slice.amountIn)}</span>
                <StatusChip
                  status={slice.status}
                  label={ts(`status.${slice.status}`)}
                  description={slice.status === "waiting" ? shortReason(slice) : undefined}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
      {fair && fair.premiumBps !== null ? (
        <p className="hero-chip hero-chip--fair">
          <AssetIcon asset={fair.mint} size="lg" decorative eager />
          <span className="hero-chip__body">
            <span className="hero-chip__head">
              <span translate="no">{fair.symbol}</span>
              <StatusChip status={fair.status} label={ts(`status.${fair.status}`)} />
            </span>
            <PriceCheckBadge
              tone="in-band"
              text={t("check", {
                premium: formatPremiumBps(fair.premiumBps, locale),
                reference: reference(fair),
              })}
            />
          </span>
        </p>
      ) : null}
      {waited ? (
        <p className="hero-chip hero-chip--waited">
          <AssetIcon asset={waited.mint} size="lg" decorative eager />
          <span className="hero-chip__body">
            <span className="hero-chip__head">
              <span translate="no">{waited.symbol}</span>
              <StatusChip status="waiting" label={ts("status.waiting")} />
            </span>
            <PriceCheckBadge tone="out-of-band" text={shortReason(waited)} />
          </span>
        </p>
      ) : null}
      <figcaption className="pr-small pr-muted hero-stage__caption">
        {paycheck.fork ? t("forkLabel") : t("mainnetLabel")},{" "}
        <time dateTime={paycheck.recordedAt}>
          {formatTimestamp(paycheck.recordedAt, locale, "UTC")}
        </time>
      </figcaption>
    </figure>
  );
}
