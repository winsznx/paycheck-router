import { api } from "@paycheck-router/shared";
import { type ChainEnv, type ChainKind, chainLinks } from "@paycheck-router/ui/chain";
import { expect, type Page, test } from "@playwright/test";
import {
  anthropicSignature,
  manifest,
  PAYCHECK_ID,
  paycheckDetail,
  paycheckSummary,
  router,
} from "../fixtures/fork-run.ts";

/**
 * Every chain value renders as a link with the right target and never makes the page scroll
 * sideways, at 320 to 1280 px in both themes, using the longest real values from the recorded
 * fork run (88-character signatures, 44-character addresses).
 */
const WIDTHS = [320, 360, 390, 768, 1280] as const;
const THEMES = ["dark", "light"] as const;
const API_URL = "http://127.0.0.1:8787";

/** The e2e build is a demo build without NEXT_PUBLIC_SURFNET_RPC_URL, so the default applies. */
const ENV: ChainEnv = {
  mode: "fork-live",
  surfnetRpcUrl: "http://127.0.0.1:8899",
  repoUrl: "https://github.com/winsznx/paycheck-router",
  evidencePath: "evidence/stocklana-fork",
};

type Expected = { kind: ChainKind; value: string };

const SESSION = {
  accessToken: "e2e-access-token",
  accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  user: {
    id: "11111111-2222-4333-8444-555555555555",
    eligibilityStatus: "eligible",
    locale: "en",
    refCurrency: "USD",
  },
  wallet: manifest.router.owner,
};

const ROUTES: Record<string, unknown> = {
  "/routers": { routers: [router] },
  "/paychecks": { paychecks: [paycheckSummary()], nextCursor: null },
  [`/paychecks/${PAYCHECK_ID}`]: paycheckDetail,
  "/portfolio": {
    holdings: [],
    totals: {
      valueUsdc: null,
      costBasisUsdc: "0",
      pnlUsdc: null,
      investedUsdc: "0",
      feesUsdc: "0",
    },
    asOf: manifest.finishedAt,
  },
};

async function signedIn(page: Page) {
  await page.route("**/api/session/refresh", (route) => route.fulfill({ json: SESSION }));
  await page.route(`${API_URL}/**`, (route) => {
    const body = ROUTES[new URL(route.request().url()).pathname];
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

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
  }, theme);
}

