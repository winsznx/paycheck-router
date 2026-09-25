import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PUBLIC_PORT ?? 3300);
const MOCK_CORE_PORT = Number(process.env.MOCK_CORE_PORT ?? 18787);

/**
 * The public build before the mainnet deploy (`pnpm e2e:public`): production environment,
 * MAINNET_DEPLOYED=false. It rebuilds apps/web, so don't run it beside `pnpm e2e`.
 */
export default defineConfig({
  testDir: "./specs-public",
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
        NEXT_PUBLIC_ENVIRONMENT: "production",
        NEXT_PUBLIC_MAINNET_DEPLOYED: "false",
        // A local apps/web/.env.local from demo:record holds the demo secret; a public build
        // must not see it (next.config.ts fails the build otherwise).
        DEMO_SIGNER_SECRET: "",
        NEXT_TELEMETRY_DISABLED: "1",
        CORE_API_URL: `http://127.0.0.1:${MOCK_CORE_PORT}`,
      },
    },
  ],
});
