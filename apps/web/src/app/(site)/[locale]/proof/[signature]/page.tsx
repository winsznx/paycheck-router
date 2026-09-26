import { api } from "@paycheck-router/shared";
import { Banner } from "@paycheck-router/ui/components";
import { formatPremiumBps, formatUsd, truncateMiddle } from "@paycheck-router/ui/format";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChainValue } from "@/components/chain-value.tsx";
import { ProofLegCard } from "@/components/proof/proof-leg-card.tsx";
import { CONTENT_ID } from "@/components/skip-link.tsx";
import { Link } from "@/i18n/navigation.ts";
import { fetchPublic } from "@/lib/api/public.ts";
import { isPreIpo, usdc } from "@/lib/money.ts";

const load = (signature: string) =>
  fetchPublic(`/proof/legs/${encodeURIComponent(signature)}`, api.ProofLeg, 300);

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/proof/[signature]">): Promise<Metadata> {
  const { locale, signature } = await params;
  const t = await getTranslations({ locale, namespace: "proof" });
  const result = await load(signature);
  if (!result.ok) return { title: t("sliceTitle", { sig: truncateMiddle(signature, 4, 3) }) };
  const leg = result.data;
  const detail = t("ogDetail", {
    amount: formatUsd(usdc(leg.amountIn), locale),
    asset: leg.symbol,
    premium: leg.premiumBps === null ? "" : formatPremiumBps(leg.premiumBps, locale),
    reference: isPreIpo(leg.mint) ? "mark" : "pyth",
  });
  const og = new URLSearchParams({
    title: t("sliceTitle", { sig: leg.symbol }),
    detail,
    a: leg.symbol,
  });
  return {
    title: t("sliceTitle", { sig: leg.symbol }),
    description: detail,
    openGraph: { images: [`/api/og?${og.toString()}`] },
  };
}

export default async function ProofSlicePage({ params }: PageProps<"/[locale]/proof/[signature]">) {
  const { locale, signature } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("proof");
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) notFound();
  const result = await load(signature);
  if (!result.ok && result.status === 404) notFound();
  return (
    <main id={CONTENT_ID} className="page stack-lg site-page">
      <p>
        <Link href="/proof">{t("back")}</Link>
      </p>
      <h1 className="pr-h1">{t("sliceHeading")}</h1>
      <p>
        <ChainValue kind="tx" value={signature} display="full" />
      </p>
      {result.ok ? (
        <ProofLegCard leg={result.data} linkToDetail={false} />
      ) : (
        <Banner tone="warn">{t("unavailable")}</Banner>
      )}
    </main>
  );
}
