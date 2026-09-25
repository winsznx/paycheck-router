import type { Metadata } from "next";
import { ContentPage } from "@/components/site/content-page.tsx";
import { WaitlistForm } from "@/components/site/waitlist-form.tsx";
import { pageMetadata, pageTranslations, sectionsFrom } from "@/lib/site-page.ts";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/partners">): Promise<Metadata> {
  return pageMetadata((await params).locale, "partners");
}

export default async function PartnersPage({ params }: PageProps<"/[locale]/partners">) {
  const { locale } = await params;
  const t = await pageTranslations(locale, "partners");
  return (
    <ContentPage
      title={t("title")}
      lead={t("lead")}
      sections={sectionsFrom(t, ["benefit", "custody", "invites", "webhooks", "sponsored"])}
    >
      <section className="stack reading" aria-labelledby="join-title" id="join">
        <h2 id="join-title" className="pr-h2">
          {t("joinTitle")}
        </h2>
        <p className="pr-body pr-muted">{t("joinBody")}</p>
        <WaitlistForm source="partners" />
      </section>
    </ContentPage>
  );
}
