"use client";

import { api } from "@paycheck-router/shared";
import {
  AssetChip,
  Button,
  PriceCheckBadge,
  Sheet,
  type SliceFact,
  SliceRow,
  Slider,
  StatusChip,
  useToast,
} from "@paycheck-router/ui/components";
import {
  formatBps,
  formatPremiumBps,
  formatPrice,
  formatShares,
  formatTime,
  formatUsd,
  formatUsdcAmount,
  truncateMiddle,
} from "@paycheck-router/ui/format";
import type { SeriesSlot } from "@paycheck-router/ui/tokens";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { apiRequest } from "@/lib/api/client.ts";
import { explorerUrl } from "@/lib/env.ts";
import { isPreIpo, priceE9, shares, usdc } from "@/lib/money.ts";
import { useSession } from "@/lib/session.ts";
import { useLegCopy } from "@/lib/use-leg-copy.ts";
import { signAndSubmit } from "@/lib/wallet/sign-and-submit.ts";

type DetailLeg = api.PaycheckDetail["legs"][number];

type SliceItemProps = {
  leg: DetailLeg;
  colorSlot: SeriesSlot;
  bandBps: number | null;
  buyNowAt: number | null;
  now: number;
};

const MAX_BUY_NOW_BAND_BPS = 1_000;

