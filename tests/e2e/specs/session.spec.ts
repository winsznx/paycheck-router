import { expect, type Page, test } from "@playwright/test";
import { API_URL } from "../fixtures/api.ts";

/** Everything the browser asked for, with the status it got back. */
function recordTraffic(page: Page): { url: string; status: number }[] {
  const seen: { url: string; status: number }[] = [];
  page.on("response", (response) => seen.push({ url: response.url(), status: response.status() }));
  return seen;
}

test.describe("anonymous visitors", () => {
  test("never call the session or authenticated endpoints", async ({ page }) => {
    // #given a visitor who has never signed in
    const traffic = recordTraffic(page);
    // #when they open the app and land on onboarding
    await page.goto("/app");
    await page.waitForURL(/\/app\/onboarding\/welcome$/);
    await page.goto("/app/onboarding/sign-in");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // #then nothing asked for a session, and nothing answered 401
    expect(traffic.filter((r) => r.url.includes("/api/session"))).toEqual([]);
    expect(traffic.filter((r) => r.url.startsWith(API_URL))).toEqual([]);
    expect(traffic.filter((r) => r.status === 401)).toEqual([]);
  });
});

test.describe("problem copy", () => {
  test("a deployment without a database reads as plain language, not the upstream detail", async ({
    page,
  }) => {
    // #given core answers the SIWS nonce with not_configured and a technical detail
    await page.route(`${API_URL}/auth/nonce`, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: {
          type: "/problems/not_configured",
          title: "Not configured",
          status: 503,
          code: "not_configured",
          detail: "Hyperdrive binding HYPERDRIVE is missing; the database is not configured",
          requestId: "00000000-0000-4000-8000-000000000000",
        },
      }),
    );
    await page.goto("/app/onboarding/sign-in");
    const demoWallet = page.getByRole("button", { name: /Paycheck Router demo signer/ });
    test.skip((await demoWallet.count()) === 0, "the demo signer isn't registered in this build");
    // #when the visitor signs in
    await demoWallet.click();
    // #then they read what happened and what to do, and none of the detail
    const alert = page.getByRole("alert");
    await expect(alert).toHaveText(
      "This part of Paycheck Router isn't switched on here yet. Please come back later.",
    );
    await expect(page.getByText(/Hyperdrive|database|not_configured/)).toHaveCount(0);
  });
});
