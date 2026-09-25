import { Banner } from "@paycheck-router/ui/components";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentPage } from "@/components/site/content-page.tsx";
import {
  type PageNamespace,
  pageMetadata,
  pageTranslations,
  sectionsFrom,
} from "@/lib/site-page.ts";

const LEGAL: Record<string, { namespace: PageNamespace; sections: readonly string[] }> = {
  terms: {
    namespace: "terms",
    sections: ["software", "eligibility", "fees", "advice", "liability"],
  },
  risk: {
    namespace: "risk",
    sections: ["xstocks", "prestocks", "contract", "oracle", "liquidity", "usdc", "regulatory"],
  },
  privacy: {
    namespace: "privacy",
    sections: ["collected", "why", "processors", "rights", "deletion"],
  },
  "restricted-countries": {
    namespace: "restricted",
    sections: ["us", "sanctioned", "issuers", "check"],
  },
};

export function generateStaticParams() {
  return Object.keys(LEGAL).map((page) => ({ page }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/legal/[page]">): Promise<Metadata> {
  const { locale, page } = await params;
  const legal = LEGAL[page];
  return legal ? pageMetadata(locale, legal.namespace) : {};
}

/** PRD 18.3 legal pages. English is binding; translations say they are for convenience. */
export default async function LegalPage({ params }: PageProps<"/[locale]/legal/[page]">) {
  const { locale, page } = await params;
  const legal = LEGAL[page];
  if (!legal) notFound();
  const t = await pageTranslations(locale, legal.namespace);
  const common = await pageTranslations(locale, "terms");
  return (
    <ContentPage
      title={t("title")}
      lead={t("lead")}
      notice={
        <div className="stack reading">
          <p className="pr-small pr-muted">{common("version")}</p>
          {locale === "en" ? null : <Banner tone="info">{common("translationNotice")}</Banner>}
        </div>
      }
      sections={sectionsFrom(t, legal.sections)}
    />
  );
}
