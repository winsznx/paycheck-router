import { HARD_CAPS, USDC_MINT } from "@paycheck-router/shared";
import { type Address, getBase64Encoder, type Signature } from "@solana/kit";
import { getTokenDecoder } from "@solana-program/token";
import type { SolanaRpc } from "./rpc.ts";

export const SWEEP_BATCH_SIZE = 100;

/** The Router fields the sweep needs, decoded from the account by the caller's client. */
export type RouterSnapshot = {
  owner: Address;
  payIn: Address;
  watermark: bigint;
  minInflow: bigint;
  paused: boolean;
};

export type SweepTarget = { router: Address; payIn: Address };

export type InflowCandidate = {
  router: Address;
  payIn: Address;
  owner: Address;
  balance: bigint;
  watermark: bigint;
  delta: bigint;
  slot: bigint;
};

function fromBase64(data: string): Uint8Array {
  return Uint8Array.from(getBase64Encoder().encode(data));
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The reconcile sweep: reads every pay-in account and router with `getMultipleAccounts` in
 * batches of 100 and returns each router whose balance sits above watermark + minimum and has no
 * record in flight.
 */
export async function reconcileSweep(
  rpc: SolanaRpc,
  targets: readonly SweepTarget[],
  decodeRouter: (data: Uint8Array) => RouterSnapshot,
  inFlight: ReadonlySet<string> = new Set(),
): Promise<InflowCandidate[]> {
  const pairs = targets.filter((t) => !inFlight.has(t.router));
  const candidates: InflowCandidate[] = [];
  for (const batch of chunk(pairs, SWEEP_BATCH_SIZE / 2)) {
    const addresses = batch.flatMap((t) => [t.router, t.payIn]);
    const { context, value } = await rpc
      .getMultipleAccounts(addresses, { encoding: "base64", commitment: "confirmed" })
      .send();
    batch.forEach((target, i) => {
      const routerAccount = value[2 * i];
      const payInAccount = value[2 * i + 1];
      if (!routerAccount || !payInAccount) return;
      const router = decodeRouter(fromBase64(routerAccount.data[0]));
      if (router.paused || router.payIn !== target.payIn) return;
      const token = getTokenDecoder().decode(fromBase64(payInAccount.data[0]));
      if (token.mint !== USDC_MINT) return;
      const minimum =
        router.minInflow > HARD_CAPS.minInflowFloor ? router.minInflow : HARD_CAPS.minInflowFloor;
      if (token.amount < router.watermark + minimum) return;
      candidates.push({
        router: target.router,
        payIn: target.payIn,
        owner: router.owner,
        balance: token.amount,
        watermark: router.watermark,
        delta: token.amount - router.watermark,
        slot: context.slot,
      });
    });
  }
  return candidates;
}

type ParsedTokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
};

type ParsedTransaction = {
  slot: number | bigint;
  meta: {
    err: unknown;
    preTokenBalances?: readonly ParsedTokenBalance[] | null;
    postTokenBalances?: readonly ParsedTokenBalance[] | null;
  } | null;
  transaction: { message: { accountKeys: readonly ({ pubkey: string } | string)[] } };
};

export type ResolvedInflow = {
  signature: Signature;
  slot: bigint;
  amount: bigint;
  /** Owner of the token account the USDC left: the payer. */
  sender: Address | null;
};

function balanceAt(balances: readonly ParsedTokenBalance[] | null | undefined, index: number) {
  const entry = balances?.find((b) => b.accountIndex === index);
  return entry ? BigInt(entry.uiTokenAmount.amount) : 0n;
}

/**
 * The USDC credited to `payIn` by one parsed transaction, and the owner of the USDC account that
 * lost the most in the same transaction.
 */
export function inflowFromTransaction(
  tx: ParsedTransaction,
  payIn: Address,
): { amount: bigint; sender: Address | null } {
  const keys = tx.transaction.message.accountKeys.map((k) =>
    typeof k === "string" ? k : k.pubkey,
  );
  const index = keys.indexOf(payIn);
  if (index < 0 || !tx.meta || tx.meta.err) return { amount: 0n, sender: null };
  const amount =
    balanceAt(tx.meta.postTokenBalances, index) - balanceAt(tx.meta.preTokenBalances, index);
  let sender: Address | null = null;
  let largestOutflow = 0n;
  for (const pre of tx.meta.preTokenBalances ?? []) {
    if (pre.mint !== USDC_MINT || pre.accountIndex === index) continue;
    const outflow =
      BigInt(pre.uiTokenAmount.amount) - balanceAt(tx.meta.postTokenBalances, pre.accountIndex);
    if (outflow > largestOutflow && pre.owner) {
      largestOutflow = outflow;
      sender = pre.owner as Address;
    }
  }
  return { amount, sender };
}

/**
 * Every USDC credit to `payIn` since `until` (exclusive), newest first, from
 * `getSignaturesForAddress` and `getTransaction` with `jsonParsed`.
 */
export async function resolveInflows(
  rpc: SolanaRpc,
  payIn: Address,
  until: Signature | null,
  limit = 20,
): Promise<ResolvedInflow[]> {
  const signatures = await rpc
    .getSignaturesForAddress(payIn, {
      commitment: "confirmed",
      limit,
      ...(until ? { until } : {}),
    })
    .send();
  const inflows: ResolvedInflow[] = [];
  for (const entry of signatures) {
    if (entry.err) continue;
    const tx = await rpc
      .getTransaction(entry.signature, {
        encoding: "jsonParsed",
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      })
      .send();
    if (!tx) continue;
    const { amount, sender } = inflowFromTransaction(tx, payIn);
    if (amount > 0n) {
      inflows.push({ signature: entry.signature, slot: BigInt(tx.slot), amount, sender });
    }
  }
  return inflows;
}
