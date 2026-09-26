import { expect, test } from "@playwright/test";
import { anthropicSignature } from "../fixtures/fork-run.ts";

/** Share cards are server output; one browser project is enough. */
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop", "OG images don't depend on the device");
});

test("the OG route draws the bundled logos", async ({ request }) => {
  // #given the same card with and without logos
  const title = encodeURIComponent("Proof");
  const plain = await request.get(`/api/og?title=${title}`);
  const withLogos = await request.get(`/api/og?title=${title}&a=SPYx,NVDAx,Anthropic,OpenAI`);
  // #then both render, and the logos add real image data
  for (const response of [plain, withLogos]) {
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
  }
  const added = (await withLogos.body()).length - (await plain.body()).length;
  expect(added, `logos added ${added} bytes`).toBeGreaterThan(8_000);
});

for (const [name, path] of [
  ["landing", "/"],
  ["asset", "/assets/SPYx"],
  ["proof", "/proof"],
  ["slice proof", `/proof/${anthropicSignature}`],
] as const) {
  test(`${name} shares a card with its assets' logos`, async ({ page, request }) => {
    // #given
    await page.goto(path);
    const image = await page.locator('meta[property="og:image"]').first().getAttribute("content");
    expect(image).toBeTruthy();
    const url = new URL(image ?? "", page.url());
    // #then the card names its assets and renders as a PNG
    expect(url.searchParams.get("a")).toBeTruthy();
    const response = await request.get(`${url.pathname}${url.search}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
  });
}
