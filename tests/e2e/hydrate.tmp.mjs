import { chromium } from "@playwright/test";

const base = process.env.BASE ?? "http://127.0.0.1:3100";
const browser = await chromium.launch();
for (const path of (
  process.env.PATHS ?? "/,/proof,/app/onboarding/welcome,/app/onboarding/eligibility"
).split(",")) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(base + path, { waitUntil: "load" });
  await page.waitForTimeout(2000);
  const diffs = errors
    .join("\n")
    .split("\n")
    .filter(
      (l) =>
        /^\s*[+-]\s+[a-zA-Z]/.test(l) &&
        !l.includes("A server/client") &&
        !l.includes("Variable input") &&
        !l.includes("Date formatting") &&
        !l.includes("External changing") &&
        !l.includes("Invalid HTML"),
    );
  console.log(path, errors.length, diffs.slice(0, 8).join("\n"));
  await page.close();
}
await browser.close();