async function expectNoHorizontalScroll(page: Page, where: string) {
  const { scrollWidth, clientWidth, offenders } = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: width,
      offenders: [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > width + 0.5)
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`),
    };
  });
  expect(
    scrollWidth,
    `${where}: page scrolls sideways (${offenders.join(", ")})`,
  ).toBeLessThanOrEqual(clientWidth);
}

async function expectChainLinks(page: Page, values: readonly Expected[]) {
  for (const { kind, value } of values) {
    const expected = chainLinks(kind, value, ENV)[0];
    if (!expected) throw new Error(`${kind} ${value} has no link`);
    const link = page.locator(`a.pr-chainref__value[title="${value}"]`).first();
    await expect(link, `${kind} ${value}`).toHaveAttribute("href", expected.href);
    await expect(link.locator("xpath=..").locator("button.pr-chainref__copy")).toHaveCount(1);
  }
}

async function sweep(
  page: Page,
  label: string,
  open: () => Promise<void>,
  values: readonly Expected[],
) {
  await open();
  // Not "networkidle": the waitlist's Turnstile widget keeps retrying its challenge when the
  // site key doesn't allow this host, so the landing page never goes idle.
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expectChainLinks(page, values);
  for (const theme of THEMES) {
    await setTheme(page, theme);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(50);
      await expectNoHorizontalScroll(page, `${label} ${theme} ${width}px`);
    }
  }
}

test.describe("chain values: links and layout", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "widths are swept inside each test");
  });

  test("paycheck detail", async ({ page }) => {
    await signedIn(page);
    const executed = paycheckDetail.legs.flatMap((leg) =>
      leg.executedSig ? [{ kind: "tx" as const, value: leg.executedSig }] : [],
    );
    await sweep(
      page,
      "paycheck detail",
      async () => {
        await page.goto(`/app/paychecks/${PAYCHECK_ID}`);
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Employer (demo)");
      },
      [
        { kind: "tx", value: manifest.paycheck.inflowSignature },
        { kind: "tx", value: manifest.paycheck.recordSignature },
        { kind: "account", value: manifest.paycheck.sender },
        { kind: "account", value: manifest.paycheck.address },
        ...executed,
      ],
    );
  });

  test("proof sheet for the Anthropic slice", async ({ page }) => {
    await signedIn(page);
    const anthropic = manifest.legs.find((leg) => leg.symbol === "Anthropic");
    await sweep(
      page,
      "proof sheet",
      async () => {
        await page.goto(`/app/paychecks/${PAYCHECK_ID}`);
        await page
          .locator("li.pr-slice")
          .filter({ hasText: "Anthropic" })
          .getByRole("button", { name: "Proof" })
          .click();
        await expect(page.getByRole("dialog", { name: "Proof for Anthropic" })).toBeVisible();
      },
      [
        { kind: "tx", value: anthropicSignature },
        { kind: "mint", value: anthropic?.mint ?? "" },
      ],
    );
  });

  test("settings wallet and security", async ({ page }) => {
    await signedIn(page);
    await sweep(
      page,
      "settings wallet",
      async () => {
        await page.goto("/app/settings/wallet");
        await expect(page.getByRole("heading", { name: "Wallet and allowance" })).toBeVisible();
      },
      [{ kind: "account", value: manifest.router.owner }],
    );
    await sweep(
      page,
      "settings security",
      async () => {
        await page.goto("/app/settings/security");
        await expect(page.getByRole("heading", { name: "Security", level: 2 })).toBeVisible();
      },
      [{ kind: "account", value: manifest.router.owner }],
    );
  });

  test("public proof pages", async ({ page }) => {
    const executed = manifest.legs.flatMap((leg) =>
      leg.executed ? [{ kind: "tx" as const, value: leg.executed.signature }] : [],
    );
    await sweep(
      page,
      "/proof",
      async () => {
        await page.goto("/proof");
        await expect(page.getByRole("heading", { name: "Canonical run" })).toBeVisible();
      },
      [...executed, { kind: "own-program", value: manifest.programId }],
    );
    await sweep(
      page,
      "/proof/[signature]",
      async () => {
        await page.goto(`/proof/${anthropicSignature}`);
        await expect(page.getByRole("heading", { name: "Slice proof", level: 1 })).toBeVisible();
      },
      [
        { kind: "tx", value: anthropicSignature },
        { kind: "tx", value: manifest.paycheck.recordSignature },
      ],
    );
  });

  test("security and asset pages", async ({ page }) => {
    await sweep(
      page,
      "/security",
      async () => {
        await page.goto("/security");
        await expect(page.getByRole("heading", { name: "Security", level: 1 })).toBeVisible();
      },
      [{ kind: "own-program", value: manifest.programId }],
    );
    const openAi = manifest.legs.find((leg) => leg.symbol === "OpenAI");
    await sweep(
      page,
      "/assets/OpenAI",
      async () => {
        await page.goto("/assets/OpenAI");
        await expect(
          page.getByRole("heading", { name: "OpenAI PreStocks", level: 1 }),
        ).toBeVisible();
      },
      [{ kind: "mint", value: openAi?.mint ?? "" }],
    );
  });

  test("every public page fits from 320 to 1280 px", async ({ page }) => {
    for (const path of [
      "/",
      "/how-it-works",
      "/assets",
      "/fees",
      "/status",
      "/help",
      "/partners",
      "/legal/terms",
      "/legal/restricted-countries",
    ]) {
      await sweep(page, path, () => page.goto(path).then(() => undefined), []);
    }
  });

  test("a paycheck arriving over the realtime socket keeps the layout", async ({ page }) => {
    await signedIn(page);
    let push: ((event: api.ServerEvent) => void) | undefined;
    await page.routeWebSocket(`${API_URL.replace("http", "ws")}/realtime`, (ws) => {
      push = (event) => ws.send(JSON.stringify(event));
    });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/app/paychecks");
    await expect(page.locator('a[href^="/app/paychecks/"]')).toHaveCount(1);
    await expect.poll(() => push !== undefined).toBe(true);

    const id = "9b8a7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
    const fresh = paycheckSummary(id, "9");
    const event = (type: string, data: unknown, n: number) =>
      api.ServerEvent.parse({
        type,
        id: `01K${String(n).padStart(23, "0")}`,
        ts: manifest.finishedAt,
        data,
      });
    push?.(event("paycheck.recorded", { routerId: router.id, paycheck: fresh }, 1));
    fresh.legs.forEach((leg, index) => {
      push?.(
        event(
          leg.status === "waiting" ? "leg.waiting" : "leg.executed",
          { routerId: router.id, paycheckId: id, leg },
          index + 2,
        ),
      );
    });

    await expect(page.locator('a[href^="/app/paychecks/"]')).toHaveCount(2);
    for (const theme of THEMES) {
      await setTheme(page, theme);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalScroll(page, `realtime list ${theme} ${width}px`);
      }
    }
  });
});
