import {
  assetBySymbol,
  PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@paycheck-router/shared";
import { AccountRole, address, generateKeyPairSigner, type Instruction } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { buildSetupInstructions, executeInstructionBuilder } from "../src/builders.ts";
import {
  EXECUTE_LEG_DISCRIMINATOR,
  EXECUTE_PRESTOCK_LEG_DISCRIMINATOR,
  findAuthorityPda,
  findRouterPda,
} from "../src/generated/index.ts";
import type { PendingLeg } from "../src/leg.ts";

const owner = address("hoyjKyffP55yKjj8aEGARUQi5xKC3bZTYv4j4ih3dBy");
const JUP = address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

const legs = (symbols: string[]) =>
  symbols.map((symbol) => ({
    mint: assetBySymbol(symbol).mint,
    weightBps: 10_000 / symbols.length,
    bandBps: 50,
    enabled: true,
  }));

const params = (symbols: string[]) => ({
  recorder: address("EGaHpAB9Svfv6zW8ZcNrSEayvMPNsg1gJqQUPDYfNKqL"),
  investBps: 2_000,
  minInflow: 1_000_000n,
  dailyCap: 0n,
  maxWaitSecs: 604_800,
  autoConvert: false,
  legs: legs(symbols),
});

const programs = (ixs: Instruction[]) => ixs.map((ix) => ix.programAddress);

describe("buildSetupInstructions", () => {
  it("creates the router and approves the Authority PDA for listed legs", async () => {
    const payer = await generateKeyPairSigner();
    const ixs = await buildSetupInstructions({
      owner,
      payer,
      params: params(["SPYx", "NVDAx"]),
      allowance: 500_000_000n,
    });
    expect(programs(ixs)).toEqual([
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      PROGRAM_ID,
      TOKEN_PROGRAM_ID,
    ]);
    const [router] = await findRouterPda({ owner });
    const [authority] = await findAuthorityPda({ router });
    const approve = ixs[2];
    expect(approve?.accounts?.[2]?.address).toBe(authority);
    const ownerMeta = approve?.accounts?.[3];
    expect(ownerMeta?.address).toBe(owner);
    expect(ownerMeta?.role).toBe(AccountRole.READONLY_SIGNER);
  });

  it("adds the holding account and a Convert-authority approve for each pre-IPO leg", async () => {
    const payer = await generateKeyPairSigner();
    const ixs = await buildSetupInstructions({
      owner,
      payer,
      params: params(["NVDAx", "Anthropic"]),
      allowance: 1n,
    });
    expect(programs(ixs).slice(3)).toEqual([
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      TOKEN_2022_PROGRAM_ID,
    ]);
  });
});

describe("executeInstructionBuilder", () => {
  const swap: Instruction = {
    programAddress: JUP,
    accounts: [
      { address: owner, role: AccountRole.WRITABLE },
      { address: JUP, role: AccountRole.READONLY },
    ],
    data: Uint8Array.of(9, 9, 9),
  };

  async function leg(symbol: string): Promise<PendingLeg> {
    const [router] = await findRouterPda({ owner });
    const [authority] = await findAuthorityPda({ router });
    return {
      router,
      owner,
      authority,
      paycheck: router,
      seq: 0n,
      legIndex: 1,
      asset: assetBySymbol(symbol),
      amountIn: 1n,
      bandBps: 50,
    };
  }

  const build = executeInstructionBuilder({ treasury: owner });
  const posted = address("CuZDTZrPcGrRcjjFEF4UmcxgGq75Jm8eFFaxAWnSBBGA");

  it("builds execute_leg with Jupiter's accounts appended", async () => {
    const ix = await build({
      leg: await leg("NVDAx"),
      destination: owner,
      swap,
      priceUpdate: posted,
      priceUpdate247: null,
      usdcPriceUpdate: posted,
    });
    expect([...(ix.data ?? []).slice(0, 8)]).toEqual([...EXECUTE_LEG_DISCRIMINATOR]);
    expect(ix.accounts?.slice(-2)).toEqual(swap.accounts);
    expect(ix.accounts?.length).toBe(17 + 2);
  });

  it("builds execute_prestock_leg for pre-IPO assets", async () => {
    const ix = await build({
      leg: await leg("Anthropic"),
      destination: owner,
      swap,
      priceUpdate: null,
      priceUpdate247: null,
      usdcPriceUpdate: posted,
    });
    expect([...(ix.data ?? []).slice(0, 8)]).toEqual([...EXECUTE_PRESTOCK_LEG_DISCRIMINATOR]);
  });

  it("refuses a listed leg without a posted price", async () => {
    await expect(
      build({
        leg: await leg("NVDAx"),
        destination: owner,
        swap,
        priceUpdate: null,
        priceUpdate247: null,
        usdcPriceUpdate: posted,
      }),
    ).rejects.toThrow(/no posted price/);
  });
});
