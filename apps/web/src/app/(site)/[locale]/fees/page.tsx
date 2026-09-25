import { LAUNCH_CONFIG } from "@paycheck-router/shared";
import { Table } from "@paycheck-router/ui/components";
import { formatPercent } from "@paycheck-router/ui/format";
import type { Metadata } from "next";
import { ContentPage } from "@/components/site/content-page.tsx";
import { pageMetadata, pageTranslations, sectionsFrom } from "@/lib/site-page.ts";

const ROUTES = ["router", "cex", "manual"] as const;

export async function generateMetadata({ params }: PageProps<"/[locale]/fees">): Promise<Metadata> {
  return pageMetadata((await params).locale, "fees");
}

export default async function FeesPage({ params }: PageProps<"/[locale]/fees">) {
  const { locale } = await params;
  const t = await pageTranslations(locale, "fees");
  const fee = formatPercent(LAUNCH_CONFIG.feeBps, locale, 2);
  return (
    <ContentPage
      title={t("title")}
      lead={t("lead", { fee })}
      sections={sectionsFrom(t, ["slice", "network", "partner"])}
    >
      <section className="stack" aria-labelledby="compare-title">
        <h2 id="compare-title" className="pr-h2">
          {t("compareTitle")}
        </h2>
        <Table
          caption={t("compareTitle")}
          columns={[
            {
              key: "route",
              header: t("columns.route"),
              cell: (key: string) => t(`routes.${key}.name`),
            },
            {
              key: "cost",
              header: t("columns.cost"),
              cell: (key: string) => t(`routes.${key}.cost`, { fee }),
            },
            {
              key: "steps",
              header: t("columns.steps"),
              cell: (key: string) => t(`routes.${key}.steps`),
            },
            {
              key: "guard",
              header: t("columns.guard"),
              cell: (key: string) => t(`routes.${key}.guard`),
            },
          ]}
          rows={ROUTES}
          rowKey={(key) => key}
        />
        <p className="pr-small pr-muted">{t("source")}</p>
      </section>
    </ContentPage>
  );
}
