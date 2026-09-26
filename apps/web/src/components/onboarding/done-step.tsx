"use client";

import { buttonClassName, QrCode } from "@paycheck-router/ui/components";
import { formatUsdWhole } from "@paycheck-router/ui/format";
import { Check } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ChainValue } from "@/components/chain-value.tsx";
import { usdc } from "@/lib/money.ts";
import { clearDraft, toBaseUnits, useDraft } from "@/lib/onboarding.ts";
import { useSession } from "@/lib/session.ts";
import { PlanSummary } from "./plan-summary.tsx";
import { StepFrame } from "./step-frame.tsx";

export function DoneStep() {
  const t = useTranslations("onboarding.done");
  const locale = useLocale();
  const current = useDraft();
  // Keep the plan this screen was reached with: the draft is cleared below, and under React
  // strict mode an unmount-time clear ran before the first paint and emptied the summary.
  const [draft] = useState(current);
  const session = useSession();
  const address = session.status === "signed-in" ? session.session.wallet : null;
  const paycheck = toBaseUnits(draft.typicalPaycheckUsdc);
  const invested = paycheck ? (BigInt(paycheck) * BigInt(draft.investBps)) / 10_000n : null;

  // The router is live; the draft has done its job once this screen has read it.
  useEffect(() => clearDraft(), []);

  return (
    <StepFrame
      step="done"
      title={t("title")}
      lead={t("lead")}
      actions={
        <Link href="/app" className={buttonClassName({ size: "l", block: true })}>
          {t("home")}
        </Link>
      }
    >
      <div className="done-mark" aria-hidden="true">
        <Check size={40} strokeWidth={2.5} />
      </div>
      <PlanSummary draft={draft} />
      {paycheck && invested !== null ? (
        <p className="pr-body-l">
          {t("next", {
            amount: formatUsdWhole(usdc(paycheck), locale),
            invested: formatUsdWhole(usdc(invested), locale),
          })}
        </p>
      ) : null}
      <div className="pr-card stack">
        <p className="pr-body">{t("test")}</p>
        {address ? (
          <>
            <ChainValue kind="account" value={address} name={t("address")} display="full" />
            <QrCode value={address} label={t("qr")} />
          </>
        ) : null}
      </div>
    </StepFrame>
  );
}
