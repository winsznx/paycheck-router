import { api } from "@paycheck-router/shared";
import { buttonClassName } from "@paycheck-router/ui/components";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ProofLegCard } from "@/components/proof/proof-leg-card.tsx";
import { HeroPhone } from "@/components/site/hero-phone.tsx";
import { Waitlist } from "@/components/site/waitlist.tsx";
import { CONTENT_ID } from "@/components/skip-link.tsx";
import { fetchPublic } from "@/lib/api/public.ts";
import { canonicalPaycheck } from "@/lib/canonical.ts";
import { chainEnv } from "@/lib/env.ts";

const RUN_IT_YOURSELF = `${chainEnv.repoUrl}#run-it-yourself`;

/**
 * Every /app route in a public build before the mainnet deploy: there is no program or database
 * behind the app yet, so it shows what the app does, the recorded fork run and the waitlist
 * instead of onboarding and a wallet prompt.
 */
export async function Prelaunch() {
  const [t, proof] = await Promise.all([
    getTranslations("app.prelaunch"),
    fetchPublic("/proof", api.ProofResponse),
  ]);
  const legs = proof.ok ? proof.data.recentLegs : [];
  const featured = legs.find((leg) => leg.symbol === "Anthropic") ?? legs[0];
  const canonical = proof.ok ? canonicalPaycheck(proof.data) : null;

  return (
    <div className="prelaunch">
      <header className="prelaunch__bar">
        <Link href="/" className="prelaunch__brand">
          <span className="app-nav__mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>{t("brand")}</span>
        </Link>
        <Link href="/proof">{t("proofLink")}</Link>
      </header>
      <main id={CONTENT_ID}>
        <section className="page landing-hero" aria-labelledby="prelaunch-title">
          <div className="landing-hero__copy">
            <p className="landing-audience">{t("label")}</p>
            <h1 id="prelaunch-title" className="landing-title">
              {t("title")}
            </h1>
            <p className="landing-lead">{t("body")}</p>
            <div className="row">
              <a href="#waitlist" className={buttonClassName({ size: "l" })}>
                {t("waitlistCta")}
              </a>
              <Link href="/proof" className={buttonClassName({ variant: "secondary", size: "l" })}>
                {t("proofCta")}
              </Link>
            </div>
          </div>
          {canonical ? <HeroPhone paycheck={canonical} /> : null}
        </section>

        <section className="page landing-section" aria-labelledby="prelaunch-fork">
          <div className="split-heading">
            <h2 id="prelaunch-fork" className="section-title">
              {t("forkTitle")}
            </h2>
            <p className="landing-lead">{t("forkBody")}</p>
          </div>
          {featured ? <ProofLegCard leg={featured} linkToDetail /> : null}
        </section>

        <section className="page landing-section" aria-labelledby="prelaunch-run">
          <div className="split-heading">
            <h2 id="prelaunch-run" className="section-title">
              {t("runTitle")}
            </h2>
            <p className="landing-lead">{t("runBody")}</p>
          </div>
          <div className="prelaunch__run">
            <pre className="pr-code">pnpm demo:record</pre>
            <a href={RUN_IT_YOURSELF} rel="noopener">
              {t("runLink")}
            </a>
          </div>
        </section>

        <section
          id="waitlist"
          className="page landing-section"
          aria-labelledby="prelaunch-waitlist"
        >
          <div className="start-panel">
            <div className="stack">
              <h2 id="prelaunch-waitlist" className="section-title">
                {t("waitlistTitle")}
              </h2>
              <p className="landing-lead">{t("waitlistBody")}</p>
            </div>
            <Waitlist source="app-prelaunch" />
          </div>
        </section>
      </main>
    </div>
  );
}
