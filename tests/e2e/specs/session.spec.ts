import { expect, type Page, test } from "@playwright/test";
import { API_URL } from "../fixtures/api.ts";

/** Everything the browser asked for, with the status it got back. */
function recordTraffic(page: Page): { url: string; status: number }[] {
  const seen: { url: string; status: number }[] = [];
  page.on("response", (response) => seen.push({ url: response.url(), status: response.status() }));
  return seen;
}

/**
 * A Wallet Standard wallet that the sign-in step lists. It is never asked to sign here: the
 * nonce request fails first.
 */
async function registerTestWallet(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const unused = () => Promise.reject(new Error("not used in this test"));
    const wallet = {
      version: "1.0.0",
      name: "E2E wallet",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
      chains: ["solana:localnet", "solana:mainnet"],
      accounts: [],
      features: {
        "standard:connect": { version: "1.0.0", connect: unused },
        "standard:events": { version: "1.0.0", on: () => () => undefined },
        "solana:signTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: [0],
          signTransaction: unused,
        },
        "solana:signMessage": { version: "1.0.0", signMessage: unused },
      },
    };
    type AppApi = { register: (w: unknown) => void };
    const registerWith = (api: AppApi) => api.register(wallet);
    // The Wallet Standard handshake: answer the app's ready event, and announce ourselves in
    // case the app is already listening.
    window.addEventListener("wallet-standard:app-ready", (event) =>
      registerWith((event as CustomEvent<AppApi>).detail),
    );
    window.dispatchEvent(
      new CustomEvent("wallet-standard:register-wallet", { detail: registerWith }),
    );
  });
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
    await registerTestWallet(page);
    await page.goto("/app/onboarding/sign-in");
    // #when the visitor signs in
    await page.getByRole("button", { name: /E2E wallet/ }).click();
    // #then they read what happened and what to do, and none of the detail
    await expect(
      page.getByRole("alert").filter({
        hasText: "This part of Paycheck Router isn't switched on here yet. Please come back later.",
      }),
    ).toBeVisible();
    await expect(page.getByText(/Hyperdrive|database|not_configured/)).toHaveCount(0);
  });
});
