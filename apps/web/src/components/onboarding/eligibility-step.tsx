"use client";

import { api } from "@paycheck-router/shared";
import { Banner, Button } from "@paycheck-router/ui/components";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api/client.ts";
import { countryOptions } from "@/lib/countries.ts";
import { fetchers, keys } from "@/lib/data.ts";
import { RISK_VERSION, TERMS_VERSION, updateDraft, useDraft } from "@/lib/onboarding.ts";
import { useQuery } from "@/lib/query.ts";
import { StepFrame } from "./step-frame.tsx";

type Blocked = Exclude<api.EligibilityStatus, "pending" | "eligible">;

export function EligibilityStep() {
  const t = useTranslations("onboarding.eligibility");
  const locale = useLocale();
  const router = useRouter();
  const draft = useDraft();
  const me = useQuery(keys.me, fetchers.me);
  const options = useMemo(() => countryOptions(locale), [locale]);
  const [submitting, setSubmitting] = useState(false);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const country = draft.countryDeclared ?? me.data?.countryIp ?? me.data?.countryDeclared ?? "";
  const incomplete = !country || !draft.notUsPerson || !draft.termsAccepted;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (incomplete) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: api.EligibilityAttestRequest = {
        countryDeclared: country,
        usPerson: false,
        tosVersion: TERMS_VERSION,
        riskAckVersion: RISK_VERSION,
      };
      const result = await apiRequest("/eligibility/attest", api.EligibilityResponse, {
        method: "POST",
        body,
      });
      if (result.status !== "eligible" && result.status !== "pending") {
        setBlocked(result.status);
        return;
      }
      if (result.countryMismatch && !mismatch) {
        setMismatch(true);
        return;
      }
      router.push("/app/onboarding/wallet");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  if (blocked) {
    return (
      <StepFrame step="eligibility" title={t("blockedTitle")} actions={null}>
        <p className="pr-body-l">{t(`blocked.${blocked}`)}</p>
        <p>
          <a href="/legal/restricted-countries">{t("restrictedLink")}</a>
        </p>
      </StepFrame>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <StepFrame
        step="eligibility"
        title={t("title")}
        lead={t("lead")}
        actions={
          <Button
            type="submit"
            size="l"
            block
            loadingLabel={submitting ? t("checking") : undefined}
          >
            {mismatch ? t("confirm") : t("continue")}
          </Button>
        }
      >
        <div className="pr-field">
          <label className="pr-field__label" htmlFor="country">
            {t("country")} <span className="pr-muted">{t("required")}</span>
          </label>
          <div className="pr-field__control">
            <select
              id="country"
              className="pr-field__input pr-select"
              value={country}
              required
              aria-describedby="country-help"
              onChange={(event) => updateDraft({ countryDeclared: event.target.value })}
            >
              <option value="" disabled>
                {t("countryPlaceholder")}
              </option>
              {options.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
          <p id="country-help" className="pr-field__helper">
            {t("countryHelp")}
          </p>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={draft.notUsPerson}
            onChange={(event) => updateDraft({ notUsPerson: event.target.checked })}
            aria-describedby={touched && !draft.notUsPerson ? "us-error" : undefined}
          />
          <span>{t("notUsPerson")}</span>
        </label>
        {touched && !draft.notUsPerson ? (
          <p id="us-error" className="pr-field__error">
            {t("notUsPersonRequired")}
          </p>
        ) : null}

        <div className="pr-card stack">
          <p className="pr-body">{t("termsSummary")}</p>
          <p className="row">
            <a href="/legal/terms">{t("terms")}</a>
            <a href="/legal/risk">{t("risk")}</a>
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.termsAccepted}
              onChange={(event) => updateDraft({ termsAccepted: event.target.checked })}
            />
            <span>{t("acceptTerms")}</span>
          </label>
        </div>

        {mismatch ? <Banner tone="warn">{t("mismatch")}</Banner> : null}
        {error ? (
          <Banner tone="danger" live="alert">
            {error}
          </Banner>
        ) : null}
      </StepFrame>
    </form>
  );
}
