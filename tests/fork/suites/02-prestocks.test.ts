import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { LegExecutedEvent, PaycheckRun } from "@paycheck-router/sdk";
import { HARD_CAPS, WaitReason } from "@paycheck-router/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EvidenceBundle } from "../../../scripts/lib/bundle.ts";
import { recordPaycheckRun, TransactionLog } from "../../../scripts/lib/run.ts";
import {
  type ForkPaycheck,
  forkWithPaycheck,
  hermesOptions,
  legsOf,
  readPaycheck,
  runLegs,
} from "../helpers.ts";

describe("PreStocks slices on live marks", () => {
  let fork: ForkPaycheck;
  let run: PaycheckRun<LegExecutedEvent>;

  beforeAll(async () => {
    fork = await forkWithPaycheck([
      { symbol: "Anthropic", weightBps: 5_000, bandBps: 300 },
      { symbol: "OpenAI", weightBps: 5_000, bandBps: 300 },
    ]);
    run = await runLegs(fork, await legsOf(fork));
  });

  afterAll(async () => {
    await fork?.surfnet.stop();
  });

  const legRun = (symbol: string) => run.legs.find((l) => l.leg.asset.symbol === symbol);

  it("executes the Anthropic slice with a fresh attestation and verifies it", async () => {
    const anthropic = legRun("Anthropic");
    const last = anthropic?.attempts.at(-1);
    expect(last?.outcome, last?.error ?? undefined).toBe("executed");
    const bundle = new EvidenceBundle(resolve(mkdtempSync(resolve(tmpdir(), "fork-test-")), "run"));
    const recorded = await recordPaycheckRun({
      surfnet: fork.surfnet,
      bundle,
      transactions: new TransactionLog(fork.surfnet, bundle),
      run: { ...run, legs: anthropic ? [anthropic] : [] },
      owner: fork.signers["demo-worker"].address,
      hermes: hermesOptions(),
    });
    const failed = recorded.legs[0]?.verification?.checks.filter((c) => !c.pass) ?? [];
    expect(failed).toEqual([]);
    expect(recorded.legs[0]?.state).toBe("VERIFIED");
    const legState = (await readPaycheck(fork)).legs[anthropic?.leg.legIndex ?? -1];
    const observedAt = Number(last?.attestation?.signed.attestation.observedAt ?? 0n);
    expect(Math.abs(Number(legState?.executedAt ?? 0n) - observedAt)).toBeLessThanOrEqual(
      HARD_CAPS.maxAttestationAgeSecs,
    );
  });

  it("parks the OpenAI slice on PREMIUM_TOO_HIGH while it trades far over its mark", () => {
    const last = legRun("OpenAI")?.attempts.at(-1);
    expect(last?.waitReason, last?.error ?? undefined).toBe(WaitReason.PREMIUM_TOO_HIGH);
    expect(last?.signature).toBeNull();
    expect(last?.failure?.kind === "program" && last.failure.error.name).toBe("OutputBelowMinimum");
  });

  it("drops a replayed execute of the executed slice with LegNotPending", async () => {
    const legs = await legsOf(fork);
    expect(legs.some((leg) => leg.asset.symbol === "Anthropic")).toBe(false);
    const before = await readPaycheck(fork);
    const anthropic = legRun("Anthropic")?.leg;
    if (!anthropic) throw new Error("no Anthropic leg");
    const replay = await runLegs(fork, [anthropic]);
    const last = replay.legs[0]?.attempts.at(-1);
    expect(last?.failure?.kind === "program" && last.failure.error.name).toBe("LegNotPending");
    expect(last?.signature).toBeNull();
    expect(await readPaycheck(fork)).toEqual(before);
  });
});
