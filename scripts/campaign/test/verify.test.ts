import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { summaryPath } from "../lib/summary.ts";
import { summaryDiff, verifyCampaign } from "../lib/verify.ts";
import { writeFixtureCampaign } from "./fixture.ts";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
/** The workspace's tsx, run directly: `pnpm exec` re-checks the install and can stall a runner. */
const TSX = resolve(REPO_ROOT, "node_modules", ".bin", "tsx");
/** Two CLI processes, each loading the SDK through tsx. */
const CLI_TIMEOUT_MS = 60_000;

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

  it("rebuilds the summary from untouched artifacts", async () => {
    const report = await verifyCampaign(root);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checked.probes).toBe(2);
  });

  it("fails when one byte of a copied raw artifact is flipped", async () => {
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
    const report = await verifyCampaign(copy);
    expect(report.ok).toBe(false);
    expect(report.errors.join("\n")).toMatch(/sha256/);
  });

  it("fails when a probe's recorded observation disagrees with its raw artifact", async () => {
    const copy = copyOf(root);
    const path = resolve(copy, "p2-control", "2026-09-25T13-00-00-000Z", "manifest.json");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        '"observed": "account:absent"',
        '"observed": "account:present"',
      ),
    );
    const report = await verifyCampaign(copy);
    expect(report.ok).toBe(false);
  });

  it("fails when summary.json is edited", async () => {
    const copy = copyOf(root);
    const path = summaryPath(copy);
    const summary = JSON.parse(readFileSync(path, "utf8")) as { population: { slices: number } };
    summary.population.slices += 1;
    writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`);
    const report = await verifyCampaign(copy);
    expect(report.ok).toBe(false);
    expect(report.errors.join("\n")).toContain("summary.population.slices");
  });

  it(
    "exits non-zero from the CLI after a one-byte flip",
    () => {
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
      const cli = (target: string) =>
        spawnSync(TSX, ["scripts/campaign/verify.ts", "--root", target], {
          cwd: REPO_ROOT,
          encoding: "utf8",
        });
      const clean = cli(root);
      const tampered = cli(copy);
      expect([clean.status, tampered.status, tampered.stderr.includes("MISMATCH")]).toEqual([
        0,
        1,
        true,
      ]);
    },
    CLI_TIMEOUT_MS,
  );

  it("reports an artifact path written twice and still checks its last write", async () => {
    // #given a manifest that recorded the account read twice, the earlier write since replaced
    const copy = copyOf(root);
    const path = resolve(copy, "p2-control", "2026-09-25T13-00-00-000Z", "manifest.json");
    const manifest = JSON.parse(readFileSync(path, "utf8")) as {
      artifacts: { path: string; sha256: string }[];
    };
    const read = manifest.artifacts.find((a) => a.path.startsWith("raw/accounts/"));
    if (!read) throw new Error("fixture has no account read");
    manifest.artifacts.unshift({ path: read.path, sha256: "0".repeat(64) });
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);

    // #when it is verified untouched, and again after one byte of that file flips
    const untouched = await verifyCampaign(copy);
    flipOneByte(resolve(copy, "p2-control", "2026-09-25T13-00-00-000Z", read.path));
    const flipped = await verifyCampaign(copy);

    // #then the superseded write is a note, and the flip is still a mismatch
    expect([untouched.ok, untouched.notes.length, flipped.ok]).toEqual([true, 1, false]);
  });

  it("keeps the fixture's run directory intact for the other tests", async () => {
    expect(readFileSync(resolve(run, "manifest.json"), "utf8")).toContain("p2-control");
  });
});

describe("summaryDiff", () => {
  it("names the path that differs", async () => {
    expect(summaryDiff({ a: { b: 1, c: 2 } }, { a: { b: 1, c: 3 } })).toEqual([
      "summary.a.c: stored 2, rebuilt 3",
    ]);
    expect(summaryDiff({ a: [1] }, { a: [1] })).toEqual([]);
  });
});
