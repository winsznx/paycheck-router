import { api } from "@paycheck-router/shared";
import { buttonClassName } from "@paycheck-router/ui/components";
import { formatPremiumBps, formatTimestamp } from "@paycheck-router/ui/format";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { CSSProperties } from "react";
import { AssetStrip, pythPrice } from "@/components/site/asset-strip.tsx";
import { Calculator, type CalculatorAsset } from "@/components/site/calculator.tsx";
import { CanonicalRun } from "@/components/site/canonical-run.tsx";
import { PreStocksStrip } from "@/components/site/prestocks-strip.tsx";
import { START_HREF } from "@/components/site/site-header.tsx";
import { WaitlistForm } from "@/components/site/waitlist-form.tsx";
import { CONTENT_ID } from "@/components/skip-link.tsx";
import { Link } from "@/i18n/navigation.ts";
import { fetchPublic } from "@/lib/api/public.ts";
import { mainnetDeployed } from "@/lib/env.ts";
import { priceE9 } from "@/lib/money.ts";
import { allPresetLegs } from "@/lib/presets.ts";
import { fetchPreStocks } from "@/lib/prestocks.ts";

/** Live Pyth prices, PreStocks marks and proof numbers are read on every request. */
export const dynamic = "force-dynamic";

const GAP_FACTS = [
  ["stays", "https://www.spark.money/research/stablecoin-payroll-direct-deposit"],
  [
    "cex",
    "https://www.mariblock.com/stories/luno-expands-access-to-tokenized-us-stocks-to-nigeria",
  ],
  [
    "drift",
    "https://finance.yahoo.com/markets/crypto/articles/weekend-chain-prices-monday-don-183331035.html",
  ],
] as const;

const OWN_CARDS = ["index", "bigTech", "preIpo", "cashOut", "payroll"] as const;
const FAQ = ["custody", "cost", "countries", "weekends", "tokens", "stop"] as const;

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    title: { absolute: t("title") },
    alternates: {
      languages: { en: "/", "es-419": "/es", "pt-BR": "/pt-br", fr: "/fr" },
    },
  };
}

