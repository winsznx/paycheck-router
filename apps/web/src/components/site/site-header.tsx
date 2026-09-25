import { buttonClassName } from "@paycheck-router/ui/components";
import { Menu } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation.ts";
import { appOpen, mainnetDeployed } from "@/lib/env.ts";

const NAV = [
  ["/how-it-works", "howItWorks"],
  ["/assets", "assets"],
  ["/proof", "proof"],
  ["/security", "security"],
  ["/fees", "fees"],
] as const;

/** Where Start goes: the waitlist until the program is on mainnet (PRD 18.1). */
export const START_HREF = mainnetDeployed ? "/app/onboarding/welcome" : "/#waitlist";

export async function SiteHeader() {
  const t = await getTranslations("site.header");
  return (
    <header className="site-header">
      <div className="page site-header__inner">
        <Link href="/" className="site-brand">
          <span className="app-nav__mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="site-brand__word">{t("wordmark")}</span>
        </Link>
        <nav aria-label={t("label")} className="site-nav">
          <ul>
            {NAV.map(([href, key]) => (
              <li key={href}>
                <Link href={href}>{t(key)}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="site-header__actions">
          {appOpen ? (
            <a
              href="/app"
              className={`${buttonClassName({ variant: "ghost", size: "s" })} site-signin`}
            >
              {t("signIn")}
            </a>
          ) : null}
          <a href={START_HREF} className={buttonClassName({ size: "s" })}>
            {t("start")}
          </a>
          <details className="site-menu">
            <summary className="pr-icon-btn" aria-label={t("menu")}>
              <Menu size={24} strokeWidth={1.75} aria-hidden="true" />
            </summary>
            <nav aria-label={t("menuLabel")} className="site-menu__panel">
              <ul>
                {NAV.map(([href, key]) => (
                  <li key={href}>
                    <Link href={href}>{t(key)}</Link>
                  </li>
                ))}
                {appOpen ? (
                  <li>
                    <a href="/app">{t("signIn")}</a>
                  </li>
                ) : null}
              </ul>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
