import { AssetKind, api, REGISTRY, USDC_MINT } from "@paycheck-router/shared";
import { AssetIcon, AssetIconStack, buttonClassName } from "@paycheck-router/ui/components";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AssetStrip, pythPrice } from "@/components/site/asset-strip.tsx";
import { Calculator, type CalculatorAsset } from "@/components/site/calculator.tsx";
import { CountUp } from "@/components/site/count-up.tsx";
import { HeroPhone } from "@/components/site/hero-phone.tsx";
import { HowPanel } from "@/components/site/how-panel.tsx";
import { type HowStep, HowStepper } from "@/components/site/how-stepper.tsx";
import { LiveQuote } from "@/components/site/live-quote.tsx";
import { PreStocksStrip } from "@/components/site/prestocks-strip.tsx";
import { START_HREF } from "@/components/site/site-header.tsx";
import { Waitlist } from "@/components/site/waitlist.tsx";
import { CONTENT_ID } from "@/components/skip-link.tsx";
import { Link } from "@/i18n/navigation.ts";
import { fetchPublic } from "@/lib/api/public.ts";
import { canonicalPaycheck } from "@/lib/canonical.ts";
import { hostedDemoUrl, mainnetDeployed } from "@/lib/env.ts";
import { priceE9, usdc } from "@/lib/money.ts";
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

const FAQ = ["custody", "cost", "countries", "weekends", "tokens", "stop"] as const;

const bySymbols = (...symbols: string[]) =>
  symbols.flatMap((symbol) => REGISTRY.find((a) => a.symbol === symbol)?.mint ?? []);

/** The featured card first, then the others; each shows the assets it's about. */
const OWN_CARDS = [
  ["index", bySymbols("SPYx", "QQQx")],
  ["bigTech", bySymbols("NVDAx", "AAPLx", "MSFTx", "GOOGLx", "AMZNx", "METAx", "TSLAx")],
  ["cashOut", [USDC_MINT]],
  ["payroll", [USDC_MINT]],
] as const;

