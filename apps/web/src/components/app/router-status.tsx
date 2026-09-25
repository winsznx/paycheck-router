"use client";

import type { api } from "@paycheck-router/shared";
import { useTranslations } from "next-intl";
import { fetchers, keys } from "@/lib/data.ts";
import { useQuery } from "@/lib/query.ts";
import { useRealtimeConnection } from "@/lib/realtime.ts";

export type RouterHealth = "none" | "live" | "paused" | "attention";

/** Live, Paused or Needs attention (PRD 13.4): attention when the allowance is gone. */
export function routerHealth(router: api.Router | undefined): RouterHealth {
  if (!router || router.status === "closed") return "none";
  if (router.status === "paused") return "paused";
  if (router.allowance.delegate === null || BigInt(router.allowance.amount) === 0n)
    return "attention";
  return "live";
}

export function RouterStatusPill() {
  const t = useTranslations("app.status");
  const routers = useQuery(keys.routers, fetchers.routers);
  const connection = useRealtimeConnection();
  const health = routerHealth(routers.data?.routers[0]);
  if (routers.status === "loading") return null;
  const tone = health === "live" ? "live" : health === "none" ? "none" : "warn";
  return (
    <p className="status-pill" data-tone={tone}>
      <span className="status-pill__dot" aria-hidden="true" />
      <span>{t(health)}</span>
      {connection === "reconnecting" ? (
        <span className="pr-muted">· {t("reconnecting")}</span>
      ) : null}
    </p>
  );
}
