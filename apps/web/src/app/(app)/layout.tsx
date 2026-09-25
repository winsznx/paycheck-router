import "@paycheck-router/ui/tokens.css";
import "@paycheck-router/ui/components.css";
import "../globals.css";
import "../app-shell.css";
import "../showcase.css";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { AppRuntime } from "@/components/app/app-runtime.tsx";
import { Prelaunch } from "@/components/app/prelaunch.tsx";
import { Document } from "@/components/document.tsx";
import { appOpen, siteUrl } from "@/lib/env.ts";
import { readDisplayPreferences } from "@/lib/preferences.ts";

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    metadataBase: new URL(siteUrl),
    title: { default: t("siteName"), template: `%s · ${t("siteName")}` },
    description: t("description"),
    applicationName: t("siteName"),
    robots: { index: false, follow: false },
    appleWebApp: { capable: true, title: t("shortName"), statusBarStyle: "black-translucent" },
  };
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const [locale, preferences] = await Promise.all([getLocale(), readDisplayPreferences()]);
  return (
    <Document
      locale={locale}
      surface="app"
      theme={preferences.theme}
      motion={preferences.motion}
      dataSaver={preferences.dataSaver}
    >
      <NextIntlClientProvider>
        {appOpen ? <AppRuntime>{children}</AppRuntime> : <Prelaunch />}
      </NextIntlClientProvider>
    </Document>
  );
}
