"use client";

import type { api } from "@paycheck-router/shared";
import { Banner, Button } from "@paycheck-router/ui/components";
import Script from "next/script";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { countryOptions } from "@/lib/countries.ts";
import { apiUrl, turnstileSiteKey } from "@/lib/env.ts";

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      language?: string;
      theme?: "dark" | "light" | "auto";
      size?: "normal" | "compact" | "flexible";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type Status = "idle" | "sending" | "done" | "error";

/** The API validates fully; this only catches typos before spending a Turnstile token. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Waitlist with Cloudflare Turnstile; the core API verifies the token (PRD 11.2, 18.1). */
export function WaitlistForm({ source }: { source: string }) {
  const t = useTranslations("site.waitlist");
  const locale = useLocale();
  const options = useMemo(() => countryOptions(locale), [locale]);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const emailId = useId();
  const countryId = useId();

  // Mounts the Turnstile widget once its script has loaded; the widget is an external system.
  useEffect(() => {
    const element = widgetRef.current;
    if (!scriptReady || !element || !window.turnstile || !turnstileSiteKey) return;
    const id = window.turnstile.render(element, {
      sitekey: turnstileSiteKey,
      language: locale,
      theme: "dark",
      // The normal widget is 300 px wide; narrower containers (320 px phones) get the compact one.
      size: element.clientWidth < 300 ? "compact" : "normal",
      callback: setToken,
      "expired-callback": () => setToken(null),
      "error-callback": () => setToken(null),
    });
    widgetId.current = id;
    return () => {
      window.turnstile?.remove(id);
      widgetId.current = null;
    };
  }, [scriptReady, locale]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!token) {
      setError(t("verify"));
      return;
    }
    const country = String(form.get("country") ?? "");
    const email = String(form.get("email") ?? "").trim();
    if (!EMAIL.test(email)) {
      setError(t("invalidEmail"));
      return;
    }
    const body: api.WaitlistRequest = {
      email,
      ...(country ? { country } : {}),
      source,
      turnstileToken: token,
    };
    setStatus("sending");
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/waitlist`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(String(response.status));
      setStatus("done");
    } catch {
      setStatus("error");
      setError(t("failed"));
      if (widgetId.current) window.turnstile?.reset(widgetId.current);
      setToken(null);
    }
  }

  if (status === "done") {
    return (
      <Banner tone="info" live="status">
        {t("done")}
      </Banner>
    );
  }

  return (
    <form className="stack waitlist" onSubmit={submit} noValidate>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="lazyOnload"
        onReady={() => setScriptReady(true)}
      />
      <div className="pr-field">
        <label className="pr-field__label" htmlFor={emailId}>
          {t("email")} <span className="pr-muted">{t("required")}</span>
        </label>
        <div className="pr-field__control">
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            required
            className="pr-field__input waitlist__email"
          />
        </div>
      </div>
      <div className="pr-field">
        <label className="pr-field__label" htmlFor={countryId}>
          {t("country")}
        </label>
        <div className="pr-field__control">
          <select
            id={countryId}
            name="country"
            className="pr-field__input pr-select"
            defaultValue=""
          >
            <option value="">{t("countryOptional")}</option>
            {options.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div ref={widgetRef} className="turnstile" />
      {turnstileSiteKey ? null : <p className="pr-small pr-muted">{t("notConfigured")}</p>}
      <Button type="submit" size="l" loadingLabel={status === "sending" ? t("sending") : undefined}>
        {t("submit")}
      </Button>
      {error ? (
        <p className="pr-field__error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="pr-small pr-muted">{t("privacy")}</p>
    </form>
  );
}
