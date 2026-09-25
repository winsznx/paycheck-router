import { formatPremiumBps, formatTimestamp } from "@paycheck-router/ui/format";
import type { Metadata } from "next";
import { ContentPage } from "@/components/site/content-page.tsx";
import { fetchPreStocks } from "@/lib/prestocks.ts";
import { pageMetadata, pageTranslations, sectionsFrom } from "@/lib/site-page.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/how-it-works">): Promise<Metadata> {
  return pageMetadata((await params).locale, "howItWorks");
}

export default async function HowItWorksPage({ params }: PageProps<"/[locale]/how-it-works">) {
  const { locale } = await params;
  const [t, prestocks] = await Promise.all([
    pageTranslations(locale, "howItWorks"),
    fetchPreStocks(),
  ]);
  const openAi = prestocks?.quotes.find((q) => q.name.startsWith("OpenAI"));
  const sections = sectionsFrom(t, ["lifecycle", "guard", "weekends", "allowance", "revoke"]);
  const guard = sections.find((s) => s.key === "guard");
  if (guard && openAi && prestocks) {
    guard.extra = (
      <p className="pr-body pr-card">
        {t("liveExample", {
          premium: formatPremiumBps(openAi.premiumBps, locale),
          time: formatTimestamp(prestocks.fetchedAt, locale, "UTC"),
          outcome: openAi.premiumBps > 300 ? "wait" : "buy",
        })}
      </p>
    );
  }
  return <ContentPage title={t("title")} lead={t("lead")} sections={sections} />;
}
