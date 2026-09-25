"use client";

import { api } from "@paycheck-router/shared";
import { useToast } from "@paycheck-router/ui/components";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useId, useSyncExternalStore } from "react";
import { LOCALE_COOKIE, locales } from "@/i18n/routing.ts";
import { apiRequest } from "@/lib/api/client.ts";
import { fetchers, keys } from "@/lib/data.ts";
import { DATA_SAVER_COOKIE, MOTION_COOKIE, THEME_COOKIE } from "@/lib/preference-cookies.ts";
import { setQueryData, useQuery } from "@/lib/query.ts";

const YEAR = 60 * 60 * 24 * 365;
const CURRENCIES = [
  "USD",
  "NGN",
  "KES",
  "GHS",
  "PHP",
  "INR",
  "BRL",
  "ARS",
  "MXN",
  "COP",
  "ZAR",
  "EGP",
  "PKR",
  "IDR",
  "TRY",
];

function setCookie(name: string, value: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: device-level display preferences live in cookies the server reads
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR}; SameSite=Lax`;
}

function subscribeRoot(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true });
  return () => observer.disconnect();
}

/** Reads a data attribute on <html>, where the root layout applied the saved preference. */
function useRootAttribute(name: string, fallback: string): string {
  return useSyncExternalStore(
    subscribeRoot,
    () => document.documentElement.getAttribute(name) ?? fallback,
    () => fallback,
  );
}

function Field({ label, children, id }: { label: string; children: ReactNode; id: string }) {
  return (
    <div className="pr-field">
      <label className="pr-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="pr-field__control">{children}</div>
    </div>
  );
}

/** PRD 13.4 Settings > preferences: language, reference currency, theme, motion, data saver. */
export function PreferencesSection() {
  const t = useTranslations("app.settings.preferences");
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const me = useQuery(keys.me, fetchers.me);
  const theme = useRootAttribute("data-theme", "dark");
  const motion = useRootAttribute("data-motion", "full");
  const dataSaver = useRootAttribute("data-data-saver", "off");
  const ids = { locale: useId(), currency: useId(), theme: useId() };

  async function patchMe(body: api.PatchMeRequest) {
    try {
      const updated = await apiRequest("/me", api.Me, { method: "PATCH", body });
      setQueryData(keys.me, () => updated);
      toast({ tone: "success", text: t("saved") });
    } catch {
      toast({ tone: "error", text: t("saveFailed") });
    }
  }

  return (
    <section className="stack-lg" aria-labelledby="preferences-title">
      <h2 id="preferences-title" className="pr-h2">
        {t("title")}
      </h2>
      <Field label={t("language")} id={ids.locale}>
        <select
          id={ids.locale}
          className="pr-field__input pr-select"
          value={locale}
          onChange={async (event) => {
            const next = event.target.value as (typeof locales)[number];
            setCookie(LOCALE_COOKIE, next);
            await patchMe({ locale: next });
            router.refresh();
          }}
        >
          {locales.map((value) => (
            <option key={value} value={value}>
              {t(`languages.${value}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("currency")} id={ids.currency}>
        <select
          id={ids.currency}
          className="pr-field__input pr-select"
          value={me.data?.refCurrency ?? "USD"}
          onChange={(event) => patchMe({ refCurrency: event.target.value })}
        >
          {CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code} ({code})
            </option>
          ))}
        </select>
      </Field>
      <p className="pr-small pr-muted">{t("currencyNote")}</p>
      <Field label={t("theme")} id={ids.theme}>
        <select
          id={ids.theme}
          className="pr-field__input pr-select"
          value={theme}
          onChange={(event) => {
            setCookie(THEME_COOKIE, event.target.value);
            document.documentElement.dataset.theme = event.target.value;
          }}
        >
          {(["dark", "light", "system"] as const).map((value) => (
            <option key={value} value={value}>
              {t(`themes.${value}`)}
            </option>
          ))}
        </select>
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={motion === "reduced"}
          onChange={(event) => {
            const reduced = event.target.checked;
            setCookie(MOTION_COOKIE, reduced ? "reduced" : "full");
            if (reduced) document.documentElement.dataset.motion = "reduced";
            else delete document.documentElement.dataset.motion;
          }}
        />
        <span>{t("reducedMotion")}</span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={dataSaver === "on"}
          onChange={(event) => {
            const on = event.target.checked;
            setCookie(DATA_SAVER_COOKIE, on ? "on" : "off");
            if (on) document.documentElement.dataset.dataSaver = "on";
            else delete document.documentElement.dataset.dataSaver;
          }}
        />
        <span>{t("dataSaver")}</span>
      </label>
    </section>
  );
}
