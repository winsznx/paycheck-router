import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "../a11y.ts";

test.describe("landing", () => {
  test("the hero shows the recorded paycheck and its fork label", async ({ page }) => {
    // #given
    await page.goto("/");
    // #then the phone renders the run's paycheck, not a mockup
    const stage = page.locator(".hero-stage");
    await expect(stage).toContainText("$1,850.00 from Employer (demo)");
    await expect(stage.locator("figcaption")).toContainText(
      "Recorded on a Surfpool fork of mainnet",
    );
    await expectNoAxeViolations(page);
  });

  test("How it works switches to the chosen step's moment in the run", async ({ page }) => {
    // #given
    await page.goto("/");
    const steps = page.locator(".how-stepper__list button");
    await expect(steps.first()).toHaveAttribute("aria-pressed", "true");
    // #when
    await steps.nth(2).click();
    // #then
    await expect(steps.nth(2)).toHaveAttribute("aria-pressed", "true");
    await expect(steps.first()).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".how-stepper__panel")).toContainText("What each slice did");
    await expectNoAxeViolations(page);
  });

  test("the phone menu opens, closes with Escape and gives focus back", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1280) >= 1024, "the menu is for narrow screens");
    // #given
    await page.goto("/");
    const button = page.getByRole("button", { name: "Menu" });
    // #when
    await button.click();
    // #then
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByRole("navigation", { name: "Site menu" });
    await expect(menu.getByRole("link", { name: "How it works" })).toBeFocused();
    await expectNoAxeViolations(page);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
  });
});
