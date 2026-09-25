"use client";

import { Banner, EmptyState, Skeleton } from "@paycheck-router/ui/components";
import { useTranslations } from "next-intl";
import { fetchers, keys } from "@/lib/data.ts";
import { useQuery } from "@/lib/query.ts";
import { PaycheckCardLink } from "./paycheck-card-link.tsx";

export function PaycheckList() {
  const t = useTranslations("app.paychecks");
  const paychecks = useQuery(keys.paychecks, fetchers.paychecks);
  const routers = useQuery(keys.routers, fetchers.routers);

  if (paychecks.status === "loading") {
    return (
      <div className="stack" aria-busy="true">
        <Skeleton height={150} />
        <Skeleton height={150} />
      </div>
    );
  }
  if (!paychecks.data) {
    return (
      <Banner tone="danger" live="alert">
        {t("loadError")}
      </Banner>
    );
  }
  if (paychecks.data.paychecks.length === 0) return <EmptyState>{t("empty")}</EmptyState>;
  return (
    <ul className="card-list">
      {paychecks.data.paychecks.map((paycheck) => (
        <li key={paycheck.id}>
          <PaycheckCardLink
            paycheck={paycheck}
            routerLegs={routers.data?.routers.find((r) => r.id === paycheck.routerId)?.legs}
          />
        </li>
      ))}
    </ul>
  );
}
