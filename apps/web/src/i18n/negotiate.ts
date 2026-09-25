import { defaultLocale, isLocale, type Locale, locales } from "./routing.ts";

const COUNTRY_LOCALE: Readonly<Record<string, Locale>> = {
  BR: "pt-BR",
  AR: "es-419",
  MX: "es-419",
  CO: "es-419",
  CL: "es-419",
  PE: "es-419",
  UY: "es-419",
  EC: "es-419",
  FR: "fr",
  SN: "fr",
  CI: "fr",
  CM: "fr",
  ML: "fr",
  BF: "fr",
  NE: "fr",
  TG: "fr",
  BJ: "fr",
  GA: "fr",
  CD: "fr",
  CG: "fr",
};

function fromLanguageTag(tag: string): Locale | undefined {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) return undefined;
  const exact = locales.find((l) => l.toLowerCase() === normalized);
  if (exact) return exact;
  if (normalized.startsWith("pt")) return "pt-BR";
  if (normalized.startsWith("es")) return "es-419";
  if (normalized.startsWith("fr")) return "fr";
  if (normalized.startsWith("en")) return "en";
  return undefined;
}

/** Highest-q supported language in an Accept-Language header. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | undefined {
  if (!header) return undefined;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag, q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((entry) => Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const locale = fromLanguageTag(tag);
    if (locale) return locale;
  }
  return undefined;
}

/** PRD 17.2: user setting, then Accept-Language, then the Cloudflare country. */
export function negotiateAppLocale(input: {
  cookie: string | undefined;
  acceptLanguage: string | null;
  country: string | null;
}): Locale {
  if (isLocale(input.cookie)) return input.cookie;
  return (
    localeFromAcceptLanguage(input.acceptLanguage) ??
    (input.country ? COUNTRY_LOCALE[input.country.toUpperCase()] : undefined) ??
    defaultLocale
  );
}
