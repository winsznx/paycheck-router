import type { api } from "@paycheck-router/shared";
import { Banner, PriceCheckBadge } from "@paycheck-router/ui/components";
import { formatPremiumBps, formatPrice, formatTimestamp } from "@paycheck-router/ui/format";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation.ts";

/** Reference price from a Pyth price object, in USD. */
export function pythPrice(price: api.PythPrice | null): number | null {
  if (!price) return null;
  return Number(price.price) * 10 ** price.exponent;
}

/** Live tickers, reference price, market status and today's onchain premium (PRD 18.1 §4). */
export async function AssetStrip({ assets }: { assets: api.AssetsResponse | null }) {
  const t = await getTranslations("site.assets");
  const locale = await getLocale();
  if (!assets) return <Banner tone="warn">{t("unavailable")}</Banner>;
  const listed = assets.assets.filter((a) => a.kind === "listed_equity");
  return (
    <div className="stack">
      <ul className="ticker-strip">
        {listed.map((asset) => {
          const price = pythPrice(asset.reference);
          return (
            <li key={asset.mint}>
              <Link href={`/assets/${asset.symbol}`} className="ticker">
                <span className="pr-num" translate="no">
                  {asset.symbol}
                </span>
                {price === null ? (
                  <span className="pr-small">{t("priceUnavailable")}</span>
                ) : (
                  <span className="pr-num">{formatPrice(price, locale)}</span>
                )}
                <span className="pr-small pr-muted">{t(`market.${asset.market.state}`)}</span>
                {asset.premiumBps === null ? null : (
                  <PriceCheckBadge
                    tone={asset.premiumBps <= asset.defaultBandBps ? "in-band" : "out-of-band"}
                    text={t("premiumVsPyth", {
                      premium: formatPremiumBps(asset.premiumBps, locale),
                    })}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="pr-small pr-muted">
        {t("asOf", { time: formatTimestamp(assets.asOf, locale, "UTC") })}
      </p>
    </div>
  );
}
