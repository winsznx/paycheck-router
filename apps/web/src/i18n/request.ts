import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { negotiateAppLocale } from "./negotiate.ts";
import { isLocale, LOCALE_COOKIE, type Locale } from "./routing.ts";

async function resolveLocale(requested: string | undefined): Promise<Locale> {
  if (isLocale(requested)) return requested;
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return negotiateAppLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
    country: headerStore.get("cf-ipcountry"),
  });
}

/**
 * Public pages carry the locale in the path (`[locale]` segment). `/app` and `/admin` have no
 * prefix, so their locale comes from the user setting, Accept-Language, then country.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const locale = await resolveLocale(await requestLocale);
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
