import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The demo signer's fork-only secret may exist only in a demo build (PRD 4 "Signing").
 * A production-phase build with the secret present and any other environment fails here;
 * scripts/assert-no-demo-signer.mjs then scans the output for the secret and the signer code.
 */
function assertDemoSignerIsolation(phase: string): void {
  if (phase !== PHASE_PRODUCTION_BUILD) return;
  const environment = process.env.NEXT_PUBLIC_ENVIRONMENT;
  if (process.env.DEMO_SIGNER_SECRET && environment !== "demo") {
    throw new Error(
      `DEMO_SIGNER_SECRET is set for a "${environment ?? "unset"}" build. The demo signer ships only when NEXT_PUBLIC_ENVIRONMENT=demo.`,
    );
  }
}

export default function config(phase: string): NextConfig {
  assertDemoSignerIsolation(phase);
  return withNextIntl({
    reactStrictMode: true,
    poweredByHeader: false,
    transpilePackages: ["@paycheck-router/ui", "@paycheck-router/shared"],
    turbopack: { root: monorepoRoot },
    outputFileTracingRoot: monorepoRoot,
    images: { unoptimized: true },
    experimental: { optimizePackageImports: ["@paycheck-router/ui"] },
    async headers() {
      return [
        {
          source: "/sw.js",
          headers: [
            { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
            { key: "Service-Worker-Allowed", value: "/" },
          ],
        },
      ];
    },
  });
}
