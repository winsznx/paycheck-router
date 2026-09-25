import { buildMessage, latestLifetime, signSendConfirm } from "@paycheck-router/sdk";
import { WaitReason } from "@paycheck-router/shared";
import { getRevokeInstruction } from "@solana-program/token";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ForkPaycheck, forkWithPaycheck, legsOf, readPaycheck, runLegs } from "../helpers.ts";

describe("a worker who revokes the router's allowance", () => {
  let fork: ForkPaycheck;

  beforeAll(async () => {
    fork = await forkWithPaycheck([{ symbol: "Anthropic", weightBps: 10_000, bandBps: 300 }]);
  });

  afterAll(async () => {
    await fork?.surfnet.stop();
  });

  it("parks the slice on ALLOWANCE_REVOKED and leaves the USDC in the wallet", async () => {
    const worker = fork.signers["demo-worker"];
    const revoke = await signSendConfirm(
      fork.surfnet.rpc,
      buildMessage(worker, await latestLifetime(fork.surfnet.rpc), [
        getRevokeInstruction({ source: fork.demo.payIn, owner: worker }),
      ]),
    );
    expect(revoke.status).toBe("confirmed");
    const run = await runLegs(fork, await legsOf(fork));
    const last = run.legs[0]?.attempts.at(-1);
    expect(last?.waitReason, last?.error ?? undefined).toBe(WaitReason.ALLOWANCE_REVOKED);
    expect(last?.failure?.kind === "program" && last.failure.error.name).toBe("DelegateMismatch");
    expect(last?.signature).toBeNull();
    expect((await readPaycheck(fork)).legs[0]?.status).toBe(0);
  });
});
