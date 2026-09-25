import { api } from "@paycheck-router/shared";
import { Banner, Table } from "@paycheck-router/ui/components";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ProofLegCard } from "@/components/proof/proof-leg-card.tsx";
import { CONTENT_ID } from "@/components/skip-link.tsx";
import { fetchPublic } from "@/lib/api/public.ts";

/** Proof numbers come from the live API; OpenNext's static cache can't revalidate them. */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/proof">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "proof" });
  return {
    title: t("title"),
    description: t("lead"),
    openGraph: { images: [`/api/og?title=${encodeURIComponent(t("ogTitle"))}`] },
  };
}

function formatSeconds(seconds: number | null, locale: string): string {
  if (seconds === null) return "—";
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "second",
    maximumFractionDigits: 0,
  }).format(seconds);
}

export default async function ProofPage({ params }: PageProps<"/[locale]/proof">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("proof");
  const result = await fetchPublic("/proof", api.ProofResponse);

  return (
    <main id={CONTENT_ID} className="page stack-lg site-page">
      <header className="stack reading">
        <h1 className="pr-h1">{t("title")}</h1>
        <p className="pr-body-l pr-muted">{t("lead")}</p>
      </header>

      {!result.ok ? (
        <Banner tone="warn">{t("unavailable")}</Banner>
      ) : (
        <>
          {result.data.fork ? (
            <Banner tone="info">{t("forkNotice", { program: result.data.programId })}</Banner>
          ) : null}

          <section className="stack" aria-labelledby="canonical-title">
            <h2 id="canonical-title" className="pr-h2">
              {t("canonical")}
            </h2>
            {result.data.recentLegs[0] ? (
              <ProofLegCard leg={result.data.recentLegs[0]} linkToDetail />
            ) : (
              <p className="pr-body pr-muted">{t("noRuns")}</p>
            )}
          </section>

          <section className="stack" aria-labelledby="campaign-title">
            <h2 id="campaign-title" className="pr-h2">
              {t("campaign")}
            </h2>
            <Table
              caption={t("campaign")}
              columns={[
                { key: "metric", header: t("metric"), cell: (row: [string, string]) => row[0] },
                {
                  key: "value",
                  header: t("value"),
                  numeric: true,
                  cell: (row: [string, string]) => row[1],
                },
              ]}
              rows={[
                [t("paychecks"), String(result.data.campaign.paychecks)],
                [t("slicesExecuted"), String(result.data.campaign.slicesExecuted)],
                [t("slicesVerified"), String(result.data.campaign.slicesVerified)],
                [
                  t("medianToShares"),
                  formatSeconds(result.data.campaign.medianSecondsToShares, locale),
                ],
                ...Object.entries(result.data.campaign.waitsByReason).map(
                  ([reason, count]): [string, string] => [t("waits", { reason }), String(count)],
                ),
              ]}
              rowKey={(row) => row[0]}
            />
          </section>

          {result.data.recentLegs.length > 1 ? (
            <section className="stack" aria-labelledby="recent-title">
              <h2 id="recent-title" className="pr-h2">
                {t("recent")}
              </h2>
              <ul className="card-list">
                {result.data.recentLegs.slice(1).map((leg) => (
                  <li key={leg.signature}>
                    <ProofLegCard leg={leg} linkToDetail />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="stack reading" aria-labelledby="verify-title">
            <h2 id="verify-title" className="pr-h2">
              {t("verifyTitle")}
            </h2>
            <p className="pr-body">{t("verifyBody")}</p>
            <pre className="pr-code logs">npx @paycheck-router/verify &lt;signature&gt;</pre>
            <pre className="pr-code logs">
              npx @paycheck-router/verify --bundle evidence/stocklana-fork
            </pre>
            <p className="pr-small pr-muted">
              {t("programId", { program: result.data.programId })}
            </p>
          </section>
        </>
      )}

      <section className="stack reading" aria-labelledby="mislead-title">
        <h2 id="mislead-title" className="pr-h2">
          {t("misleadTitle")}
        </h2>
        <ul className="stack bullet-list">
          <li className="pr-body">{t("mislead.sample")}</li>
          <li className="pr-body">{t("mislead.funding")}</li>
          <li className="pr-body">{t("mislead.market")}</li>
          <li className="pr-body">{t("mislead.fork")}</li>
        </ul>
      </section>
    </main>
  );
}
