import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** PRD 17.1: zero axe violations against WCAG 2.2 AA on every route and state. */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary).toEqual([]);
}

/** PRD 4 "Labels": the fork banner is visible on every demo screen. */
export async function expectForkBanner(page: Page): Promise<void> {
  const banner = page.getByTestId("fork-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveText("Mainnet fork (Surfpool) · no real funds");
}