function ProofDetails({ leg }: { leg: DetailLeg }) {
  const t = useTranslations("app.proof");
  const locale = useLocale();
  const v = leg.verification;
  const rows: Array<[string, string]> = [
    [t("reference"), isPreIpo(leg.mint) ? t("referenceMark") : t("referencePyth")],
    [
      t("referencePrice"),
      priceE9(leg.refPriceE9) === null ? "—" : formatPrice(priceE9(leg.refPriceE9) ?? 0, locale),
    ],
    [t("premium"), leg.premiumBps === null ? "—" : formatBps(leg.premiumBps, locale)],
    [
      t("minimum"),
      v?.recomputedMinOut
        ? `${formatShares(shares(leg.mint, v.recomputedMinOut) ?? "0", locale, "full")} ${leg.symbol}`
        : "—",
    ],
    [
      t("delivered"),
      leg.outAmount
        ? `${formatShares(shares(leg.mint, leg.outAmount) ?? "0", locale, "full")} ${leg.symbol}`
        : "—",
    ],
    [t("finalizedSlot"), v?.finalizedSlot ?? "—"],
    [t("readback"), v ? v.rpcProvider : "—"],
    [t("result"), v ? (v.matches ? t("matches") : t("mismatch")) : t("pending")],
  ];
  return (
    <div className="stack">
      <dl className="proof-list">
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt className="pr-small pr-muted">{term}</dt>
            <dd className="pr-code">{value}</dd>
          </div>
        ))}
      </dl>
      {leg.links.length > 0 ? (
        <ul className="stack">
          {leg.links.map((link) => (
            <li key={link.url}>
              <a href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {leg.executedSig ? (
        <p>
          <a href={`/proof/${leg.executedSig}`}>{t("publicProof")}</a>
        </p>
      ) : null}
    </div>
  );
}

export function SliceItem({ leg, colorSlot, bandBps, buyNowAt, now }: SliceItemProps) {
  const t = useTranslations("app.slice");
  const tp = useTranslations("app.proof");
  const locale = useLocale();
  const copy = useLegCopy();
  const toast = useToast();
  const session = useSession();
  const walletName = session.status === "signed-in" ? session.walletName : null;
  const [sheet, setSheet] = useState<"proof" | "buy" | "cancel" | null>(null);
  const [band, setBand] = useState(() =>
    Math.min(Math.max((leg.premiumBps ?? 0) + 25, 0), MAX_BUY_NOW_BAND_BPS),
  );
  const [busy, setBusy] = useState<string | undefined>(undefined);

  const check = copy.priceCheck(leg, bandBps);
  const out = shares(leg.mint, leg.outAmount);
  const exec = priceE9(leg.execPriceE9);
  const ref = priceE9(leg.refPriceE9);
  const facts: SliceFact[] = [
    {
      key: "shares",
      term: t("facts.shares"),
      value: out === null ? "—" : `${formatShares(out, locale)} ${leg.symbol}`,
    },
    {
      key: "exec",
      term: t("facts.effectivePrice"),
      value: exec === null ? "—" : formatPrice(exec, locale),
    },
    {
      key: "ref",
      term: t("facts.referencePrice"),
      value: ref === null ? "—" : formatPrice(ref, locale),
    },
    {
      key: "premium",
      term: t("facts.premium"),
      value: leg.premiumBps === null ? "—" : formatPremiumBps(leg.premiumBps, locale),
    },
    ...(leg.issuerFee && BigInt(leg.issuerFee) > 0n
      ? [
          {
            key: "issuerFee",
            term: t("facts.issuerFee"),
            value: `${formatShares(shares(leg.mint, leg.issuerFee) ?? "0", locale, "full")} ${leg.symbol}`,
          },
        ]
      : []),
    {
      key: "fee",
      term: t("facts.fee"),
      value: leg.fee === null ? "—" : formatUsdcAmount(usdc(leg.fee), locale),
    },
    {
      key: "tx",
      term: t("facts.transaction"),
      value: leg.executedSig ? (
        <a
          href={explorerUrl("tx", leg.executedSig)}
          target="_blank"
          rel="noreferrer"
          translate="no"
        >
          {truncateMiddle(leg.executedSig, 4, 3)}
        </a>
      ) : (
        "—"
      ),
    },
  ];

  async function run(kind: "buy" | "cancel") {
    setBusy(kind === "buy" ? t("signing") : t("cancelling"));
    try {
      const built =
        kind === "buy"
          ? await apiRequest(`/legs/${leg.id}/tx/buy-now`, api.TxBuildResponse, {
              method: "POST",
              body: { bandBps: band } satisfies api.BuyNowTxRequest,
            })
          : await apiRequest(`/legs/${leg.id}/tx/cancel`, api.TxBuildResponse, { method: "POST" });
      const result = await signAndSubmit(
        walletName,
        built,
        kind === "buy" ? "leg.buy_now" : "leg.cancel",
      );
      if (result.status === "failed" || result.status === "expired") {
        toast({ tone: "error", text: result.error ?? t("txFailed") });
      } else {
        toast({ tone: "success", text: kind === "buy" ? t("buySent") : t("cancelSent") });
        setSheet(null);
      }
    } catch (error) {
      toast({ tone: "error", text: error instanceof Error ? error.message : t("txFailed") });
    } finally {
      setBusy(undefined);
    }
  }

  const waiting = leg.status === "waiting";
  const canBuyNow = buyNowAt !== null && now >= buyNowAt;

  return (
    <SliceRow
      asset={
        <AssetChip
          ticker={leg.symbol}
          colorSlot={colorSlot}
          preIpoLabel={isPreIpo(leg.mint) ? t("preIpo") : undefined}
        />
      }
      usdcIn={formatUsd(usdc(leg.amountIn), locale)}
      status={
        <StatusChip
          key={leg.status}
          status={leg.status}
          label={copy.statusLabel(leg)}
          description={copy.statusDescription(leg)}
        />
      }
      delivered={out !== null ? `+${formatShares(out, locale)} ${leg.symbol}` : undefined}
      priceCheck={<PriceCheckBadge tone={check.tone} text={check.text} />}
      facts={leg.status === "waiting" || leg.status === "pending" ? [] : facts}
      reason={
        waiting || leg.status === "expired" ? (
          <div className="stack">
            <p className="pr-body">{copy.reasonSentence(leg)}</p>
            {waiting && leg.nextAttemptAt ? (
              <p className="pr-small pr-muted">
                {t("nextAttempt", { time: formatTime(leg.nextAttemptAt, locale) })}
              </p>
            ) : null}
            {waiting ? (
              <div className="row">
                {canBuyNow ? (
                  <Button variant="secondary" size="s" onClick={() => setSheet("buy")}>
                    {t("buyNow")}
                  </Button>
                ) : buyNowAt !== null ? (
                  <p className="pr-small pr-muted">
                    {t("buyNowFrom", { time: formatTime(new Date(buyNowAt), locale) })}
                  </p>
                ) : null}
                <Button variant="ghost" size="s" onClick={() => setSheet("cancel")}>
                  {t("cancel")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : undefined
      }
      footer={
        <div className="slice-footer">
          <span />
          <Button variant="ghost" size="s" onClick={() => setSheet("proof")}>
            {tp("open")}
          </Button>
          <Sheet
            open={sheet === "proof"}
            onClose={() => setSheet(null)}
            title={tp("title", { asset: leg.symbol })}
            closeLabel={t("close")}
          >
            <ProofDetails leg={leg} />
          </Sheet>
          <Sheet
            open={sheet === "buy"}
            onClose={() => setSheet(null)}
            title={t("buyNowTitle", { asset: leg.symbol })}
            closeLabel={t("close")}
          >
            <div className="stack">
              <p className="pr-body">{t("buyNowBody")}</p>
              <Slider
                label={t("bandLabel")}
                value={band}
                min={0}
                max={MAX_BUY_NOW_BAND_BPS}
                step={5}
                onChange={setBand}
                format={(v) => formatPremiumBps(v, locale)}
                numberLabel={t("bandNumberLabel")}
              />
              <Button block onClick={() => run("buy")} loadingLabel={busy}>
                {t("buyNowConfirm", { band: formatPremiumBps(band, locale) })}
              </Button>
            </div>
          </Sheet>
          <Sheet
            open={sheet === "cancel"}
            onClose={() => setSheet(null)}
            title={t("cancelTitle", { asset: leg.symbol })}
            closeLabel={t("close")}
          >
            <div className="stack">
              <p className="pr-body">{t("cancelBody")}</p>
              <Button variant="danger" block onClick={() => run("cancel")} loadingLabel={busy}>
                {t("cancelConfirm")}
              </Button>
            </div>
          </Sheet>
        </div>
      }
    />
  );
}
