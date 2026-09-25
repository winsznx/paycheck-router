import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * PRD 16.9 device classes. By default the suite builds and starts apps/web in demo mode; set
 * E2E_BASE_URL to point it at a running `pnpm demo:record` stack instead.
 */
export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "phone-360", use: { ...devices["Galaxy S9+"], viewport: { width: 360, height: 800 } } },
    { name: "iphone-13", use: { ...devices["iPhone 13"], browserName: "chromium" } },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm --filter @paycheck-router/web build && pnpm --filter @paycheck-router/web start --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        env: { NEXT_PUBLIC_ENVIRONMENT: "demo", NEXT_TELEMETRY_DISABLED: "1" },
      },
});
