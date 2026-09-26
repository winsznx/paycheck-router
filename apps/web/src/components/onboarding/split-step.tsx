"use client";

import { api } from "@paycheck-router/shared";
import {
  AssetChip,
  AssetIcon,
  AssetIconStack,
  AssetTicker,
  Banner,
  Button,
  PriceCheckBadge,
  Skeleton,
  Slider,
  SplitBar,
  splitBarLabel,
} from "@paycheck-router/ui/components";
import { formatPercent, formatPremiumBps, formatUsd } from "@paycheck-router/ui/format";
import { isSeriesSlot } from "@paycheck-router/ui/tokens";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api/client.ts";
import { fetchers, keys } from "@/lib/data.ts";
import { isPreIpo, usdc } from "@/lib/money.ts";
import {
  type DraftLeg,
  toBaseUnits,
  totalWeightBps,
  updateDraft,
  useDraft,
} from "@/lib/onboarding.ts";
import { PRESETS, presetLegs } from "@/lib/presets.ts";
import { useQuery } from "@/lib/query.ts";
import { StepFrame } from "./step-frame.tsx";

const PREVIEW_FALLBACK_USDC = "2000";
const INDEX = new Set(["SPYx", "QQQx"]);
const MAX_LEGS = 8;

type Group = "index" | "bigTech" | "preIpo";

function groupOf(asset: api.Asset): Group {
  if (asset.kind === "pre_ipo") return "preIpo";
  return INDEX.has(asset.symbol) ? "index" : "bigTech";
}

function slotOf(index: number) {
  const slot = index + 1;
  return isSeriesSlot(slot) ? slot : 1;
}

/** Prices a hypothetical paycheck with the current split (PRD F-05 live preview). */
function usePreview(amount: string | null, investBps: number, legs: readonly DraftLeg[]) {
  const [preview, setPreview] = useState<api.QuotePreviewResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const valid = amount !== null && legs.length > 0 && totalWeightBps(legs) === 10_000;
  const query = valid
    ? new URLSearchParams({
        amount,
        investBps: String(investBps),
        legs: legs.map((l) => `${l.mint}:${l.weightBps}:${l.bandBps}`).join(","),
      }).toString()
    : null;

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      apiRequest(`/quote/preview?${query}`, api.QuotePreviewResponse, { signal: controller.signal })
        .then((result) => {
          setPreview(result);
          setFailed(false);
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) setFailed(true);
        });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return { preview: query ? preview : null, failed };
}

