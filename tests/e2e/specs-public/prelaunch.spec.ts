import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "../a11y.ts";
import { API_URL } from "../fixtures/api.ts";

const TITLE = "Launching on Solana mainnet";

/** Stands in for Turnstile so the waitlist form can submit; the widget itself isn't under test. */
async function passTurnstile(page: Page): Promise<void> {
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.turnstile = {
        render(element, options) { setTimeout(() => options.callback("e2e-token"), 0); return "e2e"; },
        reset() {},
        remove() {},
      };`,
    }),
  );
}

async function review(page: Page, name: string): Promise<void> {
  if (!process.env.REVIEW_SCREENSHOTS) return;
  await page.screenshot({
    path: `screenshots/review/prelaunch/${name}-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

test.describe("public build before the mainnet deploy", () => {
  for (const [name, path] of [
    ["app", "/app"],
    ["onboarding", "/app/onboarding/welcome"],
    ["sign-in", "/app/onboarding/sign-in"],
    ["paychecks", "/app/paychecks"],
  ] as const) {
    test(`${path} shows the launch page, never onboarding or a wallet prompt`, async ({ page }) => {
      // #given an anonymous visitor
      const traffic: string[] = [];
      page.on("request", (request) => traffic.push(request.url()));
      // #when
      await page.goto(path);
      // #then
      await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Recorded on a Surfpool fork of mainnet" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "See the fork run" })).toHaveAttribute(
        "href",
        "/proof",
      );
      await expect(page.getByRole("button", { name: /Connect|demo signer/i })).toHaveCount(0);
      await expect(page.getByLabel("Email")).toBeVisible();
      expect(traffic.filter((url) => url.includes("/api/session"))).toEqual([]);
      expect(traffic.filter((url) => url.startsWith(API_URL))).toEqual([]);
      await expectNoAxeViolations(page);
      await review(page, name);
    });
  }

  test("the site header offers the waitlist, not sign-in", async ({ page }) => {
    // #given
    await page.goto("/");
    // #then
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
    const start = page.getByRole("banner").getByRole("link", { name: "Start" });
    await expect(start).toHaveAttribute("href", "/#waitlist");
  });

  test("the waitlist says it opens shortly while core has no store", async ({ page }) => {
    // #given core answers not_configured and Turnstile passes
    await passTurnstile(page);
    await page.route(`${API_URL}/waitlist`, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: {
          type: "/problems/not_configured",
          title: "Not configured",
          status: 503,
          code: "not_configured",
          detail: "Hyperdrive binding HYPERDRIVE is missing",
          requestId: "00000000-0000-4000-8000-000000000000",
        },
      }),
    );
    await page.goto("/app");
    // #when
    await page.getByLabel("Email").fill("person@example.com");
    await page.getByRole("button", { name: "Join the waitlist" }).click();
    // #then
    await expect(page.getByRole("status")).toContainText("The waitlist opens shortly.");
    await expect(page.getByText(/Hyperdrive|database|not_configured/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "repository on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/winsznx/paycheck-router",
    );
  });
});
