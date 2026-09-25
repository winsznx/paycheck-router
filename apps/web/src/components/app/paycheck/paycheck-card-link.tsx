"use client";

import type { api } from "@paycheck-router/shared";
import { PaycheckCard, StatusChip, splitBarLabel } from "@paycheck-router/ui/components";
import { formatPercent, formatTime, formatUsd } from "@paycheck-router/ui/format";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { usdc } from "@/lib/money.ts";
import { isForkEmployer, paycheckPhase, toSegments } from "@/lib/paycheck-view.ts";
import { useInvestText } from "@/lib/use-invest-text.ts";
import { useLegCopy } from "@/lib/use-leg-copy.ts";

const PHASE_CHIP = {
  recording: "pending",
  executing: "executing",
  waiting: "waiting",
  complete: "verified",
  expired: "expired",
} as const;

export function PaycheckCardLink({
  paycheck,
  routerLegs,
}: {
  paycheck: api.PaycheckSummary;
  routerLegs: readonly api.RouterLeg[] | undefined;
}) {
  const t = useTranslations("app.paycheck");
  const locale = useLocale();
  const copy = useLegCopy();
  const investText = useInvestText();
  const phase = paycheckPhase(paycheck.legs);
  const total = Number(paycheck.investTotal) || 1;
  const segments = toSegments(
    paycheck.legs,
    routerLegs,
    (leg) => formatPercent((Number(leg.amountIn) / total) * 10_000, locale),
    (leg) => (leg.status === "waiting" ? copy.statusLabel(leg) : undefined),
  );
  const done = paycheck.legs.filter((l) =>
    ["executed", "verified", "unverified"].includes(l.status),
  ).length;
  const waiting = paycheck.legs.filter((l) => l.status === "waiting").length;
  const payer = isForkEmployer(paycheck.sender)
    ? t("forkEmployer")
    : paycheck.sender
      ? t("payer")
      : t("unknownPayer");
  return (
    <Link
      href={`/app/paychecks/${paycheck.id}`}
      className="pr-card pr-card--interactive"
      style={{ viewTransitionName: `paycheck-${paycheck.id}` }}
    >
      <PaycheckCard
        state={phase}
        amount={formatUsd(usdc(paycheck.inflow), locale)}
        payer={payer}
        time={formatTime(paycheck.recordedAt, locale)}
        invested={investText(paycheck.legs)}
        segments={segments}
        splitLabel={splitBarLabel(segments)}
        summary={t("progress", { done, total: paycheck.legs.length, waiting })}
        status={<StatusChip status={PHASE_CHIP[phase]} label={t(`phase.${phase}`)} />}
      />
    </Link>
  );
}
