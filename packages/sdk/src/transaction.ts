import {
  type AddressesByLookupTableAddress,
  appendTransactionMessageInstructions,
  type Blockhash,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getTransactionMessageSize,
  type Instruction,
  type KeyPairSigner,
  pipe,
  type Signature,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import type { SolanaRpc } from "./rpc.ts";

export const MAX_TRANSACTION_BYTES = 1232;
export const SIMULATION_COMPUTE_UNITS = 1_400_000;
export const COMPUTE_UNIT_MARGIN_PERCENT = 120n;

export type Lifetime = { blockhash: Blockhash; lastValidBlockHeight: bigint };

export function buildMessage(
  feePayer: KeyPairSigner,
  lifetime: Lifetime,
  instructions: readonly Instruction[],
  lookupTables: AddressesByLookupTableAddress = {},
) {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) => compressTransactionMessageUsingAddressLookupTables(m, lookupTables),
  );
}

export type Message = ReturnType<typeof buildMessage>;

export function messageSize(message: Message): number {
  return getTransactionMessageSize(message);
}

export function computeBudgetInstructions(units: number, microLamports: bigint): Instruction[] {
  const instructions: Instruction[] = [getSetComputeUnitLimitInstruction({ units })];
  if (microLamports > 0n) instructions.push(getSetComputeUnitPriceInstruction({ microLamports }));
  return instructions;
}

/** 1.2 × the units a simulation consumed, capped at the transaction maximum. */
export function computeUnitLimitFor(unitsConsumed: bigint): number {
  const limit = (unitsConsumed * COMPUTE_UNIT_MARGIN_PERCENT + 99n) / 100n;
  return Number(
    limit > BigInt(SIMULATION_COMPUTE_UNITS) ? BigInt(SIMULATION_COMPUTE_UNITS) : limit,
  );
}

export type SimulationResult = {
  err: unknown;
  logs: readonly string[];
  unitsConsumed: bigint | null;
};

export async function simulate(rpc: SolanaRpc, message: Message): Promise<SimulationResult> {
  const signed = await signTransactionMessageWithSigners(message);
  const { value } = await rpc
    .simulateTransaction(getBase64EncodedWireTransaction(signed), {
      encoding: "base64",
      replaceRecentBlockhash: true,
      sigVerify: false,
      commitment: "confirmed",
    })
    .send();
  return {
    err: value.err ?? null,
    logs: value.logs ?? [],
    unitsConsumed: value.unitsConsumed ?? null,
  };
}

export type SendOutcome = {
  signature: Signature;
  slot: bigint | null;
  err: unknown;
  status: "confirmed" | "failed" | "expired";
};

/**
 * Signs and sends to exactly one RPC, then polls `getSignatureStatuses` every `pollMs` until the
 * transaction confirms, fails, or its blockhash can no longer land.
 */
export async function signSendConfirm(
  rpc: SolanaRpc,
  message: Message,
  options: { pollMs?: number; timeoutMs?: number; rebroadcastMs?: number } = {},
): Promise<SendOutcome> {
  const pollMs = options.pollMs ?? 1_000;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const rebroadcastMs = options.rebroadcastMs ?? 2_000;
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  const wire = getBase64EncodedWireTransaction(signed);
  const send = () =>
    rpc.sendTransaction(wire, { encoding: "base64", skipPreflight: true, maxRetries: 0n }).send();
  await send();
  const started = Date.now();
  let lastSent = started;
  const lastValid = message.lifetimeConstraint.lastValidBlockHeight;
  while (Date.now() - started < timeoutMs) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) return { signature, slot: status.slot, err: status.err, status: "failed" };
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return { signature, slot: status.slot, err: null, status: "confirmed" };
    }
    const height = await rpc.getBlockHeight({ commitment: "confirmed" }).send();
    if (height > lastValid) return { signature, slot: null, err: null, status: "expired" };
    if (Date.now() - lastSent >= rebroadcastMs) {
      await send();
      lastSent = Date.now();
    }
    await sleep(pollMs);
  }
  return { signature, slot: null, err: null, status: "expired" };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function latestLifetime(rpc: SolanaRpc): Promise<Lifetime> {
  const { value } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  return value;
}

/**
 * Packs instruction groups, in order, into as few transactions as fit the size limit. A group
 * never splits across transactions. Each transaction gets a compute budget from the groups'
 * unit hints.
 */
export function packGroups(
  feePayer: KeyPairSigner,
  lifetime: Lifetime,
  groups: readonly { instructions: readonly Instruction[]; computeUnits: number }[],
  lookupTables: AddressesByLookupTableAddress,
  microLamports: bigint,
  minUnits = 0,
): Instruction[][] {
  const budget = (units: number) =>
    computeBudgetInstructions(
      Math.min(Math.max(units, minUnits), SIMULATION_COMPUTE_UNITS),
      microLamports,
    );
  const batches: Instruction[][] = [];
  let current: Instruction[] = [];
  let units = 0;
  const fits = (instructions: Instruction[], cu: number) =>
    messageSize(buildMessage(feePayer, lifetime, [...budget(cu), ...instructions], lookupTables)) <=
    MAX_TRANSACTION_BYTES;
  for (const group of groups) {
    const candidate = [...current, ...group.instructions];
    const candidateUnits = Math.min(units + group.computeUnits, SIMULATION_COMPUTE_UNITS);
    if (current.length === 0 || fits(candidate, candidateUnits)) {
      current = candidate;
      units = candidateUnits;
      continue;
    }
    batches.push([...budget(units), ...current]);
    current = [...group.instructions];
    units = group.computeUnits;
  }
  if (current.length > 0) {
    batches.push([...budget(units), ...current]);
  }
  for (const batch of batches) {
    const size = messageSize(buildMessage(feePayer, lifetime, batch, lookupTables));
    if (size > MAX_TRANSACTION_BYTES) {
      throw new Error(
        `instruction group needs ${size} bytes, over the ${MAX_TRANSACTION_BYTES} limit`,
      );
    }
  }
  return batches;
}
