import { defineConfig, devices } from "@playwright/test";

/**
 * `pnpm e2e:live`: the rehearsal against a running `pnpm demo:record` stack (real surfnet, core
 * and web). It is never part of `pnpm e2e`; nothing here serves fixtures.
 */
export default defineConfig({
  testDir: "./live",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    actionTimeout: 60_000,
    navigationTimeout: 120_000,
  },
  projects: [
    {
      name: "phone-390",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