export function SplitStep() {
  const t = useTranslations("onboarding.split");
  const tr = useTranslations("app.slice");
  const locale = useLocale();
  const router = useRouter();
  const draft = useDraft();
  const assets = useQuery(keys.assets, fetchers.assets);
  const [touched, setTouched] = useState(false);

  const legs = draft.legs;
  const total = totalWeightBps(legs);
  const amount = toBaseUnits(draft.typicalPaycheckUsdc) ?? toBaseUnits(PREVIEW_FALLBACK_USDC);
  const { preview, failed } = usePreview(amount, draft.investBps, legs);

  const grouped = useMemo(() => {
    const groups: Record<Group, api.Asset[]> = { index: [], bigTech: [], preIpo: [] };
    for (const asset of assets.data?.assets ?? []) {
      if (asset.status === "active") groups[groupOf(asset)].push(asset);
    }
    return groups;
  }, [assets.data]);

  function toggle(asset: api.Asset) {
    const selected = legs.some((l) => l.mint === asset.mint);
    if (selected) {
      updateDraft({ legs: legs.filter((l) => l.mint !== asset.mint) });
    } else if (legs.length < MAX_LEGS) {
      updateDraft({
        legs: [
          ...legs,
          { mint: asset.mint, symbol: asset.symbol, weightBps: 0, bandBps: asset.defaultBandBps },
        ],
      });
    }
  }

  function setWeight(mint: string, percent: number) {
    const weightBps = Math.round(Math.min(Math.max(percent, 0), 100) * 100);
    updateDraft({ legs: legs.map((l) => (l.mint === mint ? { ...l, weightBps } : l)) });
  }

  function evenSplit() {
    if (legs.length === 0) return;
    const base = Math.floor(10_000 / legs.length);
    updateDraft({
      legs: legs.map((l, i) => ({
        ...l,
        weightBps: base + (i === 0 ? 10_000 - base * legs.length : 0),
      })),
    });
  }

  const segments = legs
    .filter((l) => l.weightBps > 0)
    .map((l) => ({
      key: l.mint,
      asset: l.mint,
      ticker: l.symbol,
      weightBps: l.weightBps,
      colorSlot: slotOf(legs.indexOf(l)),
      state: "planned" as const,
      valueText: formatPercent(l.weightBps, locale),
    }));
  const hasPreIpo = legs.some(
    (l) => assets.data?.assets.find((a) => a.mint === l.mint)?.kind === "pre_ipo",
  );

  return (
    <StepFrame
      step="split"
      title={t("title")}
      lead={t("lead")}
      actions={
        <Button
          size="l"
          block
          onClick={() => {
            setTouched(true);
            if (total === 10_000) router.push("/app/onboarding/allowance");
          }}
        >
          {t("continue")}
        </Button>
      }
    >
      <Slider
        label={t("invest")}
        value={draft.investBps / 100}
        min={1}
        max={100}
        onChange={(value) => updateDraft({ investBps: value * 100 })}
        format={(value) => formatPercent(value * 100, locale)}
        numberLabel={t("investNumber")}
      />

      <fieldset className="stack">
        <legend className="pr-h3">{t("presets")}</legend>
        <div className="row">
          {Object.keys(PRESETS).map((name) => (
            <Button
              key={name}
              variant="secondary"
              size="s"
              onClick={() => updateDraft({ legs: presetLegs(name) })}
            >
              <AssetIconStack assets={presetLegs(name).map((leg) => leg.mint)} />
              {t(`preset.${name}`)}
            </Button>
          ))}
        </div>
      </fieldset>

      <fieldset className="stack">
        <legend className="pr-h3">{t("assets")}</legend>
        {assets.status === "loading" ? <Skeleton height={180} /> : null}
        {assets.status === "error" && !assets.data ? (
          <Banner tone="danger">{t("assetsError")}</Banner>
        ) : null}
        {(Object.keys(grouped) as Group[]).map((group) =>
          grouped[group].length > 0 ? (
            <div key={group} className="stack">
              <h3 className="pr-label pr-muted">{t(`group.${group}`)}</h3>
              <ul className="asset-picker">
                {grouped[group].map((asset) => {
                  const selected = legs.some((l) => l.mint === asset.mint);
                  return (
                    <li key={asset.mint}>
                      <button
                        type="button"
                        className="asset-option"
                        aria-pressed={selected}
                        onClick={() => toggle(asset)}
                      >
                        <span className="asset-option__head">
                          <AssetIcon asset={asset.mint} size="lg" decorative />
                          <span className="asset-option__id">
                            <span className="pr-num" translate="no">
                              {asset.symbol}
                            </span>
                            <span className="pr-small pr-muted">{asset.name}</span>
                          </span>
                          <span className="asset-option__check" aria-hidden="true">
                            {selected ? <Check size={16} strokeWidth={2.5} /> : null}
                          </span>
                        </span>
                        <span className="pr-small pr-muted">
                          {t(`market.${asset.market.state}`)}
                        </span>
                        {asset.reference === null && asset.kind === "listed_equity" ? (
                          <span className="pr-small">{t("priceUnavailable")}</span>
                        ) : null}
                        {asset.premiumBps !== null ? (
                          <PriceCheckBadge
                            tone={
                              asset.premiumBps <= asset.defaultBandBps ? "in-band" : "out-of-band"
                            }
                            text={tr("priceCheck", {
                              premium: formatPremiumBps(asset.premiumBps, locale),
                              reference: asset.kind === "pre_ipo" ? "mark" : "pyth",
                            })}
                          />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null,
        )}
      </fieldset>

      {legs.length > 0 ? (
        <fieldset className="stack">
          <legend className="pr-h3">{t("weights")}</legend>
          <SplitBar
            segments={segments}
            label={splitBarLabel(segments)}
            total={formatPercent(total, locale)}
            totalCaption={t("mustTotal")}
          />
          <ul className="weight-list">
            {legs.map((leg, index) => (
              <li key={leg.mint} className="weight-row">
                <AssetChip asset={leg.mint} ticker={leg.symbol} colorSlot={slotOf(index)} />
                <label className="pr-sr-only" htmlFor={`weight-${leg.mint}`}>
                  {t("weightFor", { asset: leg.symbol })}
                </label>
                <div className="pr-field__control weight-input">
                  <input
                    id={`weight-${leg.mint}`}
                    className="pr-field__input"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step={1}
                    value={leg.weightBps / 100}
                    onChange={(event) => setWeight(leg.mint, Number(event.target.value))}
                  />
                  <span className="pr-field__suffix">%</span>
                </div>
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="s" onClick={evenSplit}>
            {t("even")}
          </Button>
          {touched && total !== 10_000 ? (
            <p className="pr-field__error" role="alert">
              {t("totalError", { total: formatPercent(total, locale) })}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {hasPreIpo ? <Banner tone="info">{t("preIpoDisclosure")}</Banner> : null}

      <section className="stack" aria-labelledby="preview-title" aria-live="polite">
        <h2 id="preview-title" className="pr-h3">
          {t("preview", { amount: formatUsd(usdc(amount ?? "0"), locale) })}
        </h2>
        {failed ? <p className="pr-small pr-muted">{t("previewError")}</p> : null}
        {preview ? (
          <ul className="preview-list">
            {preview.legs.map((leg) => (
              <li key={leg.mint} className="preview-row">
                <AssetTicker asset={leg.mint} ticker={leg.symbol} />
                <span className="pr-num">{formatUsd(usdc(leg.amountIn), locale)}</span>
                <span className="pr-small pr-muted">
                  {leg.referenceError
                    ? t("priceUnavailable")
                    : leg.wouldWait
                      ? tr(`reasonShort.${leg.wouldWait}`, {
                          premium:
                            leg.premiumBps === null
                              ? ""
                              : formatPremiumBps(Math.abs(leg.premiumBps), locale).replace("+", ""),
                          reference: isPreIpo(leg.mint) ? "mark" : "pyth",
                        })
                      : t("wouldBuy")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pr-small pr-muted">{t("previewHint")}</p>
        )}
      </section>
    </StepFrame>
  );
}
