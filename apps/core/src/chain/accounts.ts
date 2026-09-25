import { PDA_SEEDS, TOKEN_PROGRAM_ID } from "@paycheck-router/shared";
import {
  type Address,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
} from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import type { Env } from "../env.ts";
import type { ChainClient } from "./client.ts";

const utf8 = getUtf8Encoder();
const addressBytes = getAddressEncoder();

export async function routerPdaFor(programId: Address, owner: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [utf8.encode(PDA_SEEDS.router), addressBytes.encode(owner)],
  });
  return pda;
}

export async function authorityPdaFor(programId: Address, router: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [utf8.encode(PDA_SEEDS.authority), addressBytes.encode(router)],
  });
  return pda;
}

export async function usdcAtaFor(env: Env, owner: Address): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({
    owner,
    mint: address(env.USDC_MINT),
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  return ata;
}

export type PayIn = {
  ata: Address;
  exists: boolean;
  balance: bigint;
  delegate: Address | null;
  delegatedAmount: bigint;
  routerPda: Address;
  routerExists: boolean;
};

/** The owner's USDC pay-in account and router PDA, read from the configured chain endpoint. */
export async function payInFor(env: Env, chain: ChainClient, owner: string): Promise<PayIn> {
  const ownerAddress = address(owner);
  const ata = await usdcAtaFor(env, ownerAddress);
  const routerPda = await routerPdaFor(address(env.PROGRAM_ID), ownerAddress);
  const { value } = await chain.rpc
    .getMultipleAccounts([ata, routerPda], { encoding: "jsonParsed", commitment: "confirmed" })
    .send();
  const [tokenAccount, router] = value;
  const parsed = tokenAccountInfo(tokenAccount);
  return {
    ata,
    exists: tokenAccount !== null && tokenAccount !== undefined,
    balance: parsed?.amount ?? 0n,
    delegate: parsed?.delegate ?? null,
    delegatedAmount: parsed?.delegatedAmount ?? 0n,
    routerPda,
    routerExists: router !== null && router !== undefined,
  };
}

type ParsedTokenInfo = {
  tokenAmount?: { amount?: string };
  delegate?: string;
  delegatedAmount?: { amount?: string };
};

function tokenAccountInfo(
  account: unknown,
): { amount: bigint; delegate: Address | null; delegatedAmount: bigint } | null {
  const data = (account as { data?: { parsed?: { info?: ParsedTokenInfo } } } | null)?.data;
  const info = data?.parsed?.info;
  if (!info?.tokenAmount?.amount) return null;
  return {
    amount: BigInt(info.tokenAmount.amount),
    delegate: info.delegate ? address(info.delegate) : null,
    delegatedAmount: BigInt(info.delegatedAmount?.amount ?? "0"),
  };
}
