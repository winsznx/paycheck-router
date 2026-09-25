"use client";

import { AmountInput, Button, buttonClassName } from "@paycheck-router/ui/components";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toBaseUnits, updateDraft, useDraft } from "@/lib/onboarding.ts";
import { StepFrame } from "./step-frame.tsx";

/**
 * PRD 13.2 pay history. Grouped inflows need an existing router (`GET /routers/:id/inflows`),
 * so first-time setup asks for the typical paycheck and uses the default rule; tagging payers
 * happens in Settings once the router exists.
 */
export function PayHistoryStep() {
  const t = useTranslations("onboarding.payHistory");
  const router = useRouter();
  const draft = useDraft();
  const [touched, setTouched] = useState(false);
  const paycheckValid = toBaseUnits(draft.typicalPaycheckUsdc) !== null;
  const minimumValid = toBaseUnits(draft.minInflowUsdc) !== null;

  return (
    <StepFrame
      step="pay-history"
      title={t("title")}
      lead={t("lead")}
      actions={
        <div className="stack">
          <Button
            size="l"
            block
            onClick={() => {
              setTouched(true);
              if (paycheckValid && minimumValid) router.push("/app/onboarding/split");
            }}
          >
            {t("continue")}
          </Button>
          <Link
            href="/app/onboarding/split"
            className={buttonClassName({ variant: "ghost", block: true })}
          >
            {t("skip")}
          </Link>
        </div>
      }
    >
      <AmountInput
        label={t("typical")}
        suffix="USDC"
        value={draft.typicalPaycheckUsdc}
        onChange={(event) => updateDraft({ typicalPaycheckUsdc: event.target.value })}
        onBlur={() => setTouched(true)}
        helper={t("typicalHelp")}
        error={touched && !paycheckValid ? t("typicalError") : undefined}
        required
      />
      <AmountInput
        label={t("minimum")}
        suffix="USDC"
        value={draft.minInflowUsdc}
        onChange={(event) => updateDraft({ minInflowUsdc: event.target.value })}
        helper={t("minimumHelp")}
        error={touched && !minimumValid ? t("minimumError") : undefined}
      />
    </StepFrame>
  );
}
