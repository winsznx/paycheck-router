"use client";

import {
  AddressField,
  AllowanceMeter,
  QrCode,
  Skeleton,
  StatusChip,
} from "@paycheck-router/ui/components";
import { formatPercent, formatUsd } from "@paycheck-router/ui/format";
import { useLocale, useTranslations } from "next-intl";
import { fetchers, keys } from "@/lib/data.ts";
import { explorerUrl } from "@/lib/env.ts";
import { usdcNumber } from "@/lib/money.ts";
import { useQuery } from "@/lib/query.ts";
import { routerHealth } from "../router-status.tsx";

/** PRD 13.4 Settings > wallet and allowance: the pay-in wallet and what the router may spend. */
export function WalletSection() {
  const t = useTranslations("app.settings.wallet");
  const locale = useLocale();
  const routers = useQuery(keys.routers, fetchers.routers);
  if (routers.status === "loading") return <Skeleton height={240} />;
  const router = routers.data?.routers.find((r) => r.status !== "closed");
  if (!router) return <p className="pr-body">{t("noRouter")}</p>;
  const health = routerHealth(router);
  const allowance = usdcNumber(router.allowance.amount);
  return (
    <section className="stack-lg" aria-labelledby="wallet-title">
      <h2 id="wallet-title" className="pr-h2">
        {t("title")}
      </h2>
      <div className="pr-card stack">
        <p className="pr-body">{t("payIn")}</p>
        <AddressField
          address={router.owner}
          label={t("address")}
          copyLabel={t("copy")}
          copiedLabel={t("copied")}
          explorerHref={explorerUrl("address", router.owner)}
          explorerLabel={t("explorer")}
        />
        <QrCode value={router.owner} label={t("qr")} />
      </div>
      <div className="pr-card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 className="pr-h3">{t("allowance")}</h3>
          <StatusChip
            status={health === "live" ? "verified" : "waiting"}
            label={t(`health.${health}`)}
          />
        </div>
        <AllowanceMeter
          remaining={allowance}
          perPaycheck={0}
          capacity={Math.max(allowance, 1)}
          state={health === "attention" ? "revoked" : "healthy"}
          label={t("allowance")}
          valueText={t("allowanceValue", { amount: formatUsd(allowance, locale) })}
          caption={t("allowanceValue", { amount: formatUsd(allowance, locale) })}
        />
        <p className="pr-small">
          {t("invests", { percent: formatPercent(router.investBps, locale) })}
        </p>
        <p className="pr-small pr-muted">{t("revokeHint")}</p>
      </div>
    </section>
  );
}
