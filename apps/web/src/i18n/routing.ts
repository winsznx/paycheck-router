import { defineRouting } from "next-intl/routing";

export const locales = ["en", "es-419", "pt-BR", "fr"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const LOCALE_COOKIE = "NEXT_LOCALE";

/** PRD 17.2: public site paths `/`, `/es`, `/pt-br`, `/fr`. */
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: {
    mode: "as-needed",
    prefixes: { "es-419": "/es", "pt-BR": "/pt-br", fr: "/fr" },
  },
  localeCookie: { name: LOCALE_COOKIE, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 },
});

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Maps Intl locale plus country to the formatting locale, e.g. en + NG → en-NG for "WAT". */
export function formattingLocale(locale: Locale, country: string | null | undefined): string {
  if (!country || !/^[A-Z]{2}$/.test(country)) return locale;
  if (locale === "en") return `en-${country}`;
  if (locale === "fr") return `fr-${country}`;
  return locale;
}
