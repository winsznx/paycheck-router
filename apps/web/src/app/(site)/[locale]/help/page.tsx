import type { Metadata } from "next";
import { ContentPage } from "@/components/site/content-page.tsx";
import { pageMetadata, pageTranslations, sectionsFrom } from "@/lib/site-page.ts";

/** Payout guides link to each platform's own site; names are plain factual references (PRD 21.4). */
const PLATFORMS = [
  ["deel", "https://www.deel.com"],
  ["rise", "https://www.riseworks.io"],
  ["toku", "https://www.toku.com"],
  ["bitwage", "https://www.bitwage.com"],
] as const;

const FAQ = ["custody", "cost", "weekends", "wait", "stop", "tax"] as const;

export async function generateMetadata({ params }: PageProps<"/[locale]/help">): Promise<Metadata> {
  return pageMetadata((await params).locale, "help");
}

export default async function HelpPage({ params }: PageProps<"/[locale]/help">) {
  const { locale } = await params;
  const t = await pageTranslations(locale, "help");
  const sections = sectionsFrom(t, ["payout", "direct"]);
  const payout = sections.find((s) => s.key === "payout");
  if (payout) {
    payout.extra = (
      <ul className="stack">
        {PLATFORMS.map(([key, url]) => (
          <li key={key} className="pr-card stack">
            <h3 className="pr-h3">{t(`platforms.${key}.name`)}</h3>
            <p className="pr-body">{t(`platforms.${key}.steps`)}</p>
            <a href={url} rel="noreferrer">
              {t("platformLink", { platform: t(`platforms.${key}.name`) })}
            </a>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ContentPage title={t("title")} lead={t("lead")} sections={sections}>
      <section className="stack reading" aria-labelledby="faq-title">
        <h2 id="faq-title" className="pr-h2">
          {t("faqTitle")}
        </h2>
        {FAQ.map((key) => (
          <details key={key} className="faq">
            <summary className="pr-h3">{t(`faq.${key}.q`)}</summary>
            <p className="pr-body pr-muted">{t(`faq.${key}.a`)}</p>
          </details>
        ))}
      </section>
    </ContentPage>
  );
}
