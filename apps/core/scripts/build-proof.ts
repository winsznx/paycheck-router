/**
 * Bakes the canonical fork bundle into the Worker: the manifest as committed, plus the report
 * `@paycheck-router/verify` produces by re-deriving every slice from the bundle's raw artifacts.
 * Run after the bundle changes: `pnpm --filter @paycheck-router/core build:proof`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveMultiplier, multiplierToE12 } from "@paycheck-router/guard-math";
import { getPaycheckDecoder } from "@paycheck-router/sdk";
import { assetByMint, MANIFEST_FILE, RunManifest } from "@paycheck-router/shared";
import { verifyBundle } from "@paycheck-router/verify";
import { getBase64Encoder } from "@solana/kit";
import { measureQuote } from "../src/engine/premium.ts";

const BUNDLE_DIR = resolve(import.meta.dirname, "../../../evidence/stocklana-fork");
const OUT = resolve(import.meta.dirname, "../src/proof/generated/fork-bundle.ts");
const MAINNET_RPC = "https://api.mainnet-beta.solana.com";

const manifest = RunManifest.parse(
  JSON.parse(readFileSync(resolve(BUNDLE_DIR, MANIFEST_FILE), "utf8")),
);
const report = await verifyBundle(BUNDLE_DIR);

/**
 * Times come from the Paycheck account read back after each execution (the program's clock),
 * not from getTransaction's blockTime, which Surfpool 1.5.0 reports divided by 1,000.
 */
const executedAt: Record<number, string> = {};
let recordedAt: string | null = null;
for (const leg of manifest.legs) {
  if (!leg.executed) continue;
  const raw = JSON.parse(readFileSync(resolve(BUNDLE_DIR, leg.executed.readback.path), "utf8")) as {
    result: { value: { data: [string, string] } };
  };
  const paycheck = getPaycheckDecoder().decode(
    Uint8Array.from(getBase64Encoder().encode(raw.result.value.data[0])),
  );
  recordedAt = new Date(Number(paycheck.recordedAt) * 1000).toISOString();
  const state = paycheck.legs[leg.index];
  if (state) executedAt[leg.index] = new Date(Number(state.executedAt) * 1000).toISOString();
}

/**
 * The Scaled UI multiplier a mint applied at `at`. The bundle does not record mint accounts, so
 * this reads the mint's ScaledUiAmountConfig from mainnet (read-only) and applies the
 * multiplier in force at the attempt's time.
 */
async function multiplierAt(mint: string, at: Date): Promise<{ e12: bigint; value: number }> {
  const response = await fetch(MAINNET_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [mint, { encoding: "jsonParsed" }],
    }),
  });
  const body = (await response.json()) as {
    result?: {
      value?: {
        data?: {
          parsed?: {
            info?: {
              extensions?: {
                extension: string;
                state?: {
                  multiplier?: string;
                  newMultiplier?: string;
                  newMultiplierEffectiveTimestamp?: number;
                };
              }[];
            };
          };
        };
      };
    };
  };
  const scaled = body.result?.value?.data?.parsed?.info?.extensions?.find(
    (ext) => ext.extension === "scaledUiAmountConfig",
  )?.state;
  const value = scaled?.multiplier
    ? effectiveMultiplier(
        {
          multiplier: Number(scaled.multiplier),
          newMultiplier: Number(scaled.newMultiplier ?? scaled.multiplier),
          newMultiplierEffectiveTimestamp: BigInt(scaled.newMultiplierEffectiveTimestamp ?? 0),
        },
        BigInt(Math.floor(at.getTime() / 1000)),
      )
    : 1;
  return { e12: multiplierToE12(value, "down"), value };
}

/** What each waiting slice's last attempt measured: its Jupiter quote against its reference. */
const quotes: Record<number, { premiumBps: number; refPriceE9: string; note: string }> = {};
for (const leg of manifest.legs) {
  const attempt = leg.attempts.at(-1);
  const asset = assetByMint(leg.mint);
  if (leg.state !== "WAITING" || !attempt?.jupiterBuild || !asset) continue;
  const build = JSON.parse(
    readFileSync(resolve(BUNDLE_DIR, attempt.jupiterBuild.path), "utf8"),
  ) as {
    inAmount: string;
    outAmount: string;
  };
  const multiplier = await multiplierAt(leg.mint, new Date(attempt.startedAt));
  const measured = measureQuote(
    asset,
    {
      parsed: attempt.prices.map((price) => ({
        id: price.feedId,
        price: { price: price.price, expo: price.exponent },
      })),
      markPriceE9: attempt.attestation ? BigInt(attempt.attestation.markPriceE9) : null,
      quotedIn: BigInt(build.inAmount),
      quotedOut: BigInt(build.outAmount),
    },
    multiplier.e12,
  );
  if (!measured) continue;
  quotes[leg.index] = {
    premiumBps: measured.premiumBps,
    refPriceE9: measured.refPriceE9.toString(),
    note: `Jupiter quote in the bundle against the ${measured.source === "mark" ? "signed PreStocks mark" : "posted Pyth price"}; Scaled UI multiplier ${multiplier.value} read from the mainnet mint at build time`,
  };
}

const source = `// Generated by apps/core/scripts/build-proof.ts from evidence/stocklana-fork. Do not edit.
import type { RunManifest } from "@paycheck-router/shared";
import type { BundleReport } from "../bundle-report.ts";

export const FORK_MANIFEST: RunManifest = ${JSON.stringify(manifest, null, 2)};

export const FORK_REPORT: BundleReport = ${JSON.stringify(report, null, 2)};

/** From the Paycheck readbacks: when the paycheck was recorded and each slice executed. */
export const FORK_TIMES: { recordedAt: string | null; executedAt: Record<number, string> } = ${JSON.stringify({ recordedAt, executedAt }, null, 2)};

/** Waiting slices: the premium the last attempt's quote implied against its reference. */
export const FORK_QUOTES: Record<number, { premiumBps: number; refPriceE9: string; note: string }> = ${JSON.stringify(quotes, null, 2)};
`;
writeFileSync(OUT, source);
console.log(
  `wrote ${OUT}: run ${manifest.runId}, ${report.slices.length} slices, bundle ${report.pass ? "PASS" : "FAIL"}`,
);
