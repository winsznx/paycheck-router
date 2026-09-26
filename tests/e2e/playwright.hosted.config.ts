import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_HOSTED_PORT ?? 3400);
const MOCK_CORE_PORT = Number(process.env.MOCK_CORE_PORT ?? 18787);
const API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8787";

/**
 * The hosted demo build (`pnpm e2e:hosted`): NEXT_PUBLIC_ENVIRONMENT=hosted-demo against routed
 * core responses. It rebuilds apps/web, so don't run it beside `pnpm e2e` or `pnpm e2e:public`.
 */
export default defineConfig({
  testDir: "./specs-hosted",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "iphone-13", use: { ...devices["iPhone 13"], browserName: "chromium" } },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      command: `pnpm exec tsx fixtures/mock-core.ts`,
      url: `http://127.0.0.1:${MOCK_CORE_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { MOCK_CORE_PORT: String(MOCK_CORE_PORT) },
    },
    {
      command: `pnpm --filter @paycheck-router/web build && pnpm --filter @paycheck-router/web start --port ${PORT}`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        NEXT_PUBLIC_ENVIRONMENT: "hosted-demo",
        NEXT_PUBLIC_API_URL: API_URL,
        NEXT_PUBLIC_MAINNET_DEPLOYED: "false",
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAFDQGy1MnmLBUS_3",
        // A local apps/web/.env.local from demo:record holds the demo secret; this build must
        // not see it (next.config.ts fails the build otherwise).
        DEMO_SIGNER_SECRET: "",
        NEXT_TELEMETRY_DISABLED: "1",
        CORE_API_URL: `http://127.0.0.1:${MOCK_CORE_PORT}`,
      },
    },
  ],
});
