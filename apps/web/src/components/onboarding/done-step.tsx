"use client";

import { AddressField, buttonClassName, QrCode } from "@paycheck-router/ui/components";
import { formatUsdWhole } from "@paycheck-router/ui/format";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import { explorerUrl } from "@/lib/env.ts";
import { usdc } from "@/lib/money.ts";
import { clearDraft, toBaseUnits, useDraft } from "@/lib/onboarding.ts";
import { useSession } from "@/lib/session.ts";
import { StepFrame } from "./step-frame.tsx";

export function DoneStep() {
  const t = useTranslations("onboarding.done");
  const locale = useLocale();
  const draft = useDraft();
  const session = useSession();
  const address = session.status === "signed-in" ? session.session.wallet : null;
  const paycheck = toBaseUnits(draft.typicalPaycheckUsdc);
  const invested = paycheck ? (BigInt(paycheck) * BigInt(draft.investBps)) / 10_000n : null;

  // The router is live; the draft has done its job once this screen has read it.
  useEffect(() => () => clearDraft(), []);

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
            <AddressField
              address={address}
              label={t("address")}
              copyLabel={t("copy")}
              copiedLabel={t("copied")}
              explorerHref={explorerUrl("address", address)}
              explorerLabel={t("explorer")}
            />
            <QrCode value={address} label={t("qr")} />
          </>
        ) : null}
      </div>
    </StepFrame>
  );
}
