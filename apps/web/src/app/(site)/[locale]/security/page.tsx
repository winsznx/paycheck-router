import { PROGRAM_ID } from "@paycheck-router/shared";
import { Table } from "@paycheck-router/ui/components";
import type { Metadata } from "next";
import { ContentPage } from "@/components/site/content-page.tsx";
import { pageMetadata, pageTranslations, sectionsFrom } from "@/lib/site-page.ts";

const ACTORS = [
  "worker",
  "upgrade",
  "admin",
  "guardian",
  "crank",
  "recorder",
  "attester",
  "sponsor",
  "jupiter",
  "pyth",
] as const;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/security">): Promise<Metadata> {
  return pageMetadata((await params).locale, "security");
}

export default async function SecurityPage({ params }: PageProps<"/[locale]/security">) {
  const { locale } = await params;
  const t = await pageTranslations(locale, "security");
  const sections = sectionsFrom(t, ["custody", "program", "audit", "bounty", "incidents"]);
  const program = sections.find((s) => s.key === "program");
  if (program) {
    program.extra = (
      <p className="pr-code logs" translate="no">
        {PROGRAM_ID}
      </p>
    );
  }
  return (
    <ContentPage title={t("title")} lead={t("lead")} sections={sections}>
      <section className="stack" aria-labelledby="trust-title">
        <h2 id="trust-title" className="pr-h2">
          {t("tableTitle")}
        </h2>
        <Table
          caption={t("tableTitle")}
          columns={[
            {
              key: "actor",
              header: t("columns.actor"),
              cell: (key: string) => t(`actors.${key}.name`),
            },
            { key: "can", header: t("columns.can"), cell: (key: string) => t(`actors.${key}.can`) },
            {
              key: "cannot",
              header: t("columns.cannot"),
              cell: (key: string) => t(`actors.${key}.cannot`),
            },
          ]}
          rows={ACTORS}
          rowKey={(key) => key}
        />
      </section>
    </ContentPage>
  );
}
