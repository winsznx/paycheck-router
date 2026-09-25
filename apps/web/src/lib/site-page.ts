import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ContentSection } from "@/components/site/content-page.tsx";

/** Namespaces of the long-form public pages under `pages.*` in the message catalogs. */
export type PageNamespace =
  | "howItWorks"
  | "security"
  | "fees"
  | "help"
  | "partners"
  | "terms"
  | "risk"
  | "privacy"
  | "restricted"
  | "status"
  | "assets";

export async function pageTranslations(locale: string, page: PageNamespace) {
  setRequestLocale(locale);
  return getTranslations({ locale, namespace: `pages.${page}` });
}

export async function pageMetadata(locale: string, page: PageNamespace): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: `pages.${page}` });
  const title = t("title");
  return {
    title,
    description: t("lead"),
    openGraph: { title, images: [`/api/og?title=${encodeURIComponent(title)}`] },
  };
}

type Translator = Awaited<ReturnType<typeof pageTranslations>>;

export function sectionsFrom(t: Translator, keys: readonly string[]): ContentSection[] {
  return keys.map((key) => ({
    key,
    title: t(`sections.${key}.title`),
    body: t(`sections.${key}.body`),
  }));
}
