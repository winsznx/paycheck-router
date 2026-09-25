import { expect, type Page, test } from "@playwright/test";
import { mockSignedInApi, PAYCHECK_ID } from "../fixtures/api.ts";

/**
 * Every asset logo on a page resolves to a real image served by this site. Set
 * REVIEW_SCREENSHOTS=1 to also save full-page screenshots under screenshots/review/asset-icons.
 */
async function expectIconsLoaded(page: Page, minimum: number): Promise<void> {
  const icons = page.locator("img.pr-asset-icon");
  await expect(icons.first()).toBeAttached();
  expect(await icons.count()).toBeGreaterThanOrEqual(minimum);
  const broken = await page.evaluate(async () => {
    const images = [...document.querySelectorAll<HTMLImageElement>("img.pr-asset-icon")];
    const results = await Promise.all(
      images.map(async (image) => {
        image.loading = "eager";
        try {
          await image.decode();
          return image.naturalWidth > 0 ? null : image.src;
        } catch {
          return image.src;
        }
      }),
    );
    return results.filter((src): src is string => src !== null);
  });
  expect(broken).toEqual([]);
  const offOrigin = await icons.evaluateAll(
    (images) =>
      images.filter((image) => new URL((image as HTMLImageElement).src).origin !== location.origin)
        .length,
  );
  expect(offOrigin).toBe(0);
}

async function review(page: Page, name: string): Promise<void> {
  if (!process.env.REVIEW_SCREENSHOTS) return;
  await page.screenshot({
    path: `screenshots/review/asset-icons/${name}-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

test.describe("asset logos on the public site", () => {
  for (const [name, path, minimum] of [
    ["landing", "/", 4],
    ["assets", "/assets", 17],
    ["asset-anthropic", "/assets/Anthropic", 1],
    ["proof", "/proof", 1],
  ] as const) {
    test(`${path} shows a logo beside every asset`, async ({ page }) => {
      // #given
      await page.goto(path);
      // #then
      await expectIconsLoaded(page, minimum);
      await review(page, name);
    });
  }
});

test.describe("asset logos in the app", () => {
  test.beforeEach(async ({ page }) => {
    await mockSignedInApi(page);
  });

  for (const [name, path, minimum] of [
    ["home", "/app", 4],
    ["paycheck-detail", `/app/paychecks/${PAYCHECK_ID}`, 8],
    ["portfolio", "/app/portfolio", 1],
    ["activity", "/app/activity", 1],
  ] as const) {
    test(`${path} shows a logo beside every asset`, async ({ page }) => {
      // #given a signed-in session with the recorded fork paycheck
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // #then
      await expectIconsLoaded(page, minimum);
      await review(page, name);
    });
  }
});
