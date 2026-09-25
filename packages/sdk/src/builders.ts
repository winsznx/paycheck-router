import {
  AssetKind,
  assetByMint,
  TOKEN_PROGRAM_ID,
  USDC_DECIMALS,
  USDC_MINT,
} from "@paycheck-router/shared";
import {
  type Address,
  createNoopSigner,
  type Instruction,
  type KeyPairSigner,
  type TransactionSigner,
} from "@solana/kit";
import { getApproveCheckedInstruction } from "@solana-program/token";
import {
  findAssociatedTokenPda,
  getApproveCheckedInstruction as getApproveCheckedToken2022Instruction,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token-2022";
import {
  fetchPaycheck,
  fetchRouter,
  findAssetPda,
  findAuthorityPda,
  findConfigPda,
  findRouterPda,
  getCancelLegInstruction,
  getClosePaycheckInstruction,
  getCreateRouterInstructionAsync,
  getExecuteLegInstruction,
  getExecutePrestockLegInstruction,
  getExpireLegInstruction,
  getRecordPaycheckInstructionAsync,
  type LegExecutedEvent,
  type Paycheck,
  type RouterParamsArgs,
} from "./generated/index.ts";
import type { ExecuteInstructionBuilder } from "./leg.ts";
import { findConvertAuthorityPda, findPaycheckPda } from "./pda.ts";
import { legExecutedFromLogs } from "./program.ts";
import type { SolanaRpc } from "./rpc.ts";
import { buildMessage, latestLifetime, type SendOutcome, signSendConfirm } from "./transaction.ts";

const U64_MAX = (1n << 64n) - 1n;

async function ownerUsdcAccount(owner: Address): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({
    owner,
    mint: USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  return ata;
}

/**
 * The setup transaction's instructions: the owner's USDC account (idempotent), `create_router`,
 * an SPL approve of `allowance` USDC to the Authority PDA and, for every pre-IPO leg, the
 * owner's token account (idempotent) with an approve to that token's Convert authority. Pass the
 * owner as an address to build for a wallet that signs later (a no-op signer stands in).
 */
export async function buildSetupInstructions(input: {
  owner: Address | TransactionSigner;
  payer: TransactionSigner;
  params: RouterParamsArgs;
  allowance: bigint;
}): Promise<Instruction[]> {
  const owner = typeof input.owner === "string" ? createNoopSigner(input.owner) : input.owner;
  const payIn = await ownerUsdcAccount(owner.address);
  const create = await getCreateRouterInstructionAsync({
    owner,
    payer: input.payer,
    usdcMint: USDC_MINT,
    usdcTokenProgram: TOKEN_PROGRAM_ID,
    params: input.params,
  });
  const [router] = await findRouterPda({ owner: owner.address });
  const [authority] = await findAuthorityPda({ router });
  const instructions: Instruction[] = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: input.payer,
      ata: payIn,
      owner: owner.address,
      mint: USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    }),
    create,
    getApproveCheckedInstruction({
      source: payIn,
      mint: USDC_MINT,
      delegate: authority,
      owner,
      amount: input.allowance,
      decimals: USDC_DECIMALS,
    }),
  ];
  for (const leg of input.params.legs) {
    const asset = assetByMint(leg.mint);
    if (!asset || asset.kind !== AssetKind.preIpo) continue;
    const [holding] = await findAssociatedTokenPda({
      owner: owner.address,
      mint: asset.mint,
      tokenProgram: asset.tokenProgram,
    });
    instructions.push(
      getCreateAssociatedTokenIdempotentInstruction({
        payer: input.payer,
        ata: holding,
        owner: owner.address,
        mint: asset.mint,
        tokenProgram: asset.tokenProgram,
      }),
      getApproveCheckedToken2022Instruction(
        {
          source: holding,
          mint: asset.mint,
          delegate: await findConvertAuthorityPda(router, asset.mint),
          owner,
          amount: U64_MAX,
          decimals: asset.decimals,
        },
        { programAddress: asset.tokenProgram },
      ),
    );
  }
  return instructions;
}

