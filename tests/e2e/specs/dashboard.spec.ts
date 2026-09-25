import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "../a11y.ts";
import { mockSignedInApi } from "../fixtures/api.ts";

const WIDTHS = [320, 360, 390, 768, 1024, 1280] as const;

async function expectNoHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const offenders =
    overflow > 0
      ? await page.evaluate(() =>
          [...document.querySelectorAll("body *")]
            .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
            .slice(0, 5)
            .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`),
        )
      : [];
  expect(
    overflow,
    `${where} scrolls sideways by ${overflow}px: ${offenders.join(", ")}`,
  ).toBeLessThanOrEqual(0);
}

test.describe("home dashboard", () => {
  test.beforeEach(async ({ page }) => {
    // The just-landed split animates its text in; axe would sample it mid-fade.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockSignedInApi(page);
  });

  test("KPI tiles, the invested chart and holdings come from the API", async ({ page }) => {
    // #given the fixture router with one paycheck: three slices bought, OpenAI waiting
    await page.goto("/app");
    // #then
    const tiles = page.locator(".kpi");
    await expect(tiles).toHaveCount(4);
    await expect(tiles.nth(0)).toContainText("Invested so far");
    await expect(tiles.nth(0)).toContainText("$333.00");
    await expect(tiles.nth(1)).toContainText("$37.00");
    await expect(tiles.nth(1)).toContainText("1 slice, each with a named reason");
    await expect(page.getByRole("img", { name: /invested over 1 paycheck/ })).toBeVisible();
    await expect(page.locator(".invest-chart table tbody tr")).toHaveCount(1);
    await expect(page.locator(".holding-row img.pr-asset-icon").first()).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("home fits from 320 to 1280 px", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator(".kpi").first()).toBeVisible();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(100);
      await expectNoHorizontalScroll(page, `/app at ${width}px`);
    }
  });
});
