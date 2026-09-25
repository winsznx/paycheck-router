import { buttonClassName } from "@paycheck-router/ui/components";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CONTENT_ID } from "@/components/skip-link.tsx";
import { Link } from "@/i18n/navigation.ts";

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("landing");
  return (
    <main id={CONTENT_ID} className="page landing">
      <section className="landing__hero stack-lg" aria-labelledby="hero-title">
        <p className="pr-label pr-muted">{t("heroLabel")}</p>
        <h1 id="hero-title" className="pr-display">
          {t("heroTitle")}
        </h1>
        <p className="pr-body-l reading pr-muted">{t("heroBody")}</p>
        <div className="row">
          <Link href="/#waitlist" className={buttonClassName({ variant: "primary", size: "l" })}>
            {t("start")}
          </Link>
          <Link href="/proof" className={buttonClassName({ variant: "secondary", size: "l" })}>
            {t("seeForkRun")}
          </Link>
        </div>
        <p className="pr-small pr-muted">{t("forkRunLabel")}</p>
      </section>
    </main>
  );
}
