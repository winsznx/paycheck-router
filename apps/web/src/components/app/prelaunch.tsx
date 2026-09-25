import { api } from "@paycheck-router/shared";
import { buttonClassName } from "@paycheck-router/ui/components";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ProofLegCard } from "@/components/proof/proof-leg-card.tsx";
import { WaitlistForm } from "@/components/site/waitlist-form.tsx";
import { CONTENT_ID } from "@/components/skip-link.tsx";
import { fetchPublic } from "@/lib/api/public.ts";
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
      <main id={CONTENT_ID} className="page stack-lg prelaunch__main">
        <section className="stack reading" aria-labelledby="prelaunch-title">
          <p className="pr-label pr-muted">{t("label")}</p>
          <h1 id="prelaunch-title" className="pr-display">
            {t("title")}
          </h1>
          <p className="pr-body-l pr-muted">{t("body")}</p>
          <div className="row">
            <a href="#waitlist" className={buttonClassName({ size: "l" })}>
              {t("waitlistCta")}
            </a>
            <Link href="/proof" className={buttonClassName({ variant: "secondary", size: "l" })}>
              {t("proofCta")}
            </Link>
          </div>
        </section>

        <section className="stack" aria-labelledby="prelaunch-fork">
          <h2 id="prelaunch-fork" className="pr-h2">
            {t("forkTitle")}
          </h2>
          <p className="pr-body pr-muted reading">{t("forkBody")}</p>
          {featured ? <ProofLegCard leg={featured} linkToDetail /> : null}
        </section>

        <section className="stack reading" aria-labelledby="prelaunch-run">
          <h2 id="prelaunch-run" className="pr-h2">
            {t("runTitle")}
          </h2>
          <p className="pr-body">{t("runBody")}</p>
          <pre className="pr-code">pnpm demo:record</pre>
          <p>
            <a href={RUN_IT_YOURSELF} rel="noopener">
              {t("runLink")}
            </a>
          </p>
        </section>

        <section id="waitlist" className="stack reading" aria-labelledby="prelaunch-waitlist">
          <h2 id="prelaunch-waitlist" className="pr-h2">
            {t("waitlistTitle")}
          </h2>
          <p className="pr-body pr-muted">{t("waitlistBody")}</p>
          <WaitlistForm source="app-prelaunch" />
        </section>
      </main>
    </div>
  );
}
