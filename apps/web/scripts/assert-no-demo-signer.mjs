#!/usr/bin/env node
/**
 * Fails a non-demo build whose output contains the demo signer: its secret (when present in
 * the environment) or the signer module's marker. Runs after `next build` and `serwist build`.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "paycheck-router:demo-signer";
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environment = process.env.NEXT_PUBLIC_ENVIRONMENT ?? "local";
const secret = process.env.DEMO_SIGNER_SECRET ?? "";

if (environment === "demo") {
  console.log("assert-no-demo-signer: demo build, skipping");
  process.exit(0);
}

const roots = [".next/static", ".next/server", "public"].map((dir) => path.join(appDir, dir));
const TEXT = /\.(?:js|mjs|cjs|json|html|rsc|txt|map)$/;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "cache") continue;
      yield* walk(full);
    } else if (TEXT.test(entry.name)) {
      yield full;
    }
  }
}

const offenders = [];
for (const root of roots) {
  for await (const file of walk(root)) {
    if ((await stat(file)).size > 20 * 1024 * 1024) continue;
    const content = await readFile(file, "utf8");
    if (content.includes(MARKER) || (secret.length > 0 && content.includes(secret))) {
      offenders.push(path.relative(appDir, file));
    }
  }
}

if (offenders.length > 0) {
  console.error(`assert-no-demo-signer: the demo signer leaked into a "${environment}" build:`);
  for (const file of offenders) console.error(`  ${file}`);
  process.exit(1);
}
console.log(`assert-no-demo-signer: clean "${environment}" build`);
