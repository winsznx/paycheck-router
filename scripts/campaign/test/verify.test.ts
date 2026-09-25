import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { summaryPath } from "../lib/summary.ts";
import { summaryDiff, verifyCampaign } from "../lib/verify.ts";
import { writeFixtureCampaign } from "./fixture.ts";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");

function copyOf(root: string): string {
  const copy = mkdtempSync(resolve(tmpdir(), "campaign-copy-"));
  cpSync(root, copy, { recursive: true });
  return copy;
}

function flipOneByte(path: string, at = 10): void {
  const bytes = readFileSync(path);
  bytes[at] = (bytes[at] ?? 0) ^ 0x01;
  writeFileSync(path, bytes);
}

describe("verify:campaign", () => {
  const root = writeFixtureCampaign();
  const run = resolve(root, "p2-control", "2026-09-25T13-00-00-000Z");

  it("rebuilds the summary from untouched artifacts", () => {
    const report = verifyCampaign(root);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checked.probes).toBe(2);
  });

  it("fails when one byte of a copied raw artifact is flipped", () => {
    const copy = copyOf(root);
    flipOneByte(
      resolve(
        copy,
        "p2-control",
        "2026-09-25T13-00-00-000Z",
        "paychecks",
        "01-untagged-sender",
        "raw",
        "balances",
        "after.json",
      ),
    );
    const report = verifyCampaign(copy);
    expect(report.ok).toBe(false);
    expect(report.errors.join("\n")).toMatch(/sha256/);
  });

  it("fails when a probe's recorded observation disagrees with its raw artifact", () => {
    const copy = copyOf(root);
    const path = resolve(copy, "p2-control", "2026-09-25T13-00-00-000Z", "manifest.json");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        '"observed": "account:absent"',
        '"observed": "account:present"',
      ),
    );
    const report = verifyCampaign(copy);
    expect(report.ok).toBe(false);
  });

  it("fails when summary.json is edited", () => {
    const copy = copyOf(root);
    const path = summaryPath(copy);
    const summary = JSON.parse(readFileSync(path, "utf8")) as { population: { slices: number } };
    summary.population.slices += 1;
    writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`);
    const report = verifyCampaign(copy);
    expect(report.ok).toBe(false);
    expect(report.errors.join("\n")).toContain("summary.population.slices");
  });

  it("exits non-zero from the CLI after a one-byte flip", () => {
    const copy = copyOf(root);
    flipOneByte(
      resolve(
        copy,
        "p2-control",
        "2026-09-25T13-00-00-000Z",
        "raw",
        "accounts",
        "untagged-sender-paycheck.json",
      ),
    );
    const clean = spawnSync("pnpm", ["exec", "tsx", "scripts/campaign/verify.ts", "--root", root], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const tampered = spawnSync(
      "pnpm",
      ["exec", "tsx", "scripts/campaign/verify.ts", "--root", copy],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
      },
    );
    expect(clean.status).toBe(0);
    expect(tampered.status).toBe(1);
    expect(tampered.stderr).toContain("MISMATCH");
  });

  it("keeps the fixture's run directory intact for the other tests", () => {
    expect(readFileSync(resolve(run, "manifest.json"), "utf8")).toContain("p2-control");
  });
});

describe("summaryDiff", () => {
  it("names the path that differs", () => {
    expect(summaryDiff({ a: { b: 1, c: 2 } }, { a: { b: 1, c: 3 } })).toEqual([
      "summary.a.c: stored 2, rebuilt 3",
    ]);
    expect(summaryDiff({ a: [1] }, { a: [1] })).toEqual([]);
  });
});
