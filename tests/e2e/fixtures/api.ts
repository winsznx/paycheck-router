import { api, assetBySymbol, FORK_KEYS } from "@paycheck-router/shared";
import type { Page, Route } from "@playwright/test";

/**
 * Test-only API responses for exercising screen states in Playwright. Every body is parsed
 * through the shared Zod contract, so a schema change breaks these tests instead of the app.
 * Nothing here is rendered by product code; real runs read the core API.
 */
export const API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8787";

const OWNER = FORK_KEYS["demo-worker"];
const EMPLOYER = FORK_KEYS["employer-1"];
const ROUTER_ID = "7d3c3f6e-8f2a-4c1b-9d5e-2a6b8c9d0e1f";
const PAYCHECK_ID = "0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f";
const SIG = (seed: string) => seed.repeat(88).slice(0, 88);
const NOW = new Date().toISOString();

const SPLIT = [
  ["SPYx", 6000, 50, "222000000"],
  ["NVDAx", 2000, 50, "74000000"],
  ["Anthropic", 1000, 300, "37000000"],
  ["OpenAI", 1000, 300, "37000000"],
] as const;

export const router: api.Router = api.Router.parse({
  id: ROUTER_ID,
  routerPda: FORK_KEYS.recorder,
  authorityPda: FORK_KEYS.crank,
  owner: OWNER,
  payInAta: FORK_KEYS.ops,
  status: "active",
  investBps: 2000,
  minInflow: "20000000",
  appThreshold: null,
  dailyCap: "5000000000",
  maxWaitSecs: 259200,
  autoConvert: true,
  recorder: FORK_KEYS.recorder,
  payerRule: "any",
  legs: SPLIT.map(([symbol, weightBps, bandBps], idx) => ({
    mint: assetBySymbol(symbol).mint,
    weightBps,
    bandBps,
    idx,
    symbol,
    enabled: true,
    colorSlot: idx,
  })),
  allowance: { delegate: FORK_KEYS.crank, amount: "740000000" },
  usdcBalance: "1480000000",
  watermark: "0",
  createdSig: SIG("5"),
  createdAt: NOW,
});

function leg(index: number, status: api.LegStatus) {
  const [symbol, , , amountIn] = SPLIT[index] ?? SPLIT[0];
  const asset = assetBySymbol(symbol);
  const waiting = status === "waiting";
  return {
    id: `${index}0000000-0000-4000-8000-000000000000`,
    idx: index,
    mint: asset.mint,
    symbol,
    amountIn,
    status,
    waitReason: waiting ? "PREMIUM_TOO_HIGH" : null,
    nextAttemptAt: waiting ? new Date(Date.now() + 5 * 60_000).toISOString() : null,
    outAmount: waiting ? null : "41130000",
    fee: waiting ? null : "444000",
    issuerFee: null,
    refPriceE9: "629860000000",
    execPriceE9: waiting ? null : "630050000000",
    premiumBps: waiting ? 3040 : 3,
    executedSig: waiting ? null : SIG(String(index + 2)),
    executedAt: waiting ? null : NOW,
    verifiedAt: status === "verified" ? NOW : null,
  } satisfies api.Leg;
}

const legs = [leg(0, "verified"), leg(1, "verified"), leg(2, "verified"), leg(3, "waiting")];

const summary = {
  id: PAYCHECK_ID,
  routerId: ROUTER_ID,
  seq: "1",
  paycheckPda: FORK_KEYS.guardian,
  inflow: "1850000000",
  investTotal: "370000000",
  sender: EMPLOYER,
  inflowSig: SIG("A"),
  recordedSig: SIG("B"),
  recordedAt: NOW,
  expiresAt: new Date(Date.now() + 72 * 3_600_000).toISOString(),
  status: "open",
  legs,
};

export const paychecks = api.PaychecksResponse.parse({ paychecks: [summary], nextCursor: null });

export const paycheckDetail = api.PaycheckDetail.parse({
  ...summary,
  legs: legs.map((l) => ({ ...l, attempts: [], verification: null, links: [] })),
  links: [],
});

export const portfolio = api.PortfolioResponse.parse({
  holdings: SPLIT.slice(0, 3).map(([symbol, weightBps], index) => {
    const asset = assetBySymbol(symbol);
    return {
      mint: asset.mint,
      symbol,
      amountRaw: "41130000",
      decimals: asset.decimals,
      valueUsdc: String(222_000_000 - index * 1_000_000),
      costBasisUsdc: "222000000",
      pnlUsdc: "-1000000",
      targetWeightBps: weightBps,
      actualWeightBps: weightBps,
    };
  }),
  totals: {
    valueUsdc: "330000000",
    costBasisUsdc: "333000000",
    pnlUsdc: "-3000000",
    investedUsdc: "333000000",
    feesUsdc: "666000",
  },
  asOf: NOW,
});

export const session = {
  accessToken: "e2e-access-token",
  accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  user: {
    id: "11111111-2222-4333-8444-555555555555",
    eligibilityStatus: "eligible",
    locale: "en",
    refCurrency: "USD",
  },
  wallet: OWNER,
};

const ROUTES: Record<string, unknown> = {
  "/routers": api.RoutersResponse.parse({ routers: [router] }),
  "/paychecks": paychecks,
  [`/paychecks/${PAYCHECK_ID}`]: paycheckDetail,
  "/portfolio": portfolio,
};

export { PAYCHECK_ID };

/** Serves the fixtures above for the core API and a signed-in session on the web origin. */
export async function mockSignedInApi(page: Page): Promise<void> {
  await page.route("**/api/session/refresh", (route: Route) => route.fulfill({ json: session }));
  await page.route(`${API_URL}/**`, (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    const body = ROUTES[path];
    return body
      ? route.fulfill({ json: body })
      : route.fulfill({
          status: 404,
          contentType: "application/problem+json",
          json: {
            type: "about:blank",
            title: "Not found",
            status: 404,
            code: "not_found",
            requestId: "e2e",
          },
        });
  });
}
