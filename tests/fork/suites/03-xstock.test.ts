import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fetchEntitledUpdate, type LegExecutedEvent, type PaycheckRun } from "@paycheck-router/sdk";
import { assetBySymbol, WaitReason } from "@paycheck-router/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EvidenceBundle } from "../../../scripts/lib/bundle.ts";
import { recordPaycheckRun, TransactionLog } from "../../../scripts/lib/run.ts";
import { type ForkPaycheck, forkWithPaycheck, hermesOptions, legsOf, runLegs } from "../helpers.ts";

const NVDA = assetBySymbol("NVDAx");

/**
 * Whether Hermes serves the NVDA regular feed to this key. Equity feeds need a Pyth grant the
 * key may not carry; without it the slice must wait on PRICE_UNAVAILABLE, never execute.
 */
async function equityEntitled(): Promise<boolean> {
  const { rejected } = await fetchEntitledUpdate([NVDA.feedId ?? ""], hermesOptions());
  return rejected.length === 0;
}

describe("an xStock slice", async () => {
  const entitled = await equityEntitled();
  let fork: ForkPaycheck;
  let run: PaycheckRun<LegExecutedEvent>;

  beforeAll(async () => {
    fork = await forkWithPaycheck([{ symbol: "NVDAx", weightBps: 10_000, bandBps: 50 }]);
    run = await runLegs(fork, await legsOf(fork));
  });

  afterAll(async () => {
    await fork?.surfnet.stop();
  });

  it.runIf(entitled)("executes through Jupiter under the Pyth guard and verifies", async () => {
    const legRun = run.legs[0];
    expect(legRun?.attempts.at(-1)?.outcome).toBe("executed");
    const bundle = new EvidenceBundle(resolve(mkdtempSync(resolve(tmpdir(), "fork-test-")), "run"));
    const recorded = await recordPaycheckRun({
      surfnet: fork.surfnet,
      bundle,
      transactions: new TransactionLog(fork.surfnet, bundle),
      run,
      owner: fork.signers["demo-worker"].address,
      hermes: hermesOptions(),
    });
    expect(recorded.legs[0]?.state).toBe("VERIFIED");
  });

  it.skipIf(entitled)("waits on PRICE_UNAVAILABLE with Hermes' refusal and sends nothing", () => {
    const last = run.legs[0]?.attempts.at(-1);
    expect(last?.waitReason).toBe(WaitReason.PRICE_UNAVAILABLE);
    expect(last?.signature).toBeNull();
    expect(last?.priceRejections.map((r) => [r.feedId, r.status])).toContainEqual([
      NVDA.feedId,
      403,
    ]);
  });
});
