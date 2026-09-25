import { expect, test } from "@playwright/test";
import { expectForkBanner, expectNoAxeViolations } from "../a11y.ts";

const PAGES = [
  ["/how-it-works", "How it works"],
  ["/assets", "Assets"],
  ["/assets/SPYx", "SP500 xStock"],
  ["/assets/OpenAI", "OpenAI PreStocks"],
  ["/security", "Security"],
  ["/fees", "Fees"],
  ["/status", "Status"],
  ["/help", "Help"],
  ["/partners", "For payroll platforms"],
  ["/legal/terms", "Terms"],
  ["/legal/risk", "Risk disclosure"],
  ["/legal/privacy", "Privacy"],
  ["/legal/restricted-countries", "Restricted countries"],
  ["/fr/legal/terms", "Conditions"],
] as const;

test.describe("public pages", () => {
  for (const [path, heading] of PAGES) {
    test(`${path} renders with the fork banner and passes axe`, async ({ page }) => {
      // #given
      await page.goto(path);
      // #then
      await expect(page.getByTestId("fork-banner")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }

  test("landing sends Start to the waitlist before the mainnet deploy", async ({ page }) => {
    // #given
    await page.goto("/");
    // #then
    await expectForkBanner(page);
    await expect(page.getByRole("link", { name: "Join the waitlist" }).first()).toHaveAttribute(
      "href",
      "/#waitlist",
    );
    await expect(page.getByRole("link", { name: "See the fork run" })).toBeVisible();
    await expect(page.getByLabel("Email (required)")).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