/** Records the router's current inflow as its next paycheck and reads the Paycheck back. */
export async function recordPaycheck(
  rpc: SolanaRpc,
  input: {
    recorder: KeyPairSigner;
    payer: KeyPairSigner;
    router: Address;
    payIn: Address;
    detectedSlot: bigint;
  },
): Promise<{ outcome: SendOutcome; paycheck: Address; account: Paycheck | null }> {
  const router = await fetchRouter(rpc, input.router, { commitment: "confirmed" });
  const paycheck = await findPaycheckPda(input.router, router.data.paycheckSeq);
  const instruction = await getRecordPaycheckInstructionAsync({
    recorder: input.recorder,
    payer: input.payer,
    router: input.router,
    payIn: input.payIn,
    paycheck,
    detectedSlot: input.detectedSlot,
  });
  const outcome = await signSendConfirm(
    rpc,
    buildMessage(input.payer, await latestLifetime(rpc), [instruction]),
  );
  const account =
    outcome.status === "confirmed"
      ? (await fetchPaycheck(rpc, paycheck, { commitment: "confirmed" })).data
      : null;
  return { outcome, paycheck, account };
}

/**
 * Builds `execute_leg` or `execute_prestock_leg` for the pipeline. Jupiter's swap accounts follow
 * as remaining accounts, with the Authority PDA already unsigned.
 */
export function executeInstructionBuilder(config: {
  treasury: Address;
}): ExecuteInstructionBuilder {
  return async ({ leg, destination, swap, priceUpdate, priceUpdate247, usdcPriceUpdate }) => {
    const [configPda] = await findConfigPda();
    const [asset] = await findAssetPda({ mint: leg.asset.mint });
    const payIn = await ownerUsdcAccount(leg.owner);
    const [authorityUsdc] = await findAssociatedTokenPda({
      owner: leg.authority,
      mint: USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    const common = {
      config: configPda,
      router: leg.router,
      paycheck: leg.paycheck,
      asset,
      authority: leg.authority,
      payIn,
      authorityUsdc,
      treasury: config.treasury,
      usdcMint: USDC_MINT,
      destination,
      assetMint: leg.asset.mint,
      usdcPriceUpdate,
      jupiterProgram: swap.programAddress,
      usdcTokenProgram: TOKEN_PROGRAM_ID,
      assetTokenProgram: leg.asset.tokenProgram,
      legIndex: leg.legIndex,
      swapData: swap.data ?? new Uint8Array(),
    };
    let instruction: Instruction;
    if (leg.asset.kind === AssetKind.preIpo) {
      instruction = getExecutePrestockLegInstruction(common);
    } else {
      if (!priceUpdate) throw new Error(`no posted price for ${leg.asset.symbol}`);
      instruction = getExecuteLegInstruction({
        ...common,
        priceUpdate,
        ...(priceUpdate247 ? { priceUpdate247 } : {}),
      });
    }
    return {
      ...instruction,
      accounts: [...(instruction.accounts ?? []), ...(swap.accounts ?? [])],
    };
  };
}

/** The first `LegExecuted` in a confirmed transaction's logs, if any. */
export async function decodeLegExecuted(logs: readonly string[]): Promise<LegExecutedEvent | null> {
  return legExecutedFromLogs(logs)[0] ?? null;
}

export function buildExpireLegInstruction(input: {
  router: Address;
  paycheck: Address;
  legIndex: number;
}): Instruction {
  return getExpireLegInstruction(input);
}

export function buildCancelLegInstruction(input: {
  owner: TransactionSigner;
  router: Address;
  paycheck: Address;
  legIndex: number;
}): Instruction {
  return getCancelLegInstruction(input);
}

export function buildClosePaycheckInstruction(input: {
  paycheck: Address;
  rentPayer: Address;
}): Instruction {
  return getClosePaycheckInstruction(input);
}
