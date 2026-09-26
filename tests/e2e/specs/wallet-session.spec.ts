import { FORK_KEYS } from "@paycheck-router/shared";
import { expect, type Page, test } from "@playwright/test";
import { API_URL, mockCoreApi, mockSignedInApi, PAYCHECK_ID, session } from "../fixtures/api.ts";

const OTHER_ACCOUNT = FORK_KEYS["employer-1"];

/**
 * A Wallet Standard wallet that connects on `address`. The app finds it by name because the
 * session remembers which wallet signed in.
 */
async function registerWalletOn(page: Page, address: string): Promise<void> {
  await page.addInitScript((accountAddress) => {
    window.localStorage.setItem("pr_wallet_name", "E2E wallet");
    const account = {
      address: accountAddress,
      publicKey: new Uint8Array(32),
      chains: ["solana:localnet", "solana:mainnet"],
      features: ["solana:signTransaction", "solana:signMessage"],
    };
    const refuse = () => Promise.reject(new Error("the test wallet never signs"));
    const wallet = {
      version: "1.0.0",
      name: "E2E wallet",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
      chains: ["solana:localnet", "solana:mainnet"],
      accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "standard:events": { version: "1.0.0", on: () => () => undefined },
        "solana:signTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: [0],
          signTransaction: refuse,
        },
        "solana:signMessage": { version: "1.0.0", signMessage: refuse },
      },
    };
    type AppApi = { register: (w: unknown) => void };
    const registerWith = (api: AppApi) => api.register(wallet);
    window.addEventListener("wallet-standard:app-ready", (event) =>
      registerWith((event as CustomEvent<AppApi>).detail),
    );
    window.dispatchEvent(
      new CustomEvent("wallet-standard:register-wallet", { detail: registerWith }),
    );
  }, address);
}

test.describe("wallet and session", () => {
  test("a wallet switched to another account is told which one to switch back to", async ({
    page,
  }) => {
    // #given a signed-in session whose wallet is now on a different account
    await mockSignedInApi(page);
    await registerWalletOn(page, OTHER_ACCOUNT);
    await page.route(`${API_URL}/legs/*/tx/cancel`, (route) =>
      route.fulfill({
        json: {
          tx: "AQID",
          summary: [],
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          feePayer: session.wallet,
          lastValidBlockHeight: "1",
        },
      }),
    );
    await page.goto(`/app/paychecks/${PAYCHECK_ID}`);
    // #when they cancel the waiting OpenAI slice
    await page.getByRole("button", { name: "Cancel slice" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Sign and cancel" }).click();
    // #then nothing is signed and the message names the account to switch back to
    const account = `${session.wallet.slice(0, 4)}…${session.wallet.slice(-4)}`;
    await expect(
      page.getByText(
        `E2E wallet is on another account. Switch it back to ${account}, then try again.`,
      ),
    ).toBeVisible();
  });

  test("an expired session sends you back to the start without an error page", async ({ page }) => {
    // #given a session whose access token is about to expire and can't be refreshed
    let refreshes = 0;
    await page.addInitScript(() => {
      document.cookie = "pr_signed_in=1; path=/";
    });
    await page.route("**/api/session/refresh", (route) => {
      refreshes += 1;
      return refreshes === 1
        ? route.fulfill({
            json: { ...session, accessTokenExpiresAt: new Date(Date.now() + 5_000).toISOString() },
          })
        : route.fulfill({
            status: 401,
            contentType: "application/problem+json",
            json: { status: 401, code: "unauthorized", title: "Not signed in" },
          });
    });
    await mockCoreApi(page);
    // #when the app next needs a token
    await page.goto("/app");
    // #then
    await page.waitForURL(/\/app\/onboarding\/welcome$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/Your router|Latest paycheck/)).toHaveCount(0);
  });

  test("signing out ends the session for this browser", async ({ page, context, baseURL }) => {
    // #given a signed-in session
    await context.addCookies([
      { name: "pr_signed_in", value: "1", url: baseURL ?? "http://127.0.0.1:3100" },
    ]);
    let refreshes = 0;
    await page.route("**/api/session/refresh", (route) => {
      refreshes += 1;
      return route.fulfill({ json: session });
    });
    await page.route("**/api/session", (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({
            status: 204,
            headers: { "set-cookie": "pr_signed_in=; Path=/; Max-Age=0" },
          })
        : route.fallback(),
    );
    await mockCoreApi(page);
    await page.goto("/app/settings/security");
    // #when
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL((url) => url.pathname === "/");
    const before = refreshes;
    await page.goto("/app");
    // #then the app no longer asks for a session and starts over
    await page.waitForURL(/\/app\/onboarding\/welcome$/);
    expect(refreshes).toBe(before);
  });
});
