import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyBundle } from "../src/verify-bundle.ts";

/** A recorded fork run: SPYx failed to post, NVDAx refused by Hermes, OpenAI over its band. */
const RUN = resolve(import.meta.dirname, "..", "..", "..", "evidence", "2026-09-25T12-55-45-818Z");

function copyOfRun(): string {
  const dir = resolve(mkdtempSync(resolve(tmpdir(), "bundle-")), "run");
  cpSync(RUN, dir, { recursive: true });
  return dir;
}

describe("verifyBundle", () => {
  it("re-derives each waiting slice's reason from its raw artifacts", async () => {
    const report = await verifyBundle(RUN);
    expect(report.artifacts.failed).toEqual([]);
    const bySymbol = Object.fromEntries(report.slices.map((s) => [s.symbol, s]));
    expect(bySymbol.NVDAx?.claimed).toBe("WAITING PRICE_UNAVAILABLE");
    expect(bySymbol.NVDAx?.pass).toBe(true);
    expect(bySymbol.OpenAI?.claimed).toBe("WAITING PREMIUM_TOO_HIGH");
    expect(bySymbol.OpenAI?.pass).toBe(true);
  });

  it("fails slices that never reached an outcome", async () => {
    const report = await verifyBundle(RUN);
    expect(report.slices.find((s) => s.symbol === "Anthropic")?.pass).toBe(false);
    expect(report.pass).toBe(false);
  });

  it("fails when one byte of a raw artifact changes", async () => {
    const dir = copyOfRun();
    const manifest = JSON.parse(readFileSync(resolve(dir, "manifest.json"), "utf8")) as {
      artifacts: { path: string }[];
    };
    const target = manifest.artifacts.find((a) => a.path.startsWith("raw/simulation/"));
    if (!target) throw new Error("recorded run has no simulation artifact");
    const path = resolve(dir, target.path);
    const bytes = readFileSync(path);
    bytes[10] = (bytes[10] ?? 0) ^ 1;
    writeFileSync(path, bytes);
    const report = await verifyBundle(dir);
    expect(report.artifacts.failed).toEqual([target.path]);
  });

  it("fails a wait whose claimed reason the logs do not support", async () => {
    const dir = copyOfRun();
    const path = resolve(dir, "manifest.json");
    const manifest = JSON.parse(readFileSync(path, "utf8")) as {
      legs: { symbol: string; waitReason: string | null }[];
    };
    const openai = manifest.legs.find((l) => l.symbol === "OpenAI");
    if (!openai) throw new Error("recorded run has no OpenAI slice");
    openai.waitReason = "MARKET_CLOSED";
    writeFileSync(path, JSON.stringify(manifest));
    const report = await verifyBundle(dir);
    expect(report.slices.find((s) => s.symbol === "OpenAI")?.pass).toBe(false);
  });
});
