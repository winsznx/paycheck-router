import { AssetKind, AssetStatus, api, REGISTRY } from "@paycheck-router/shared";
import { Banner, PreIpoBadge } from "@paycheck-router/ui/components";
import { formatPremiumBps, formatPrice } from "@paycheck-router/ui/format";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChainValue } from "@/components/chain-value.tsx";
import { pythPrice } from "@/components/site/asset-strip.tsx";
import { CONTENT_ID } from "@/components/skip-link.tsx";
import { Link } from "@/i18n/navigation.ts";
import { fetchPublic } from "@/lib/api/public.ts";
import { priceE9 } from "@/lib/money.ts";
import { fetchPreStocks } from "@/lib/prestocks.ts";
import { pageTranslations } from "@/lib/site-page.ts";

export const dynamic = "force-dynamic";

const bySymbol = (symbol: string) =>
  REGISTRY.find((a) => a.symbol.toLowerCase() === symbol.toLowerCase());

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/assets/[symbol]">): Promise<Metadata> {
  const { locale, symbol } = await params;
  const asset = bySymbol(symbol);
  if (!asset) return {};
  const t = await pageTranslations(locale, "assets");
  const title = t("detailTitle", { asset: asset.name });
  return { title, openGraph: { images: [`/api/og?title=${encodeURIComponent(title)}`] } };
}

/** PRD 18.3: rights disclosure, issuer, restrictions and conversion status per asset. */
export default async function AssetPage({ params }: PageProps<"/[locale]/assets/[symbol]">) {
  const { locale, symbol } = await params;
  const asset = bySymbol(symbol);
  if (!asset) notFound();
  const preIpo = asset.kind === AssetKind.preIpo;
  const [t, assets, prestocks] = await Promise.all([
    pageTranslations(locale, "assets"),
    fetchPublic("/assets", api.AssetsResponse),
    preIpo ? fetchPreStocks() : Promise.resolve(null),
  ]);
  const live = assets.ok ? assets.data.assets.find((a) => a.mint === asset.mint) : undefined;
  const quote = prestocks?.quotes.find((q) => q.mint === asset.mint);
  const reference = preIpo
    ? (priceE9(live?.markPriceE9) ?? quote?.markPrice ?? null)
    : pythPrice(live?.reference ?? null);
  const onchain = priceE9(live?.onchainPriceE9) ?? quote?.tokenPrice ?? null;
  const premium = live?.premiumBps ?? quote?.premiumBps ?? null;
  const converting = asset.status === AssetStatus.converting;

  return (
    <main id={CONTENT_ID} className="page site-page stack-lg">
      <p>
        <Link href="/assets">{t("back")}</Link>
      </p>
      <header className="stack reading">
        <p className="row">
          <span className="pr-label pr-muted" translate="no">
            {asset.symbol}
          </span>
          {preIpo ? <PreIpoBadge label={t("preIpo")} /> : null}
        </p>
        <h1 className="pr-h1">{asset.name}</h1>
      </header>
      <dl className="totals">
        <div>
          <dt className="pr-small pr-muted">{t(preIpo ? "detail.mark" : "detail.pyth")}</dt>
          {reference === null ? (
            <dd className="pr-h3">{t("priceUnavailable")}</dd>
          ) : (
            <dd className="pr-num-xl">{formatPrice(reference, locale)}</dd>
          )}
        </div>
        <div>
          <dt className="pr-small pr-muted">{t("detail.onchain")}</dt>
          <dd className="pr-num-xl">{onchain === null ? "—" : formatPrice(onchain, locale)}</dd>
        </div>
        <div>
          <dt className="pr-small pr-muted">{t("detail.premium")}</dt>
          <dd className="pr-num-xl">
            {premium === null ? "—" : formatPremiumBps(premium, locale)}
          </dd>
        </div>
      </dl>
      {converting ? <Banner tone="warn">{t("detail.converting")}</Banner> : null}
      <section className="stack reading" aria-labelledby="rights-title">
        <h2 id="rights-title" className="pr-h2">
          {t("detail.rightsTitle")}
        </h2>
        <p className="pr-body">{t(preIpo ? "detail.rightsPreIpo" : "detail.rightsXstock")}</p>
      </section>
      <section className="stack reading" aria-labelledby="restricted-title">
        <h2 id="restricted-title" className="pr-h2">
          {t("detail.restrictedTitle")}
        </h2>
        <p className="pr-body">{t("detail.restricted")}</p>
        <p>
          <Link href="/legal/restricted-countries">{t("detail.restrictedLink")}</Link>
        </p>
      </section>
      <section className="stack reading" aria-labelledby="token-title">
        <h2 id="token-title" className="pr-h2">
          {t("detail.tokenTitle")}
        </h2>
        <p>
          <ChainValue kind="mint" value={asset.mint} display="full" />
        </p>
        <p className="row">
          <a
            href={preIpo ? (quote?.url ?? "https://prestocks.com") : "https://xstocks.fi"}
            rel="noreferrer"
          >
            {t(preIpo ? "detail.issuerPreStocks" : "detail.issuerXstocks")}
          </a>
        </p>
      </section>
    </main>
  );
}
