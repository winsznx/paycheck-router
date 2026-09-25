import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation.ts";

const COLUMNS = [
  {
    key: "product",
    links: [
      ["/how-it-works", "howItWorks"],
      ["/assets", "assets"],
      ["/fees", "fees"],
      ["/proof", "proof"],
    ],
  },
  {
    key: "trust",
    links: [
      ["/security", "security"],
      ["/status", "status"],
      ["/help", "help"],
      ["/partners", "partners"],
    ],
  },
  {
    key: "legal",
    links: [
      ["/legal/terms", "terms"],
      ["/legal/risk", "risk"],
      ["/legal/privacy", "privacy"],
      ["/legal/restricted-countries", "restricted"],
    ],
  },
] as const;

export async function SiteFooter() {
  const t = await getTranslations("site.footer");
  return (
    <footer className="site-footer">
      <div className="page stack-lg">
        <div className="site-footer__grid">
          {COLUMNS.map((column) => (
            <nav key={column.key} aria-label={t(column.key)}>
              <h2 className="pr-label pr-muted">{t(column.key)}</h2>
              <ul className="stack">
                {column.links.map(([href, key]) => (
                  <li key={href}>
                    <Link href={href}>{t(key)}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
          <nav aria-label={t("elsewhere")}>
            <h2 className="pr-label pr-muted">{t("elsewhere")}</h2>
            <ul className="stack">
              <li>
                <a href="https://github.com/winsznx/paycheck-router" rel="noreferrer">
                  GitHub
                </a>
              </li>
              <li>
                <a href="/.well-known/security.txt">security.txt</a>
              </li>
            </ul>
          </nav>
        </div>
        <p className="pr-body">{t("notUs")}</p>
        <p className="pr-small pr-muted reading">{t("riskStatement")}</p>
      </div>
    </footer>
  );
}
