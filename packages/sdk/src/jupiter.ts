import {
  FORK_EXCLUDED_DEXES,
  JUPITER_BUILD_URL,
  JUPITER_MAX_ACCOUNTS,
} from "@paycheck-router/shared";
import {
  AccountRole,
  type Address,
  type AddressesByLookupTableAddress,
  address,
  getBase64Codec,
  type Instruction,
} from "@solana/kit";
import { z } from "zod";
import type { FetchLike } from "./json-rpc.ts";

const ApiAccount = z.object({
  pubkey: z.string(),
  isSigner: z.boolean(),
  isWritable: z.boolean(),
});

const ApiInstruction = z.object({
  programId: z.string(),
  accounts: z.array(ApiAccount),
  data: z.string(),
});
export type ApiInstruction = z.infer<typeof ApiInstruction>;

export const JupiterBuildResponse = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: z.string(),
  otherAmountThreshold: z.string(),
  slippageBps: z.number(),
  routePlan: z.array(
    z.object({
      percent: z.number().nullish(),
      swapInfo: z.object({ ammKey: z.string(), label: z.string().nullish() }),
    }),
  ),
  computeBudgetInstructions: z.array(ApiInstruction),
  setupInstructions: z.array(ApiInstruction),
  swapInstruction: ApiInstruction,
  cleanupInstruction: ApiInstruction.nullish(),
  otherInstructions: z.array(ApiInstruction).nullish(),
  addressesByLookupTableAddress: z.record(z.string(), z.array(z.string())).nullish(),
});
export type JupiterBuildResponse = z.infer<typeof JupiterBuildResponse>;

export type JupiterBuildParams = {
  inputMint: Address;
  outputMint: Address;
  amount: bigint;
  /** Wallet whose tokens the swap spends: the router's Authority PDA. */
  taker: Address;
  /** Fee payer for the setup instructions: the crank. */
  payer: Address;
  destinationTokenAccount: Address;
  slippageBps: number;
  /** True on surfnets, where proprietary AMMs quote zero from stale state. */
  surfnet: boolean;
};

export type JupiterClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetch?: FetchLike;
};

export function jupiterBuildQuery(params: JupiterBuildParams): URLSearchParams {
  const query = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount.toString(),
    taker: params.taker,
    payer: params.payer,
    destinationTokenAccount: params.destinationTokenAccount,
    slippageBps: String(params.slippageBps),
    maxAccounts: String(JUPITER_MAX_ACCOUNTS),
    computeUnitPricePercentile: "high",
  });
  if (params.surfnet) query.set("excludeDexes", FORK_EXCLUDED_DEXES.join(","));
  return query;
}

/** Builds a swap with `/swap/v2/build` and returns the parsed response with its raw body. */
export async function buildJupiterSwap(
  params: JupiterBuildParams,
  options: JupiterClientOptions = {},
): Promise<{ response: JupiterBuildResponse; raw: string; url: string }> {
  const url = `${options.baseUrl ?? JUPITER_BUILD_URL}?${jupiterBuildQuery(params)}`;
  const headers: Record<string, string> = {};
  if (options.apiKey) headers["x-api-key"] = options.apiKey;
  const res = await (options.fetch ?? fetch)(url, { headers });
  const raw = await res.text();
  if (!res.ok) throw new JupiterBuildError(res.status, raw);
  return { response: JupiterBuildResponse.parse(JSON.parse(raw)), raw, url };
}

export class JupiterBuildError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Jupiter build ${status}: ${body.slice(0, 500)}`);
    this.name = "JupiterBuildError";
  }
}

function roleOf(account: z.infer<typeof ApiAccount>): AccountRole {
  if (account.isSigner && account.isWritable) return AccountRole.WRITABLE_SIGNER;
  if (account.isSigner) return AccountRole.READONLY_SIGNER;
  if (account.isWritable) return AccountRole.WRITABLE;
  return AccountRole.READONLY;
}

export function toKitInstruction(ix: ApiInstruction): Instruction {
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
  raw: Record<string, string[]> | null | undefined,
): AddressesByLookupTableAddress {
  if (!raw) return {};
  return Object.fromEntries(
    Object.entries(raw).map(([table, addresses]) => [address(table), addresses.map(address)]),
  );
}
