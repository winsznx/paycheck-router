"use client";

import { Button, useToast } from "@paycheck-router/ui/components";
import { formatUsdWhole } from "@paycheck-router/ui/format";
import { Send } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import {
  DEFAULT_PAYCHECK_USDC,
  MAX_PAYCHECK_USDC,
  MIN_PAYCHECK_USDC,
  sendForkPaycheck,
} from "@/lib/hosted-demo.ts";
import { useProblemMessage } from "@/lib/problem-copy.ts";

const PRESETS = [500, 1850, 4000] as const;

/**
 * Hosted demo home: the fork's employer pays the visitor. Detection, slices and verification then
 * arrive over the realtime feed like any paycheck.
 */
export function SendPaycheck() {
  const t = useTranslations("hosted.paycheck");
  const locale = useLocale();
  const toast = useToast();
  const problemMessage = useProblemMessage();
  const inputId = useId();
  const [amount, setAmount] = useState(String(DEFAULT_PAYCHECK_USDC));
  const [pending, setPending] = useState(false);
  const value = Number(amount);
  const valid = Number.isFinite(value) && value >= MIN_PAYCHECK_USDC && value <= MAX_PAYCHECK_USDC;

  async function send() {
    if (!valid) return;
    setPending(true);
    try {
      await sendForkPaycheck(value);
      toast({ tone: "success", text: t("sent", { amount: formatUsdWhole(value, locale) }) });
    } catch (cause) {
      toast({ tone: "error", text: problemMessage(cause, t("failed")) });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="pr-card stack send-paycheck home-grid__wide" aria-labelledby="send-title">
      <div className="stack-tight">
        <h2 id="send-title" className="pr-h2">
          {t("title")}
        </h2>
        <p className="pr-body pr-muted">{t("body")}</p>
      </div>
      <div className="send-paycheck__row">
        <div className="pr-field">
          <label className="pr-field__label" htmlFor={inputId}>
            {t("amount")}
          </label>
          <div className="send-paycheck__amount">
            <span aria-hidden="true">$</span>
            <input
              id={inputId}
              className="pr-field__control"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))}
              aria-invalid={!valid}
              aria-describedby={`${inputId}-hint`}
            />
          </div>
          <p id={`${inputId}-hint`} className="pr-small pr-muted">
            {t("range", {
              min: formatUsdWhole(MIN_PAYCHECK_USDC, locale),
              max: formatUsdWhole(MAX_PAYCHECK_USDC, locale),
            })}
          </p>
        </div>
        <fieldset className="row send-paycheck__presets">
          <legend className="pr-sr-only">{t("presets")}</legend>
          {PRESETS.map((preset) => (
            <Button
              key={preset}
              variant="ghost"
              size="s"
              aria-pressed={value === preset}
              onClick={() => setAmount(String(preset))}
            >
              {formatUsdWhole(preset, locale)}
            </Button>
          ))}
        </fieldset>
      </div>
      <Button
        size="l"
        onClick={send}
        disabled={!valid}
        loadingLabel={pending ? t("sending") : undefined}
      >
        <Send size={18} strokeWidth={2} aria-hidden="true" />
        {t("send", { amount: formatUsdWhole(valid ? value : DEFAULT_PAYCHECK_USDC, locale) })}
      </Button>
    </section>
  );
}
