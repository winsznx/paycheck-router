import { api } from "@paycheck-router/shared";
import { Banner, Table } from "@paycheck-router/ui/components";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChainValue } from "@/components/chain-value.tsx";
import { ProofLegCard } from "@/components/proof/proof-leg-card.tsx";
import { CountUp } from "@/components/site/count-up.tsx";
import { HeroPhone } from "@/components/site/hero-phone.tsx";
import { CONTENT_ID } from "@/components/skip-link.tsx";
import { fetchPublic } from "@/lib/api/public.ts";
import { canonicalPaycheck } from "@/lib/canonical.ts";

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
  const canonical = result.ok ? canonicalPaycheck(result.data) : null;

  return (
    <main id={CONTENT_ID} className="site-page">
      <section className="page landing-hero" aria-labelledby="proof-title">
        <div className="landing-hero__copy">
          <h1 id="proof-title" className="landing-title">
            {t("title")}
          </h1>
          <p className="landing-lead">{t("lead")}</p>
          {result.ok && result.data.fork ? <Banner tone="info">{t("forkNotice")}</Banner> : null}
        </div>
        {canonical ? <HeroPhone paycheck={canonical} /> : null}
      </section>

      {!result.ok ? (
        <div className="page">
          <Banner tone="warn">{t("unavailable")}</Banner>
        </div>
      ) : (
        <>
          <section className="page landing-section" aria-labelledby="canonical-title">
            <h2 id="canonical-title" className="section-title">
              {t("canonical")}
            </h2>
            {result.data.recentLegs[0] ? (
              <ProofLegCard leg={result.data.recentLegs[0]} linkToDetail />
            ) : (
              <p className="pr-body pr-muted">{t("noRuns")}</p>
            )}
          </section>

          <section className="page landing-section" aria-labelledby="campaign-title">
            <h2 id="campaign-title" className="section-title">
              {t("campaign")}
            </h2>
            <dl className="proof-stats">
              <div>
                <dt>{t("paychecks")}</dt>
                <dd>
                  <CountUp value={result.data.campaign.paychecks} format="integer" />
                </dd>
              </div>
              <div>
                <dt>{t("slicesExecuted")}</dt>
                <dd>
                  <CountUp value={result.data.campaign.slicesExecuted} format="integer" />
                </dd>
              </div>
              <div>
                <dt>{t("slicesVerified")}</dt>
                <dd>
                  <CountUp value={result.data.campaign.slicesVerified} format="integer" />
                </dd>
              </div>
            </dl>
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
            <section className="page landing-section" aria-labelledby="recent-title">
              <h2 id="recent-title" className="section-title">
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

          <section className="page landing-section" aria-labelledby="verify-title">
            <h2 id="verify-title" className="section-title">
              {t("verifyTitle")}
            </h2>
            <div className="stack reading">
              <p className="landing-lead">{t("verifyBody")}</p>
              <pre className="pr-code logs">npx @paycheck-router/verify &lt;signature&gt;</pre>
              <pre className="pr-code logs">
                npx @paycheck-router/verify --bundle evidence/stocklana-fork
              </pre>
              <p className="row pr-small">
                <span className="pr-muted">{t("programId")}</span>
                <ChainValue kind="own-program" value={result.data.programId} display="full" />
              </p>
            </div>
          </section>
        </>
      )}

      <section className="page landing-section" aria-labelledby="mislead-title">
        <h2 id="mislead-title" className="section-title">
          {t("misleadTitle")}
        </h2>
        <ul className="stack bullet-list reading">
          <li className="pr-body">{t("mislead.sample")}</li>
          <li className="pr-body">{t("mislead.funding")}</li>
          <li className="pr-body">{t("mislead.market")}</li>
          <li className="pr-body">{t("mislead.fork")}</li>
        </ul>
      </section>
    </main>
  );
}
