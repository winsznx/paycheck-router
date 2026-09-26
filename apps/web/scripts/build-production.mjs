#!/usr/bin/env node
/**
 * The production Worker build (`paycheck-router`): the public site against the deployed core,
 * before the mainnet deploy. Every build-time value is set here, so the build refuses to run
 * beside a local env file: OpenNext compiles `.env`, `.env.production`, `.env.local` and
 * `.env.production.local` (app and repo root) into the Worker, and `pnpm demo:record` writes
 * `apps/web/.env.local` with the demo signer secret.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appDir, "..", "..");

const TURNSTILE_SITE_KEY = "0x4AAAAAAFDQGy1MnmLBUS_3";

/**
 * `production` is the public site (worker paycheck-router); `hosted-demo` is the full app on the
 * hosted fork (worker paycheck-router-demo, wrangler env hosted-demo). The production site links
 * to the hosted demo only when NEXT_PUBLIC_HOSTED_DEMO_URL is set for its build.
 */
const TARGETS = {
  production: {
    NEXT_PUBLIC_ENVIRONMENT: "production",
    NEXT_PUBLIC_MAINNET_DEPLOYED: "false",
    NEXT_PUBLIC_API_URL: "https://paycheck-router-core.timjosh507.workers.dev",
    NEXT_PUBLIC_SITE_URL: "https://paycheck-router.timjosh507.workers.dev",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE_SITE_KEY,
    NEXT_PUBLIC_HOSTED_DEMO_URL: process.env.NEXT_PUBLIC_HOSTED_DEMO_URL ?? "",
  },
  "hosted-demo": {
    NEXT_PUBLIC_ENVIRONMENT: "hosted-demo",
    NEXT_PUBLIC_MAINNET_DEPLOYED: "false",
    NEXT_PUBLIC_API_URL: "https://paycheck-router-demo-core.timjosh507.workers.dev",
    NEXT_PUBLIC_SITE_URL: "https://paycheck-router-demo.timjosh507.workers.dev",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE_SITE_KEY,
    NEXT_PUBLIC_HOSTED_DEMO_URL: "",
  },
};

const target = process.argv[2] ?? "production";
const PRODUCTION_ENV = TARGETS[target];
if (!PRODUCTION_ENV) {
  console.error(
    `build-production: unknown target "${target}"; use ${Object.keys(TARGETS).join(" or ")}`,
  );
  process.exit(1);
}

const BUNDLED_ENV_FILES = [".env", ".env.production", ".env.local", ".env.production.local"];

const present = [appDir, repoRoot].flatMap((dir) =>
  BUNDLED_ENV_FILES.map((name) => path.join(dir, name)).filter((file) => existsSync(file)),
);
if (present.length > 0) {
  console.error(
    `build-production: move these aside first, OpenNext would bundle them into the Worker:\n${present
      .map((file) => `  ${path.relative(repoRoot, file)}`)
      .join("\n")}`,
  );
  process.exit(1);
}
if (process.env.DEMO_SIGNER_SECRET) {
  console.error("build-production: DEMO_SIGNER_SECRET is set in the environment; unset it first.");
  process.exit(1);
}

const result = spawnSync("opennextjs-cloudflare", ["build"], {
  cwd: appDir,
  stdio: "inherit",
  env: { ...process.env, ...PRODUCTION_ENV },
});
process.exit(result.status ?? 1);
