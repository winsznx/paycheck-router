import { createPublicKey, verify } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "../a11y.ts";
import { API_URL, mockSignedInApi, session } from "../fixtures/api.ts";
import { anthropicSignature } from "../fixtures/fork-run.ts";

const HOUR = 60 * 60 * 1000;
const WIDTHS = [320, 390, 768, 1280] as const;

async function demoStatus(
  page: Page,
  state: "up" | "resetting" | "down",
  lastResetAt = new Date(Date.now() - HOUR).toISOString(),
) {
  await page.route(`${API_URL}/demo/status`, (route) =>
    route.fulfill({
      json: {
        state,
        lastResetAt,
        resetsAt: new Date(Date.parse(lastResetAt) + 6 * HOUR).toISOString(),
      },
    }),
  );
}

async function review(page: Page, name: string) {
  if (!process.env.REVIEW_SCREENSHOTS) return;
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: `screenshots/review/hosted-demo/${name}-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

async function expectNoHorizontalScroll(page: Page) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${page.url()} at ${width}px`).toBeLessThanOrEqual(0);
  }
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(text: string): Buffer {
  let value = 0n;
  for (const char of text) value = value * 58n + BigInt(BASE58.indexOf(char));
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value % 256n));
    value /= 256n;
  }
  for (const char of text) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}

/** An Ed25519 public key from a Solana address, for checking a signature the way core does. */
function publicKeyOf(address: string) {
  const raw = base58Decode(address);
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]);
  return createPublicKey({ key: spki, format: "der", type: "spki" });
}

test.describe("hosted demo", () => {
  test("a slice proof shows no explorer links into the private fork", async ({ page }) => {
    // #given the recorded slice, whose API links point Explorer at the fork RPC
    await page.goto(`/proof/${anthropicSignature}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // #then nothing on the page sends a viewer to Explorer through a custom cluster
    await expect(page.locator('a[href*="customUrl="]')).toHaveCount(0);
    await expect(page.locator('a[href*="explorer.solana.com/tx"]')).toHaveCount(0);
    // and the slice itself links to this proof view
    await expect(page.locator(`a[href="/proof/${anthropicSignature}"]`).first()).toBeVisible();
  });

  test("the header's Start opens onboarding, not the waitlist", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("banner").getByRole("link", { name: "Start" })).toHaveAttribute(
      "href",
      "/app/onboarding/welcome",
    );
  });

  test("signs in with a wallet made in this browser, never a server key", async ({ page }) => {
    // #given the fork is up and core issues a SIWS nonce
    await demoStatus(page, "up");
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.route(`${API_URL}/auth/nonce`, (route) =>
      route.fulfill({
        json: {
          nonce: "e2e-nonce-12345",
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          domain: new URL(page.url() || "http://127.0.0.1").host,
          uri: "http://127.0.0.1",
          statement: "Sign in to Paycheck Router",
          version: "1",
          chainId: "localnet",
        },
      }),
    );
    let verified = false;
    await page.route("**/api/session", async (route) => {
      const body = route.request().postDataJSON() as {
        address: string;
        message: string;
        signature: string;
      };
      // The signature is checked here exactly as core checks it: Ed25519 over the message bytes.
      verified = verify(
        null,
        Buffer.from(body.message, "utf8"),
        publicKeyOf(body.address),
        Buffer.from(body.signature, "base64"),
      );
      await route.fulfill({
        status: verified ? 200 : 401,
        headers: { "set-cookie": "pr_signed_in=1; Path=/" },
        json: { ...session, wallet: body.address },
      });
    });
    await page.goto("/app/onboarding/sign-in");
    // #then the fork banner says it resets, and the fork wallet is offered with its warning
    await expect(page.getByTestId("fork-banner")).toHaveText(
      "Mainnet fork (Surfpool) · Resets every 6 hours · no real funds",
    );
    await expect(
      page.getByText("Made in this browser for the demo fork.", { exact: false }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    // #when
    await review(page, "sign-in");
    await page.getByRole("button", { name: "Continue with Fork demo wallet" }).click();
    // #then its signature verifies and onboarding moves on to fork funds
    await page.waitForURL(/\/app\/onboarding\/fund$/);
    expect(verified).toBe(true);
    expect(requests.filter((url) => url.includes("/api/demo-signer"))).toEqual([]);
  });

  test("the fund step tops up the fork wallet", async ({ page }) => {
    // #given
    await mockSignedInApi(page);
    await demoStatus(page, "up");
    await page.route(`${API_URL}/demo/fund`, (route) =>
      route.fulfill({
        json: { wallet: session.wallet, lamports: "50000000", usdc: "5000000000", signatures: [] },
      }),
    );
    await page.goto("/app/onboarding/fund");
    await expectNoAxeViolations(page);
    // #when
    await page.getByRole("button", { name: "Get fork funds" }).click();
    // #then
    await expect(
      page.getByText("$5,000 USDC and 0.05 SOL landed in your fork wallet."),
    ).toBeVisible();
    await review(page, "fund");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/app\/onboarding\/eligibility$/);
  });

  test("home sends a fork paycheck of the chosen amount", async ({ page }) => {
    // #given a signed-in visitor with a router
    await mockSignedInApi(page);
    await demoStatus(page, "up");
    let sent: unknown = null;
    await page.route(`${API_URL}/demo/paycheck`, (route) => {
      sent = route.request().postDataJSON();
      return route.fulfill({
        json: {
          signature: session.wallet.repeat(2).slice(0, 88),
          amountUsdc: "500000000",
          slot: "1",
        },
      });
    });
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Send yourself a paycheck" })).toBeVisible();
    await expectNoAxeViolations(page);
    // #when
    await page.getByRole("button", { name: "$500" }).click();
    await page.getByRole("button", { name: "Send a $500 paycheck" }).click();
    // #then
    await expect(page.getByText("$500 is on its way.", { exact: false })).toBeVisible();
    expect(sent).toEqual({ amountUsdc: "500000000" });
    await review(page, "home");
    await expectNoHorizontalScroll(page);
  });

  test("a resetting or unreachable fork reads as calm copy", async ({ page }) => {
    await mockSignedInApi(page);
    await demoStatus(page, "resetting");
    await page.goto("/app");
    await expect(page.getByText("The demo fork is resetting.", { exact: false })).toBeVisible();

    await page.unroute(`${API_URL}/demo/status`);
    await page.route(`${API_URL}/demo/status`, (route) => route.abort());
    await page.reload();
    await expect(
      page.getByText("The demo fork isn't reachable right now.", { exact: false }),
    ).toBeVisible();
  });

  test("after a fork reset, the old session is dropped and onboarding starts again", async ({
    page,
  }) => {
    // #given this browser last used a fork that has since been replaced
    await page.addInitScript(() => {
      window.localStorage.setItem("pr_fork_epoch", "2026-01-01T00:00:00.000Z");
    });
    await mockSignedInApi(page);
    await demoStatus(page, "up", new Date(Date.now() - 10 * 60_000).toISOString());
    // #when
    await page.goto("/app");
    // #then
    await page.waitForURL(/\/app\/onboarding\/welcome$/);
    await expect(page.getByText("The demo fork was reset.", { exact: false })).toBeVisible();
  });

  test("the fork wallet exports its key", async ({ page }) => {
    await mockSignedInApi(page);
    await demoStatus(page, "up");
    await page.goto("/app/settings/security");
    await page.getByRole("button", { name: "Export key" }).click();
    const key = page.getByRole("dialog").locator(".fork-secret");
    await expect(key).toHaveText(/^[1-9A-HJ-NP-Za-km-z]{86,88}$/);
  });
});
