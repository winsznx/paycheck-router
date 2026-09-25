import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assetBySymbol, USDC_FEED_ID } from "@paycheck-router/shared";
import {
  AccountRole,
  address,
  type Blockhash,
  generateKeyPairSigner,
  type Instruction,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import { JupiterBuildResponse } from "../src/jupiter.ts";
import { feedsFor, type PendingLeg, priorityFeeMicroLamports, unsignedTaker } from "../src/leg.ts";
import {
  buildMessage,
  computeUnitLimitFor,
  MAX_TRANSACTION_BYTES,
  messageSize,
  packGroups,
} from "../src/transaction.ts";

const recorded = JupiterBuildResponse.parse(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures", "jupiter-build.json"), "utf8")),
);
const lifetime = {
  blockhash: "11111111111111111111111111111111" as Blockhash,
  lastValidBlockHeight: 100n,
};
const program = address("PayEFo1ZAPXKf5H4DoqrsEceYzdSvXJBAGBD7AMQY6H");

function blob(bytes: number): Instruction {
  return { programAddress: program, accounts: [], data: new Uint8Array(bytes) };
}

describe("compute budget", () => {
  it("sets the limit to 1.2 times the simulated units, rounded up and capped", () => {
    expect(computeUnitLimitFor(100_000n)).toBe(120_000);
    expect(computeUnitLimitFor(100_001n)).toBe(120_002);
    expect(computeUnitLimitFor(1_300_000n)).toBe(1_400_000);
  });

  it("caps the priority fee at 0.0005 SOL for the whole transaction", () => {
    expect(priorityFeeMicroLamports(recorded, 200_000)).toBe(1_408n);
    const expensive = {
      ...recorded,
      computeBudgetInstructions: [
        {
          programId: "ComputeBudget111111111111111111111111111111",
          accounts: [],
          data: "A/////////9/",
        },
      ],
    };
    expect(priorityFeeMicroLamports(expensive, 1_000_000)).toBe(500_000n);
  });
});

describe("packGroups", () => {
  it("keeps small groups together and splits when a transaction would overflow", async () => {
    const payer = await generateKeyPairSigner();
    const groups = [700, 700, 100].map((size) => ({
      instructions: [blob(size)],
      computeUnits: 50_000,
    }));
    const batches = packGroups(payer, lifetime, groups, {}, 0n);
    expect(batches).toHaveLength(2);
    for (const batch of batches) {
      expect(messageSize(buildMessage(payer, lifetime, batch))).toBeLessThanOrEqual(
        MAX_TRANSACTION_BYTES,
      );
    }
  });

  it("refuses a single group larger than one transaction", async () => {
    const payer = await generateKeyPairSigner();
    expect(() =>
      packGroups(payer, lifetime, [{ instructions: [blob(1_300)], computeUnits: 1 }], {}, 0n),
    ).toThrow(/limit/);
  });
});

describe("leg helpers", () => {
  const authority = address("5ZiE3vAkrdXBgyFL7KqG3RoEGBws4CjRcXVbABDLZTgx");

  it("passes the Authority PDA unsigned in the outer swap instruction", () => {
    const ix = unsignedTaker(recorded.swapInstruction, authority);
    const meta = ix.accounts?.find((a) => a.address === authority);
    expect(meta).toBeDefined();
    expect(meta?.role === AccountRole.READONLY || meta?.role === AccountRole.WRITABLE).toBe(true);
    const signers = ix.accounts?.filter(
      (a) => a.role === AccountRole.READONLY_SIGNER || a.role === AccountRole.WRITABLE_SIGNER,
    );
    expect(signers).toEqual([]);
  });

  it("asks Hermes for each listed feed, the 24/7 fallbacks and USDC once", () => {
    const leg = (symbol: string, index: number): PendingLeg => ({
      router: authority,
      owner: authority,
      authority,
      paycheck: authority,
      seq: 0n,
      legIndex: index,
      asset: assetBySymbol(symbol),
      amountIn: 1n,
      bandBps: 50,
    });
    const feeds = feedsFor([leg("SPYx", 0), leg("NVDAx", 1), leg("Anthropic", 2)]);
    expect(feeds).toEqual([
      USDC_FEED_ID,
      assetBySymbol("SPYx").feedId,
      assetBySymbol("NVDAx").feedId,
      assetBySymbol("NVDAx").feedId247,
    ]);
  });
});
