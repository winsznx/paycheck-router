import { chromium, devices } from "@playwright/test";

const base = process.env.BASE ?? "http://localhost:3300";
const out = process.env.OUT;
const pages = (process.env.PAGES ?? "landing=/").split(",").map((p) => p.split("="));
const browser = await chromium.launch();
for (const [device, options] of [
  ["phone", { ...devices["iPhone 13"], deviceScaleFactor: 2, reducedMotion: "reduce" }],
  [
    "desktop",
    { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: "reduce" },
  ],
]) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  for (const [name, path] of pages) {
    await page.goto(base + path, { waitUntil: "load", timeout: 120000 });
    await page.waitForTimeout(2500);
    await page.evaluate(async () => {
      for (const img of document.querySelectorAll("img[loading=lazy]")) img.loading = "eager";
      await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
    });
    await page.screenshot({ path: `${out}/${name}-${device}.png`, fullPage: true });
    console.log(device, name);
  }
  await context.close();
}
await browser.close();
