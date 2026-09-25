"use client";

import type { api } from "@paycheck-router/shared";
import { formatUsd } from "@paycheck-router/ui/format";
import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import { usdc } from "./money.ts";
import { investProgress } from "./paycheck-view.ts";

/**
 * What a paycheck has put into shares so far. "$370.00 invested" only once every slice is
 * settled; while slices wait it reads "$370.00 to invest · $37.00 bought".
 */
export function useInvestText(): (legs: readonly Pick<api.Leg, "status" | "amountIn">[]) => string {
  const t = useTranslations("app.paycheck");
  const locale = useLocale();
  return useCallback(
    (legs) => {
      const { open, bought } = investProgress(legs);
      const money = (raw: bigint) => formatUsd(usdc(raw), locale);
      if (open === 0n) return t("invested", { amount: money(bought) });
      if (bought === 0n) return t("toInvest", { amount: money(open) });
      return t("toInvestBought", { total: money(open + bought), bought: money(bought) });
    },
    [t, locale],
  );
}
