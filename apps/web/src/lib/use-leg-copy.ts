"use client";

import type { api } from "@paycheck-router/shared";
import type { PriceCheckTone } from "@paycheck-router/ui/components";
import {
  formatPremiumBps,
  formatPrice,
  formatShares,
  formatTimestamp,
  formatUsdWhole,
} from "@paycheck-router/ui/format";
import { useLocale, useTranslations } from "next-intl";
import { assetLabel, isPreIpo, priceE9, usdc, walletShares } from "./money.ts";

/** Copy for one slice, following PRD 13.5: plain words, exact numbers, where the money is. */
export function useLegCopy() {
  const t = useTranslations("app.slice");
  const locale = useLocale();

  const reference = (leg: api.Leg) => (isPreIpo(leg.mint) ? "mark" : "pyth");
  const premiumText = (bps: number) => formatPremiumBps(Math.abs(bps), locale).replace("+", "");

  function shortReason(leg: api.Leg): string {
    const reason = leg.waitReason ?? "LANDING";
    if (reason === "PREMIUM_TOO_HIGH" && leg.premiumBps !== null) {
      return t("reasonShort.PREMIUM_TOO_HIGH", {
        premium: premiumText(leg.premiumBps),
        reference: reference(leg),
      });
    }
    return t(`reasonShort.${reason}`, { premium: "", reference: reference(leg) });
  }

  function reasonSentence(leg: api.Leg): string {
    const reason = leg.waitReason ?? "LANDING";
    const amount = formatUsdWhole(usdc(leg.amountIn), locale);
    const asset = assetLabel(leg.mint, leg.symbol);
    const args = {
      amount,
      asset,
      premium: leg.premiumBps === null ? "" : premiumText(leg.premiumBps),
      reference: reference(leg),
      next: leg.nextAttemptAt ? formatTimestamp(leg.nextAttemptAt, locale) : "",
    };
    if (reason === "MARKET_CLOSED" && !leg.nextAttemptAt)
      return t("reason.MARKET_CLOSED_NEXT_OPEN", args);
    if (reason === "PREMIUM_TOO_HIGH" && leg.premiumBps === null)
      return t("reason.PREMIUM_UNKNOWN", args);
    return t(`reason.${reason}`, args);
  }

  function statusDescription(leg: api.Leg): string {
    if (leg.status === "waiting") return t("waitingDescription", { reason: shortReason(leg) });
    return t(`status.${leg.status}`);
  }

  function priceCheck(
    leg: api.Leg,
    bandBps: number | null,
  ): { tone: PriceCheckTone; text: string } {
    if (leg.premiumBps === null) return { tone: "none", text: t("noReference") };
    const inBand = bandBps === null ? leg.status !== "waiting" : leg.premiumBps <= bandBps;
    return {
      tone: inBand ? "in-band" : "out-of-band",
      text: t("priceCheck", {
        premium: formatPremiumBps(leg.premiumBps, locale),
        reference: reference(leg),
      }),
    };
  }

  function bought(leg: api.Leg): string | null {
    const amount = walletShares(leg, leg.outAmount);
    const price = priceE9(leg.execPriceE9);
    if (amount === null || price === null) return null;
    const premium = leg.premiumBps ?? 0;
    return t("bought", {
      shares: formatShares(amount, locale),
      asset: leg.symbol,
      price: formatPrice(price, locale),
      premium: premiumText(premium),
      direction: premium < 0 ? "under" : premium > 0 ? "over" : "at",
    });
  }

  return {
    shortReason,
    reasonSentence,
    statusDescription,
    priceCheck,
    bought,
    statusLabel: (leg: api.Leg) => t(`status.${leg.status}`),
  };
}
