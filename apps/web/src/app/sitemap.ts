import { REGISTRY } from "@paycheck-router/shared";
import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/env.ts";

const PATHS = [
  "",
  "/how-it-works",
  "/assets",
  "/proof",
  "/security",
  "/fees",
  "/status",
  "/help",
  "/partners",
  "/legal/terms",
  "/legal/risk",
  "/legal/privacy",
  "/legal/restricted-countries",
  ...REGISTRY.map((asset) => `/assets/${asset.symbol}`),
];

/** PRD 18.1 SEO: every public page with hreflang alternates for the four locales. */
export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((path) => ({
    url: `${siteUrl}${path || "/"}`,
    alternates: {
      languages: {
        en: `${siteUrl}${path || "/"}`,
        "es-419": `${siteUrl}/es${path}`,
        "pt-BR": `${siteUrl}/pt-br${path}`,
        fr: `${siteUrl}/fr${path}`,
      },
    },
  }));
}
