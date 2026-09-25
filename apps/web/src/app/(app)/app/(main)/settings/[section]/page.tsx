import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PreferencesSection } from "@/components/app/settings/preferences-section.tsx";
import { SecuritySection } from "@/components/app/settings/security-section.tsx";
import { WalletSection } from "@/components/app/settings/wallet-section.tsx";

const SECTIONS = {
  wallet: WalletSection,
  preferences: PreferencesSection,
  security: SecuritySection,
} as const;

type Section = keyof typeof SECTIONS;

const isSection = (value: string): value is Section => value in SECTIONS;

export function generateStaticParams() {
  return Object.keys(SECTIONS).map((section) => ({ section }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app.settings");
  return { title: t("title") };
}

export default async function SettingsPage({ params }: PageProps<"/app/settings/[section]">) {
  const { section } = await params;
  if (!isSection(section)) notFound();
  const t = await getTranslations("app.settings");
  const View = SECTIONS[section];
  return (
    <div className="stack-lg">
      <h1 className="pr-h1">{t("title")}</h1>
      <nav aria-label={t("sections")}>
        <ul className="row">
          {(Object.keys(SECTIONS) as Section[]).map((key) => (
            <li key={key}>
              <Link
                href={`/app/settings/${key}`}
                className="settings-tab"
                aria-current={key === section ? "page" : undefined}
              >
                {t(`tabs.${key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <View />
    </div>
  );
}
