import { generateKeyPairSync } from "node:crypto";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/** A throwaway session key per test run; production keys come from Workers secrets. */
function testSessionKey(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "vitest" });
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["test/node/**/*.test.ts"],
          environment: "node",
          testTimeout: 30_000,
        },
      },
      {
        plugins: [
          cloudflareTest(({ inject }) => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: { SESSION_SIGNING_KEY: testSessionKey() },
              hyperdrives: { HYPERDRIVE: inject("databaseUrl") },
            },
          })),
        ],
        test: {
          name: "workers",
          include: ["test/workers/**/*.test.ts"],
          globalSetup: ["./test/global-setup.ts"],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
