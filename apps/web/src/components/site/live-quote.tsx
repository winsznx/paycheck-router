import { assetByMint } from "@paycheck-router/shared";
import { AssetIcon, PriceCheckBadge } from "@paycheck-router/ui/components";
import { formatPremiumBps, formatPrice, formatTimestamp } from "@paycheck-router/ui/format";
import { getLocale, getTranslations } from "next-intl/server";
import type { PreStocksQuote } from "@/lib/prestocks.ts";

/**
 * A phone cropped by its card: the live PreStocks quote a pre-IPO slice is checked against,
 * straight from the PreStocks API, with what a slice would do at that price.
 */
export async function LiveQuote({
  quote,
  fetchedAt,
}: {
  quote: PreStocksQuote;
  fetchedAt: string;
}) {
  const [t, ts, locale] = await Promise.all([
    getTranslations("landing"),
    getTranslations("app.slice"),
    getLocale(),
  ]);
  const band = assetByMint(quote.mint)?.defaultBandBps ?? 0;
  const waits = quote.premiumBps > band;
  const premium = formatPremiumBps(Math.abs(quote.premiumBps), locale).replace("+", "");
  return (
    <>
      <p className="pr-body">
        {t("openAiLive", {
          premium,
          direction: quote.premiumBps > 0 ? "above" : "below",
          time: formatTimestamp(fetchedAt, locale, "UTC"),
        })}
      </p>
      <div className="phone phone--cropped">
        <div className="phone__screen">
          <p className="live-quote__head">
            <AssetIcon asset={quote.mint} size="lg" decorative />
            <span>{quote.name}</span>
          </p>
          <dl className="live-quote__figures">
            <div>
              <dt>{t("quote.mark")}</dt>
              <dd>{formatPrice(quote.markPrice, locale)}</dd>
            </div>
            <div>
              <dt>{t("quote.token")}</dt>
              <dd>{formatPrice(quote.tokenPrice, locale)}</dd>
            </div>
          </dl>
          <PriceCheckBadge
            tone={waits ? "out-of-band" : "in-band"}
            text={
              waits
                ? ts("reasonShort.PREMIUM_TOO_HIGH", { premium, reference: "mark" })
                : t("quote.inBand", { premium: formatPremiumBps(quote.premiumBps, locale) })
            }
          />
        </div>
      </div>
    </>
  );
}