const PRE_IPO_MINTS = REGISTRY.filter((a) => a.kind === AssetKind.preIpo).map((a) => a.mint);

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
  const canonical = proof.ok ? canonicalPaycheck(proof.data) : null;
  const openAi = prestocks?.quotes.find((q) => q.name.startsWith("OpenAI"));
  const waits = proof.ok
    ? Object.values(proof.data.campaign.waitsByReason).reduce((sum, n) => sum + n, 0)
    : 0;
  const faqJson = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((key) => ({
      "@type": "Question",
      name: t(`faq.${key}.q`),
      acceptedAnswer: { "@type": "Answer", text: t(`faq.${key}.a`) },
    })),
  };

  const steps: HowStep[] = (["point", "pick", "watch"] as const).map((key) => ({
    key,
    title: t(`steps.${key}.title`),
    body: t(`steps.${key}.body`),
    panel: canonical ? <HowPanel step={key} paycheck={canonical} /> : null,
  }));

  return (
    <main id={CONTENT_ID} className="landing">
      <section className="page landing-hero" aria-labelledby="hero-title">
        <div className="landing-hero__copy">
          <p className="landing-audience">{t("heroLabel")}</p>
          <h1 id="hero-title" className="landing-title">
            {t("heroTitle")}
          </h1>
          <p className="landing-lead">{t("heroBody")}</p>
          <div className="row">
            {hostedDemoUrl ? (
              <a href={hostedDemoUrl} className={buttonClassName({ size: "l" })}>
                {t("tryFork")}
              </a>
            ) : null}
            <a
              href={START_HREF}
              className={buttonClassName({
                variant: hostedDemoUrl ? "secondary" : "primary",
                size: "l",
              })}
            >
              {mainnetDeployed ? t("start") : t("joinWaitlist")}
            </a>
            <Link
              href="/proof"
              className={buttonClassName({
                variant: hostedDemoUrl ? "ghost" : "secondary",
                size: "l",
              })}
            >
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
        {canonical ? (
          <HeroPhone paycheck={canonical} />
        ) : (
          <p className="pr-body pr-muted">{t("forkRunLabel")}</p>
        )}
      </section>

      <section className="page logo-band" aria-labelledby="logos-title">
        <h2 id="logos-title" className="logo-band__title">
          {t("logosTitle", { count: REGISTRY.length })}
        </h2>
        <ul className="logo-band__list">
          {REGISTRY.map((asset) => (
            <li key={asset.mint}>
              <Link href={`/assets/${asset.symbol}`} className="logo-band__item">
                <AssetIcon asset={asset.mint} size="lg" decorative />
                <span translate="no">{asset.symbol}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="page landing-section" aria-labelledby="gap-title">
        <div className="split-heading">
          <h2 id="gap-title" className="section-title">
            {t("gapTitle")}
          </h2>
          <p className="landing-lead">{t("gapLead")}</p>
        </div>
        <ul className="fact-grid">
          {GAP_FACTS.map(([key, source]) => (
            <li key={key} className="fact-card">
              <p className="pr-body-l">{t(`gap.${key}`)}</p>
              <a href={source} className="pr-small" rel="noreferrer">
                {t(`gapSource.${key}`)}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="page landing-section" aria-labelledby="how-title">
        <div className="split-heading">
          <h2 id="how-title" className="section-title">
            {t("howTitle")}
          </h2>
          <p className="landing-lead">{t(canonical ? "howLead" : "howLeadNoRun")}</p>
        </div>
        <HowStepper steps={steps} label={t("howTitle")} />
        <section className="stack-lg calculator-block" aria-labelledby="calc-title" id="calculator">
          <h3 id="calc-title" className="pr-h2">
            {t("calculatorTitle")}
          </h3>
          <Calculator assets={calculatorAssets} presets={allPresetLegs()} />
        </section>
      </section>

      <section className="page landing-section" aria-labelledby="own-title">
        <div className="split-heading">
          <h2 id="own-title" className="section-title">
            {t("ownTitle")}
          </h2>
          <p className="landing-lead">{t("ownLead")}</p>
        </div>
        <ul className="own-grid">
          <li className="own-card own-card--featured">
            <AssetIconStack assets={PRE_IPO_MINTS} size="md" />
            <h3 className="pr-h2">{t("own.preIpo.title")}</h3>
            <p className="pr-body">{t("own.preIpo.body")}</p>
            {openAi && prestocks ? (
              <LiveQuote quote={openAi} fetchedAt={prestocks.fetchedAt} />
            ) : null}
          </li>
          {OWN_CARDS.map(([key, mints]) => (
            <li key={key} className="own-card">
              <AssetIconStack assets={mints} size="sm" />
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

      <section className="page landing-section" aria-labelledby="proof-title">
        <div className="split-heading">
          <h2 id="proof-title" className="section-title">
            {t("proofTitle")}
          </h2>
          <p className="landing-lead">{t("keys")}</p>
        </div>
        {proof.ok ? (
          <dl className="proof-stats">
            {canonical ? (
              <div>
                <dt>{t("campaign.inflow")}</dt>
                <dd>
                  <CountUp value={Number(usdc(canonical.inflow))} format="usd" />
                </dd>
              </div>
            ) : null}
            <div>
              <dt>{t("campaign.paychecks")}</dt>
              <dd>
                <CountUp value={proof.data.campaign.paychecks} format="integer" />
              </dd>
            </div>
            <div>
              <dt>{t("campaign.executed")}</dt>
              <dd>
                <CountUp value={proof.data.campaign.slicesExecuted} format="integer" />
              </dd>
            </div>
            <div>
              <dt>{t("campaign.verified")}</dt>
              <dd>
                <CountUp value={proof.data.campaign.slicesVerified} format="integer" />
              </dd>
            </div>
            <div>
              <dt>{t("campaign.waits")}</dt>
              <dd>
                <CountUp value={waits} format="integer" />
              </dd>
            </div>
          </dl>
        ) : null}
        <p>
          <Link href="/proof" className={buttonClassName({ variant: "secondary" })}>
            {t("openProof")}
          </Link>
        </p>
      </section>

      <section className="page landing-section faq-section" aria-labelledby="faq-title">
        <div className="faq-section__head">
          <h2 id="faq-title" className="section-title">
            {t("faqTitle")}
          </h2>
          <p>
            <Link href="/partners">{t("forPayroll")}</Link>
          </p>
        </div>
        <div>
          {FAQ.map((key) => (
            <details key={key} className="faq">
              <summary className="pr-h3">{t(`faq.${key}.q`)}</summary>
              <p className="pr-body pr-muted">{t(`faq.${key}.a`)}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="page landing-section" aria-labelledby="start-title" id="waitlist">
        <div className="start-panel">
          <div className="stack">
            <h2 id="start-title" className="section-title">
              {t("startTitle")}
            </h2>
            {mainnetDeployed ? null : <p className="landing-lead">{t("waitlistLead")}</p>}
          </div>
          {mainnetDeployed ? (
            <p>
              <a href={START_HREF} className={buttonClassName({ size: "l" })}>
                {t("start")}
              </a>
            </p>
          ) : (
            <Waitlist source="landing" />
          )}
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
