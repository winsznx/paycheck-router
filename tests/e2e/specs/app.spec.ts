import { expect, test } from "@playwright/test";
import { expectForkBanner, expectNoAxeViolations } from "../a11y.ts";
import { mockSignedInApi, OPENAI_MULTIPLIER, OPENAI_RAW, PAYCHECK_ID } from "../fixtures/api.ts";

test.describe("signed-in app screens", () => {
  test.beforeEach(async ({ page }) => {
    await mockSignedInApi(page);
  });

  test("home shows the router, latest paycheck and holdings", async ({ page }) => {
    // #given a live router with one paycheck
    await page.goto("/app");
    // #then
    await expectForkBanner(page);
    await expect(page.getByRole("heading", { name: "Your router" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Latest paycheck" })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("paycheck detail shows verified slices and the waiting OpenAI slice", async ({ page }) => {
    // #given the paycheck from the fork employer
    await page.goto(`/app/paychecks/${PAYCHECK_ID}`);
    // #then the header, the split bar and the named wait are all on screen
    await expectForkBanner(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "$1,850.00 from Employer (demo)",
    );
    await expect(page.getByRole("heading", { level: 1 })).toContainText("$370.00 invested");
    await expect(page.getByText("Waiting: 30.40% over mark")).toBeAttached();
    await expect(
      page.getByText(/OpenAI PreStocks is trading 30\.40% above its mark/),
    ).toBeVisible();
    await expect(page.locator('[data-status="verified"]')).toHaveCount(3);
    await expectNoAxeViolations(page);
    await page.screenshot({
      path: `screenshots/paycheck-detail-${test.info().project.name}.png`,
      fullPage: true,
    });
  });

  test("proof sheet opens and closes with Escape", async ({ page }) => {
    // #given
    await page.goto(`/app/paychecks/${PAYCHECK_ID}`);
    // #when
    await page.getByRole("button", { name: "Proof" }).first().click();
    // #then
    const dialog = page.getByRole("dialog", { name: "Proof for SPYx" });
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("paychecks list and portfolio pass axe", async ({ page }) => {
    // #given
    await page.goto("/app/paychecks");
    await expect(page.getByRole("heading", { name: "Paychecks", level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
    // #when
    await page.goto("/app/portfolio");
    // #then
    await expect(page.getByRole("heading", { name: "Portfolio", level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("portfolio shows OpenAI shares with the Scaled UI multiplier applied", async ({ page }) => {
    // #given a raw OpenAI holding and its multiplier, both from the API
    const [whole = "0", fraction = ""] = OPENAI_MULTIPLIER.split(".");
    const scaled = BigInt(OPENAI_RAW) * BigInt(`${whole}${fraction}`);
    const expected = Number(scaled) / 10 ** (9 + fraction.length);
    // #when
    await page.goto("/app/portfolio");
    // #then the wallet amount is raw × 1.4861347 / 1e9, not the raw 0.0247
    const shown = new Intl.NumberFormat("en", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    }).format(expected);
    expect(shown).toBe("0.0367");
    // A table row from tablet up, a card on phones.
    const holding = page
      .locator(".portfolio-table tr, .portfolio-cards > li")
      .filter({ hasText: "OpenAI" })
      .filter({ visible: true });
    await expect(holding).toContainText(shown);
    await expect(holding).not.toContainText("0.0247");
  });
});

test.describe("activity and settings", () => {
  test.beforeEach(async ({ page }) => {
    await mockSignedInApi(page);
  });

  test("activity filters slices and passes axe", async ({ page }) => {
    // #given
    await page.goto("/app/activity");
    await expect(page.getByRole("heading", { name: "Activity", level: 1 })).toBeVisible();
    // #when
    await page.getByLabel("Waiting").check();
    // #then
    await expect(page.locator(".activity-row")).toHaveCount(1);
    await expectNoAxeViolations(page);
  });

  for (const section of ["wallet", "preferences", "security"] as const) {
    test(`settings ${section} passes axe`, async ({ page }) => {
      await page.goto(`/app/settings/${section}`);
      await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }

  test("theme preference switches to light and stays accessible", async ({ page }) => {
    // #given
    await page.goto("/app/settings/preferences");
    // #when
    await page.getByLabel("Theme").selectOption("light");
    // #then
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expectNoAxeViolations(page);
  });
});

test.describe("onboarding", () => {
  test("welcome step passes axe and links to sign-in", async ({ page }) => {
    // #given a signed-out visitor
    await page.route("**/api/session/refresh", (route) =>
      route.fulfill({ status: 401, json: { status: 401, code: "unauthorized" } }),
    );
    await page.goto("/app/onboarding/welcome");
    // #then
    await expectForkBanner(page);
    await expect(page.getByRole("link", { name: "Get started" })).toHaveAttribute(
      "href",
      "/app/onboarding/sign-in",
    );
    await expectNoAxeViolations(page);
  });

  test("sign-in lists the demo signer in demo builds", async ({ page }) => {
    test.skip(!process.env.DEMO_SIGNER_SECRET, "needs the fork-only demo signer secret");
    // #given
    await page.route("**/api/session/refresh", (route) =>
      route.fulfill({ status: 401, json: { status: 401, code: "unauthorized" } }),
    );
    await page.goto("/app/onboarding/sign-in");
    // #then
    await expect(
      page.getByRole("button", { name: "Continue with Paycheck Router demo signer" }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe("public proof", () => {
  test("proof page renders and passes axe", async ({ page }) => {
    await page.goto("/proof");
    await expectForkBanner(page);
    await expect(page.getByRole("heading", { name: "Proof", level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
