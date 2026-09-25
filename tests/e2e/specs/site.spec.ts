import { expect, test } from "@playwright/test";
import { expectForkBanner, expectNoAxeViolations } from "../a11y.ts";

test.describe("public site shell", () => {
  test("landing shows the fork banner and passes axe", async ({ page }) => {
    // #given the landing page in demo mode
    await page.goto("/");
    // #then
    await expectForkBanner(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("locale prefixes serve translated pages", async ({ page }) => {
    // #given the Brazilian Portuguese path
    await page.goto("/pt-br");
    // #then the document language and banner follow the locale
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.getByTestId("fork-banner")).toHaveText(
      "Fork da mainnet (Surfpool) · sem fundos reais",
    );
    await expectNoAxeViolations(page);
  });

  test("skip link moves focus to the content", async ({ page }) => {
    // #given
    await page.goto("/");
    // #when
    await page.keyboard.press("Tab");
    // #then
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  });
});
