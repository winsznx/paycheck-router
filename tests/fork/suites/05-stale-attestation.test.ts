import {
  decodeLegExecuted,
  executeInstructionBuilder,
  executePaycheckLegs,
  fetchConfig,
  newMarkState,
} from "@paycheck-router/sdk";
import { HARD_CAPS } from "@paycheck-router/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ForkPaycheck, forkWithPaycheck, legsOf, pipelineConfig } from "../helpers.ts";

describe("a PreStocks mark older than five minutes", () => {
  let fork: ForkPaycheck;

  beforeAll(async () => {
    fork = await forkWithPaycheck([{ symbol: "Anthropic", weightBps: 10_000, bandBps: 300 }]);
  });

  afterAll(async () => {
    await fork?.surfnet.stop();
  });

  it("is rejected as AttestationStale, then re-signed and executed", async () => {
    // The attester's clock runs 400 s behind until the program rejects its mark.
    let lagMs = (HARD_CAPS.maxAttestationAgeSecs + 100) * 1_000;
    const config = await pipelineConfig(fork, { now: () => Date.now() - lagMs });
    const onchain = await fetchConfig(fork.surfnet.rpc, fork.protocol.config);
    const run = await executePaycheckLegs(
      config,
      await legsOf(fork),
      executeInstructionBuilder({ treasury: onchain.data.treasury }),
      decodeLegExecuted,
      newMarkState(),
      {
        onAttempt: (_leg, attempt) => {
          if (
            attempt.failure?.kind === "program" &&
            attempt.failure.error.name === "AttestationStale"
          ) {
            lagMs = 0;
          }
        },
      },
    );
    const attempts = run.legs[0]?.attempts ?? [];
    const stale = attempts.find(
      (a) => a.failure?.kind === "program" && a.failure.error.name === "AttestationStale",
    );
    expect(stale?.failure?.kind === "program" && stale.failure.error.action).toBe("resign");
    expect(stale?.signature).toBeNull();
    const last = attempts.at(-1);
    expect(last?.outcome, last?.error ?? undefined).toBe("executed");
    expect(last?.attestation?.signed.attestation.observedAt).not.toBe(
      stale?.attestation?.signed.attestation.observedAt,
    );
  });
});
