import { api } from "@paycheck-router/shared";
import { Banner, StatusChip } from "@paycheck-router/ui/components";
import { formatTimestamp } from "@paycheck-router/ui/format";
import type { Metadata } from "next";
import { CONTENT_ID } from "@/components/skip-link.tsx";
import { fetchPublic } from "@/lib/api/public.ts";
import { pageMetadata, pageTranslations } from "@/lib/site-page.ts";

export const dynamic = "force-dynamic";

const CHIP = {
  operational: "verified",
  degraded: "waiting",
  down: "unverified",
  unknown: "pending",
} as const;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/status">): Promise<Metadata> {
  return pageMetadata((await params).locale, "status");
}

/** PRD 26.3: live component health, refreshed on every visit. */
export default async function StatusPage({ params }: PageProps<"/[locale]/status">) {
  const { locale } = await params;
  const [t, result] = await Promise.all([
    pageTranslations(locale, "status"),
    fetchPublic("/status", api.StatusResponse, 60),
  ]);
  return (
    <main id={CONTENT_ID} className="page site-page stack-lg">
      <header className="stack reading">
        <h1 className="pr-h1">{t("title")}</h1>
        <p className="pr-body-l pr-muted">{t("lead")}</p>
      </header>
      {result.ok ? (
        <>
          <ul className="card-list">
            {result.data.components.map((component) => (
              <li key={component.id} className="pr-card status-row">
                <h2 className="pr-h3">{t(`components.${component.id}`)}</h2>
                <StatusChip
                  status={CHIP[component.status]}
                  label={t(`health.${component.status}`)}
                />
                <p className="pr-small pr-muted">{component.detail}</p>
              </li>
            ))}
          </ul>
          <p className="pr-small pr-muted">
            {t("asOf", {
              environment: result.data.environment,
              time: formatTimestamp(result.data.asOf, locale, "UTC"),
            })}
          </p>
        </>
      ) : (
        <Banner tone="danger">{t("unreachable")}</Banner>
      )}
    </main>
  );
}
