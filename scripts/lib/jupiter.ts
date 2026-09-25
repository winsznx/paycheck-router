import { FORK_EXCLUDED_DEXES, JUPITER_BUILD_URL } from "@paycheck-router/shared";
import {
  AccountRole,
  type Address,
  type AddressesByLookupTableAddress,
  address,
  getBase64Codec,
  type Instruction,
} from "@solana/kit";

export { FORK_EXCLUDED_DEXES, JUPITER_BUILD_URL };

type ApiAccount = { pubkey: string; isSigner: boolean; isWritable: boolean };
export type ApiInstruction = { programId: string; accounts: ApiAccount[]; data: string };

export type BuildResponse = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  routePlan: { percent: number; swapInfo: { ammKey: string; label: string } }[];
  computeBudgetInstructions: ApiInstruction[];
  setupInstructions: ApiInstruction[];
  swapInstruction: ApiInstruction;
  cleanupInstruction: ApiInstruction | null;
  otherInstructions: ApiInstruction[];
  addressesByLookupTableAddress: Record<string, string[]> | null;
};

export type BuildParams = {
  inputMint: Address;
  outputMint: Address;
  amount: bigint;
  taker: Address;
  payer?: Address;
  destinationTokenAccount?: Address;
  slippageBps: number;
  maxAccounts?: number;
  excludeDexes?: readonly string[];
};

export async function buildSwap(params: BuildParams): Promise<BuildResponse> {
  const query = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount.toString(),
    taker: params.taker,
    slippageBps: String(params.slippageBps),
    maxAccounts: String(params.maxAccounts ?? 40),
  });
  if (params.payer) query.set("payer", params.payer);
  if (params.excludeDexes?.length) query.set("excludeDexes", params.excludeDexes.join(","));
  if (params.destinationTokenAccount) {
    query.set("destinationTokenAccount", params.destinationTokenAccount);
  }
  const headers: Record<string, string> = {};
  if (process.env.JUPITER_API_KEY) headers["x-api-key"] = process.env.JUPITER_API_KEY;
  const res = await fetch(`${JUPITER_BUILD_URL}?${query}`, { headers });
  if (!res.ok) {
    throw new Error(`Jupiter build ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as BuildResponse;
}

function roleOf(account: ApiAccount): AccountRole {
  if (account.isSigner && account.isWritable) return AccountRole.WRITABLE_SIGNER;
  if (account.isSigner) return AccountRole.READONLY_SIGNER;
  if (account.isWritable) return AccountRole.WRITABLE;
  return AccountRole.READONLY;
}

export function toInstruction(ix: ApiInstruction): Instruction {
  return {
    programAddress: address(ix.programId),
    accounts: ix.accounts.map((account) => ({
      address: address(account.pubkey),
      role: roleOf(account),
    })),
    data: Uint8Array.from(getBase64Codec().encode(ix.data)),
  };
}

export function toLookupTables(
  raw: Record<string, string[]> | null,
): AddressesByLookupTableAddress {
  if (!raw) return {};
  return Object.fromEntries(
    Object.entries(raw).map(([table, addresses]) => [address(table), addresses.map(address)]),
  );
}
