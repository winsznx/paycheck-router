"use client";

import { api } from "@paycheck-router/shared";
import { apiRequest } from "./api/client.ts";
import { fetchQuery, getQueryData, setQueryData } from "./query.ts";

/** Cache keys for API reads shared across screens. */
export const keys = {
  me: "me",
  wallets: "wallets",
  routers: "routers",
  assets: "assets",
  portfolio: "portfolio",
  paychecks: "paychecks",
  paycheck: (id: string) => `paycheck:${id}`,
} as const;

export const fetchers = {
  me: () => apiRequest("/me", api.Me),
  wallets: () => apiRequest("/wallets", api.WalletsResponse),
  routers: () => apiRequest("/routers", api.RoutersResponse),
  assets: () => apiRequest("/assets", api.AssetsResponse),
  portfolio: () => apiRequest("/portfolio", api.PortfolioResponse),
  paychecks: () => apiRequest("/paychecks", api.PaychecksResponse),
  paycheck: (id: string) => apiRequest(`/paychecks/${encodeURIComponent(id)}`, api.PaycheckDetail),
};

type DetailLeg = api.PaycheckDetail["legs"][number];

function patchSummaryLeg(paycheckId: string, leg: api.Leg) {
  setQueryData<api.PaychecksResponse>(keys.paychecks, (current) =>
    current
      ? {
          ...current,
          paychecks: current.paychecks.map((p) =>
            p.id === paycheckId
              ? { ...p, legs: p.legs.map((l) => (l.id === leg.id ? leg : l)) }
              : p,
          ),
        }
      : undefined,
  );
}

function patchDetailLeg(
  paycheckId: string,
  leg: api.Leg,
  verification?: api.Verification,
): boolean {
  let patched = false;
  setQueryData<api.PaycheckDetail>(keys.paycheck(paycheckId), (current) => {
    if (!current) return undefined;
    patched = true;
    return {
      ...current,
      legs: current.legs.map(
        (l): DetailLeg =>
          l.id === leg.id ? { ...l, ...leg, verification: verification ?? l.verification } : l,
      ),
    };
  });
  return patched;
}

/**
 * Applies a realtime event to the cache (PRD 13.3 journey 1: each slice animates as events
 * stream in). Events carry the new leg state, so screens update without a refetch.
 */
export function applyRealtimeEvent(event: api.ServerEvent) {
  switch (event.type) {
    case "paycheck.recorded": {
      const paycheck = event.data.paycheck;
      setQueryData<api.PaychecksResponse>(keys.paychecks, (current) =>
        current
          ? {
              ...current,
              paychecks: [paycheck, ...current.paychecks.filter((p) => p.id !== paycheck.id)],
            }
          : undefined,
      );
      if (getQueryData(keys.paychecks) === undefined)
        void fetchQuery(keys.paychecks, fetchers.paychecks);
      return;
    }
    case "leg.waiting":
    case "leg.executing":
    case "leg.executed":
    case "leg.expired":
    case "leg.cancelled": {
      patchSummaryLeg(event.data.paycheckId, event.data.leg);
      patchDetailLeg(event.data.paycheckId, event.data.leg);
      if (event.type === "leg.executed") void fetchQuery(keys.portfolio, fetchers.portfolio);
      return;
    }
    case "leg.verified":
    case "leg.unverified": {
      patchSummaryLeg(event.data.paycheckId, event.data.leg);
      const patched = patchDetailLeg(
        event.data.paycheckId,
        event.data.leg,
        event.data.verification,
      );
      if (patched) {
        // Explorer links arrive with the detail read; refresh them once the slice is final.
        void fetchQuery(keys.paycheck(event.data.paycheckId), () =>
          fetchers.paycheck(event.data.paycheckId),
        );
      }
      return;
    }
    case "router.updated": {
      const router = event.data.router;
      setQueryData<api.RoutersResponse>(keys.routers, (current) =>
        current
          ? { routers: current.routers.map((r) => (r.id === router.id ? router : r)) }
          : { routers: [router] },
      );
      return;
    }
    default:
      return;
  }
}