export default async function LandingPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, assets, proof, prestocks] = await Promise.all([
    getTranslations("landing"),
    fetchPublic("/assets", api.AssetsResponse),
    fetchPublic("/proof", api.ProofResponse),
    fetchPreStocks(),
  ]);

  const calculatorAssets: CalculatorAsset[] = [
    ...(assets.ok
      ? assets.data.assets.map((a) => ({
          mint: a.mint,
          symbol: a.symbol,
          price: a.kind === "pre_ipo" ? priceE9(a.onchainPriceE9) : pythPrice(a.reference),
        }))
      : []),
    ...(prestocks?.quotes ?? []).map((q) => ({
      mint: q.mint,
      symbol: q.name,
      price: q.tokenPrice,
    })),
  ];
  const openAi = prestocks?.quotes.find((q) => q.name.startsWith("OpenAI"));
  const faqJson = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((key) => ({
      "@type": "Question",
      name: t(`faq.${key}.q`),
      acceptedAnswer: { "@type": "Answer", text: t(`faq.${key}.a`) },
    })),
  };

  return (
    <main id={CONTENT_ID} className="landing">
      <section className="page landing-hero" aria-labelledby="hero-title">
        <div className="stack-lg">
          <p className="pr-label pr-muted">{t("heroLabel")}</p>
          <h1 id="hero-title" className="pr-display">
            {t("heroTitle")}
          </h1>
          <p className="pr-body-l pr-muted reading">{t("heroBody")}</p>
          <div className="row">
            <a href={START_HREF} className={buttonClassName({ size: "l" })}>
              {mainnetDeployed ? t("start") : t("joinWaitlist")}
            </a>
            <Link href="/proof" className={buttonClassName({ variant: "secondary", size: "l" })}>
              {mainnetDeployed ? t("seeRealPaycheck") : t("seeForkRun")}
            </Link>
          </div>
          <ul className="trust-strip">
            {(["custody", "pyth", "verifiable", "fee"] as const).map((key) => (
              <li key={key} className="pr-small">
                {t(`trust.${key}`)}
              </li>
            ))}
          </ul>
        </div>
        <div className="stack">
          {proof.ok && proof.data.recentLegs.length > 0 ? (
            <CanonicalRun proof={proof.data} />
          ) : (
            <div className="pr-card welcome-motif" aria-hidden="true">
              <div className="welcome-motif__paycheck" />
              <div className="welcome-motif__split">
                {[6, 3, 1].map((grow, index) => (
                  <div
                    key={grow}
                    className="welcome-motif__seg"
                    style={
                      { flexGrow: grow, "--seg": `var(--series-${index + 1})` } as CSSProperties
                    }
                  >
                    <span className="welcome-motif__fill" />
                  </div>
                ))}
              </div>
            </div>
          )}
          {!mainnetDeployed ? <p className="pr-small pr-muted">{t("forkRunLabel")}</p> : null}
        </div>
      </section>

      <section className="page landing-section stack-lg" aria-labelledby="gap-title">
        <h2 id="gap-title" className="pr-h1 reading">
          {t("gapTitle")}
        </h2>
        <ul className="fact-grid">
          {GAP_FACTS.map(([key, source]) => (
            <li key={key} className="pr-card stack">
              <p className="pr-body-l">{t(`gap.${key}`)}</p>
              <a href={source} className="pr-small" rel="noreferrer">
                {t(`gapSource.${key}`)}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="page landing-section stack-lg" aria-labelledby="how-title">
        <h2 id="how-title" className="pr-h1 reading">
          {t("howTitle")}
        </h2>
        <ol className="step-grid">
          {(["point", "pick", "watch"] as const).map((key, index) => (
            <li key={key} className="stack">
              <span className="pr-num-xl" aria-hidden="true">
                {index + 1}
              </span>
              <h3 className="pr-h3">{t(`steps.${key}.title`)}</h3>
              <p className="pr-body pr-muted">{t(`steps.${key}.body`)}</p>
            </li>
          ))}
        </ol>
        <section className="stack" aria-labelledby="calc-title" id="calculator">
          <h3 id="calc-title" className="pr-h2">
            {t("calculatorTitle")}
          </h3>
          <Calculator assets={calculatorAssets} presets={allPresetLegs()} />
        </section>
      </section>

      <section className="page landing-section stack-lg" aria-labelledby="own-title">
        <h2 id="own-title" className="pr-h1 reading">
          {t("ownTitle")}
        </h2>
        <ul className="fact-grid">
          {OWN_CARDS.map((key) => (
            <li key={key} className="pr-card stack">
              <h3 className="pr-h3">{t(`own.${key}.title`)}</h3>
              <p className="pr-body pr-muted">{t(`own.${key}.body`)}</p>
            </li>
          ))}
        </ul>
        <AssetStrip assets={assets.ok ? assets.data : null} />
        <PreStocksStrip snapshot={prestocks} />
        <p>
          <Link href="/assets" className={buttonClassName({ variant: "secondary" })}>
            {t("browseAssets")}
          </Link>
        </p>
      </section>

      <section className="page landing-section stack-lg" aria-labelledby="proof-title">
        <h2 id="proof-title" className="pr-h1 reading">
          {t("proofTitle")}
        </h2>
        {openAi && prestocks ? (
          <p className="pr-body-l reading">
            {t("openAiLive", {
              premium: formatPremiumBps(openAi.premiumBps, locale).replace("+", ""),
              direction: openAi.premiumBps > 0 ? "above" : "below",
              time: formatTimestamp(prestocks.fetchedAt, locale, "UTC"),
            })}
          </p>
        ) : null}
        {proof.ok ? (
          <dl className="totals">
            <div>
              <dt className="pr-small pr-muted">{t("campaign.paychecks")}</dt>
              <dd className="pr-num-xl">{proof.data.campaign.paychecks}</dd>
            </div>
            <div>
              <dt className="pr-small pr-muted">{t("campaign.executed")}</dt>
              <dd className="pr-num-xl">{proof.data.campaign.slicesExecuted}</dd>
            </div>
            <div>
              <dt className="pr-small pr-muted">{t("campaign.verified")}</dt>
              <dd className="pr-num-xl">{proof.data.campaign.slicesVerified}</dd>
            </div>
          </dl>
        ) : null}
        <p className="pr-body pr-muted reading">{t("keys")}</p>
        <p>
          <Link href="/proof" className={buttonClassName({ variant: "secondary" })}>
            {t("openProof")}
          </Link>
        </p>
      </section>

      <section
        className="page landing-section stack-lg"
        aria-labelledby="start-title"
        id="waitlist"
      >
        <h2 id="start-title" className="pr-h1 reading">
          {t("startTitle")}
        </h2>
        <div className="landing-start">
          {mainnetDeployed ? (
            <a href={START_HREF} className={buttonClassName({ size: "l" })}>
              {t("start")}
            </a>
          ) : (
            <div className="stack">
              <p className="pr-body pr-muted">{t("waitlistLead")}</p>
              <WaitlistForm source="landing" />
            </div>
          )}
          <div className="stack">
            <h3 className="pr-h2">{t("faqTitle")}</h3>
            {FAQ.map((key) => (
              <details key={key} className="faq">
                <summary className="pr-h3">{t(`faq.${key}.q`)}</summary>
                <p className="pr-body pr-muted">{t(`faq.${key}.a`)}</p>
              </details>
            ))}
            <p>
              <Link href="/partners">{t("forPayroll")}</Link>
            </p>
          </div>
        </div>
      </section>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD built from our own messages
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJson).replace(/</g, "\\u003c") }}
      />
    </main>
  );
}
