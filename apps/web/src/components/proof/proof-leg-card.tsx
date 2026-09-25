import type { api } from "@paycheck-router/shared";
import { StatusChip } from "@paycheck-router/ui/components";
import {
  formatBps,
  formatPrice,
  formatShares,
  formatTimestamp,
  formatUsd,
  formatUsdcAmount,
  truncateMiddle,
} from "@paycheck-router/ui/format";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation.ts";
import { isPreIpo, priceE9, shares, usdc, walletShares } from "@/lib/money.ts";

/** One executed slice as public proof: prices, minimum, delivery and verification. */
export async function ProofLegCard({
  leg,
  linkToDetail,
}: {
  leg: api.ProofLeg;
  linkToDetail: boolean;
}) {
  const t = await getTranslations("proof");
  const locale = await getLocale();
  const ref = priceE9(leg.refPriceE9);
  const exec = priceE9(leg.execPriceE9);
  const v = leg.verification;
  const rows: Array<[string, string]> = [
    [t("usdcIn"), formatUsdcAmount(usdc(leg.amountIn), locale)],
    [
      t("delivered"),
      `${formatShares(shares(leg.mint, leg.outAmount) ?? "0", locale, "full")} ${leg.symbol}`,
    ],
    [
      t("walletShares"),
      `${formatShares(walletShares(leg, leg.outAmount) ?? "0", locale, "full")} ${leg.symbol}`,
    ],
    [t("multiplier"), leg.uiMultiplier ?? "—"],
    [t("fee"), formatUsdcAmount(usdc(leg.fee), locale)],
    [
      t(isPreIpo(leg.mint) ? "referenceMark" : "referencePyth"),
      ref === null ? "—" : formatPrice(ref, locale),
    ],
    [t("effectivePrice"), exec === null ? "—" : formatPrice(exec, locale)],
    [t("premium"), leg.premiumBps === null ? "—" : formatBps(leg.premiumBps, locale)],
    [
      t("minimum"),
      v?.recomputedMinOut
        ? `${formatShares(shares(leg.mint, v.recomputedMinOut) ?? "0", locale, "full")} ${leg.symbol}`
        : "—",
    ],
    [t("finalizedSlot"), v?.finalizedSlot ?? "—"],
    [t("executedAt"), formatTimestamp(leg.executedAt, locale, "UTC")],
  ];
  return (
    <article className="pr-card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 className="pr-h3" translate="no">
          {leg.symbol}
        </h3>
        {v ? (
          <StatusChip
            status={v.matches ? "verified" : "unverified"}
            label={v.matches ? t("verified") : t("unverified")}
          />
        ) : (
          <StatusChip status="executed" label={t("executed")} />
        )}
      </div>
      <p className="pr-small pr-muted">
        {t("paycheckLine", {
          inflow: formatUsd(usdc(leg.paycheck.inflow), locale),
          invested: formatUsd(usdc(leg.paycheck.investTotal), locale),
        })}
      </p>
      <dl className="proof-list">
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt className="pr-small pr-muted">{term}</dt>
            <dd className="pr-code">{value}</dd>
          </div>
        ))}
      </dl>
      <ul className="stack">
        {leg.links.map((link) => (
          <li key={link.url}>
            <a href={link.url} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          </li>
        ))}
      </ul>
      {linkToDetail ? (
        <p>
          <Link href={`/proof/${leg.signature}`}>
            {t("openSlice", { sig: truncateMiddle(leg.signature, 4, 3) })}
          </Link>
        </p>
      ) : null}
    </article>
  );
}
