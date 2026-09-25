"use client";

import { AllowanceMeter, AmountInput, Button } from "@paycheck-router/ui/components";
import { formatUsd } from "@paycheck-router/ui/format";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { usdc, usdcNumber } from "@/lib/money.ts";
import {
  allowanceBaseUnits,
  type Draft,
  toBaseUnits,
  updateDraft,
  useDraft,
} from "@/lib/onboarding.ts";
import { StepFrame } from "./step-frame.tsx";

const CHOICES: readonly Draft["allowancePaychecks"][] = [3, 6, "custom"];

export function AllowanceStep() {
  const t = useTranslations("onboarding.allowance");
  const locale = useLocale();
  const router = useRouter();
  const draft = useDraft();
  const [touched, setTouched] = useState(false);

  const paycheck = toBaseUnits(draft.typicalPaycheckUsdc);
  const perPaycheck = paycheck ? (usdcNumber(paycheck) * draft.investBps) / 10_000 : 0;
  const choice = paycheck ? draft.allowancePaychecks : "custom";
  const allowance = allowanceBaseUnits({ ...draft, allowancePaychecks: choice });
  const amount = allowance ? usdcNumber(allowance) : 0;
  const belowOnePaycheck = perPaycheck > 0 && amount < perPaycheck;
  const valid = allowance !== null && !belowOnePaycheck;

  return (
    <StepFrame
      step="allowance"
      title={t("title")}
      lead={t("lead")}
      actions={
        <Button
          size="l"
          block
          onClick={() => {
            setTouched(true);
            if (valid) router.push("/app/onboarding/review");
          }}
        >
          {t("continue")}
        </Button>
      }
    >
      <fieldset className="stack">
        <legend className="pr-h3">{t("choose")}</legend>
        <div className="segmented" role="radiogroup" aria-label={t("choose")}>
          {CHOICES.map((value) => (
            <label key={String(value)} className="segmented__option">
              <input
                type="radio"
                name="allowance"
                value={String(value)}
                checked={choice === value}
                disabled={value !== "custom" && !paycheck}
                onChange={() => updateDraft({ allowancePaychecks: value })}
              />
              <span>{value === "custom" ? t("custom") : t("paychecks", { count: value })}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {choice === "custom" ? (
        <AmountInput
          label={t("customLabel")}
          suffix="USDC"
          value={draft.customAllowanceUsdc}
          onChange={(event) => updateDraft({ customAllowanceUsdc: event.target.value })}
          error={touched && !valid ? t("tooLow") : undefined}
        />
      ) : null}

      {allowance ? (
        <AllowanceMeter
          remaining={amount}
          perPaycheck={perPaycheck}
          capacity={Math.max(amount, perPaycheck * 6, 1)}
          state={belowOnePaycheck ? "low" : "healthy"}
          label={t("meter")}
          valueText={t("meterValue", { amount: formatUsd(usdc(allowance), locale) })}
          caption={formatUsd(usdc(allowance), locale)}
          captionEnd={
            perPaycheck > 0
              ? t("perPaycheck", { amount: formatUsd(perPaycheck, locale) })
              : undefined
          }
        />
      ) : null}

      <div className="pr-card stack">
        <h2 className="pr-h3">{t("canTitle")}</h2>
        <p className="pr-body">{t("can")}</p>
        <h2 className="pr-h3">{t("cannotTitle")}</h2>
        <p className="pr-body">{t("cannot")}</p>
      </div>
    </StepFrame>
  );
}
