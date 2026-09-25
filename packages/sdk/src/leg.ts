import { bpsOf } from "@paycheck-router/guard-math";
import {
  AssetKind,
  type RegistryAsset,
  USDC_FEED_ID,
  USDC_MINT,
  WaitReason,
} from "@paycheck-router/shared";
import {
  AccountRole,
  type Address,
  type AddressesByLookupTableAddress,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token-2022";
import {
  attestMark,
  decideMark,
  ed25519VerifyInstruction,
  fetchPreStocks,
  type MarkObservation,
  type PreStocksRead,
  type SignedAttestation,
} from "./attester.ts";
import { bigintReplacer, classifyFailure, type FailureClassification } from "./errors.ts";
import { fetchLatestUpdate, type HermesOptions, type HermesUpdate } from "./hermes.ts";
import { legAttemptKey } from "./idempotency.ts";
import { jsonRpc } from "./json-rpc.ts";
import {
  type ApiInstruction,
  buildJupiterSwap,
  type JupiterBuildResponse,
  type JupiterClientOptions,
  toKitInstruction,
  toLookupTables,
} from "./jupiter.ts";
import { type InstructionGroup, planPythPosts } from "./pyth-post.ts";
import type { SolanaRpc } from "./rpc.ts";
import {
  buildMessage,
  computeBudgetInstructions,
  computeUnitLimitFor,
  latestLifetime,
  MAX_TRANSACTION_BYTES,
  messageSize,
  packGroups,
  type SendOutcome,
  SIMULATION_COMPUTE_UNITS,
  signSendConfirm,
  simulate,
} from "./transaction.ts";

/** Highest priority fee per transaction: 0.0005 SOL. */
export const MAX_PRIORITY_FEE_LAMPORTS = 500_000n;
/** A shared price post is refreshed once it is this old, to stay inside the 30 s guard. */
export const PRICE_REFRESH_AGE_SECS = 15;
/** LANDING retries rebuild from the quote this many times before giving up the attempt. */
export const LANDING_RETRIES = 5;

export type PipelineConfig = {
  rpc: SolanaRpc;
  rpcUrl: string;
  /** Surfnet runs exclude proprietary AMMs and send only to `rpcUrl`. */
  surfnet: boolean;
  crank: KeyPairSigner;
  attester: KeyPairSigner | null;
  jupiter: JupiterClientOptions;
  hermes: HermesOptions;
  protocolLookupTable: AddressesByLookupTableAddress;
  feeBps: number;
  prestocks?: { url?: string };
  now?: () => number;
};

export type PendingLeg = {
  router: Address;
  owner: Address;
  authority: Address;
  paycheck: Address;
  seq: bigint;
  legIndex: number;
  asset: RegistryAsset;
  amountIn: bigint;
  bandBps: number;
};

export type PricePosts = {
  hermes: HermesUpdate;
  accounts: Map<string, Address>;
  close: InstructionGroup[];
  signatures: Signature[];
  /** Wall-clock milliseconds when the Hermes update was fetched. */
  fetchedAtMs: number;
};

export type ExecuteAccounts = {
  leg: PendingLeg;
  destination: Address;
  /** Jupiter's swap instruction; its accounts become the remaining accounts, taker unsigned. */
  swap: Instruction;
  priceUpdate: Address | null;
  priceUpdate247: Address | null;
  usdcPriceUpdate: Address;
};

/** Builds `execute_leg` or `execute_prestock_leg` from the generated client. */
export type ExecuteInstructionBuilder = (accounts: ExecuteAccounts) => Promise<Instruction>;

export type LegExecutedDecoder<T> = (logs: readonly string[]) => Promise<T | null>;

export type LegAttempt<T> = {
  key: string;
  startedAt: string;
  jupiter: { raw: string; url: string; response: JupiterBuildResponse } | null;
  attestation: { signed: SignedAttestation; read: PreStocksRead } | null;
  simulation: { logs: readonly string[]; unitsConsumed: bigint | null; err: unknown } | null;
  transactionBytes: number | null;
  outcome: "executed" | "waiting" | "failed";
  waitReason: WaitReason | null;
  failure: FailureClassification | null;
  signature: Signature | null;
  slot: bigint | null;
  event: T | null;
  rawTransaction: string | null;
  error: string | null;
};

export type MarkState = {
  lastAccepted: Map<Address, MarkObservation>;
  pendingJump: Map<Address, MarkObservation>;
};

export function newMarkState(): MarkState {
  return { lastAccepted: new Map(), pendingJump: new Map() };
}

/** Feeds the listed legs need, plus USDC/USD, deduplicated. */
export function feedsFor(legs: readonly PendingLeg[]): string[] {
  const feeds = new Set<string>([USDC_FEED_ID]);
  for (const leg of legs) {
    if (leg.asset.feedId) feeds.add(leg.asset.feedId);
    if (leg.asset.feedId247) feeds.add(leg.asset.feedId247);
  }
  return [...feeds];
}

/** Fetches one Hermes update for every feed and posts it, fully verified, in order. */
export async function postPrices(
  config: PipelineConfig,
  feeds: readonly string[],
): Promise<PricePosts> {
  const fetchedAtMs = (config.now ?? Date.now)();
  const hermes = await fetchLatestUpdate(feeds, config.hermes);
  const plan = await planPythPosts({
    rpc: config.rpc,
    payer: config.crank,
    updates: hermes.response.binary.data,
  });
  const lifetime = await latestLifetime(config.rpc);
  const batches = packGroups(config.crank, lifetime, plan.post, config.protocolLookupTable, 0n);
  const signatures: Signature[] = [];
  for (const batch of batches) {
    const fresh = await latestLifetime(config.rpc);
    const outcome = await signSendConfirm(
      config.rpc,
      buildMessage(config.crank, fresh, batch, config.protocolLookupTable),
    );
    signatures.push(outcome.signature);
    if (outcome.status !== "confirmed") {
      throw new PricePostError(outcome, signatures);
    }
  }
  return {
    hermes,
    accounts: plan.priceUpdateAccounts,
    close: plan.close,
    signatures,
    fetchedAtMs,
  };
}

export class PricePostError extends Error {
  constructor(
    readonly outcome: SendOutcome,
    readonly signatures: Signature[],
  ) {
    super(
      `Pyth post ${outcome.signature} ${outcome.status}: ${JSON.stringify(outcome.err, bigintReplacer)}`,
    );
    this.name = "PricePostError";
  }
}

/** Closes the encoded VAA and every posted price account, returning rent to the crank. */
export async function closePricePosts(
  config: PipelineConfig,
  posts: PricePosts,
): Promise<Signature[]> {
  const lifetime = await latestLifetime(config.rpc);
  const batches = packGroups(config.crank, lifetime, posts.close, config.protocolLookupTable, 0n);
  const signatures: Signature[] = [];
  for (const batch of batches) {
    const fresh = await latestLifetime(config.rpc);
    const outcome = await signSendConfirm(
      config.rpc,
      buildMessage(config.crank, fresh, batch, config.protocolLookupTable),
    );
    signatures.push(outcome.signature);
  }
  return signatures;
}

/** Jupiter's percentile price, capped so the whole transaction pays at most 0.0005 SOL. */
export function priorityFeeMicroLamports(
  jupiter: JupiterBuildResponse,
  computeUnitLimit: number,
): bigint {
  let price = 0n;
  for (const ix of jupiter.computeBudgetInstructions) {
    const data = toKitInstruction(ix).data ?? new Uint8Array();
    if (data[0] === 3 && data.length >= 9) {
      price = new DataView(data.buffer, data.byteOffset).getBigUint64(1, true);
    }
  }
  const cap = (MAX_PRIORITY_FEE_LAMPORTS * 1_000_000n) / BigInt(Math.max(computeUnitLimit, 1));
  return price > cap ? cap : price;
}

/** The swap as the outer transaction must carry it: the Authority PDA is never a signer there. */
export function unsignedTaker(swap: ApiInstruction, authority: Address): Instruction {
  const ix = toKitInstruction(swap);
  return {
    ...ix,
    accounts: (ix.accounts ?? []).map((meta) => {
      if (meta.address !== authority) return meta;
      const writable =
        meta.role === AccountRole.WRITABLE || meta.role === AccountRole.WRITABLE_SIGNER;
      return {
        address: meta.address,
        role: writable ? AccountRole.WRITABLE : AccountRole.READONLY,
      };
    }),
  };
}

function requiresSigner(ix: ApiInstruction, signer: Address): boolean {
  return ix.accounts.some((a) => a.pubkey === signer && a.isSigner);
}

/**
 * One attempt at one leg, PRD 8.4 steps 1 to 7. Program errors end the attempt as a wait with
 * the simulation logs kept; nothing is sent unless the simulation succeeds.
 */
export async function attemptLeg<T>(
  config: PipelineConfig,
  leg: PendingLeg,
  attempt: number,
  prices: PricePosts,
  marks: MarkState,
  buildExecute: ExecuteInstructionBuilder,
  decodeExecuted: LegExecutedDecoder<T>,
): Promise<LegAttempt<T>> {
  const result: LegAttempt<T> = {
    key: legAttemptKey(leg.router, leg.seq, leg.legIndex, attempt),
    startedAt: new Date((config.now ?? Date.now)()).toISOString(),
    jupiter: null,
    attestation: null,
    simulation: null,
    transactionBytes: null,
    outcome: "failed",
    waitReason: null,
    failure: null,
    signature: null,
    slot: null,
    event: null,
    rawTransaction: null,
    error: null,
  };
  const { asset } = leg;
  const fee = bpsOf(leg.amountIn, config.feeBps);
  const [destination] = await findAssociatedTokenPda({
    owner: leg.owner,
    mint: asset.mint,
    tokenProgram: asset.tokenProgram,
  });

  const build = await buildJupiterSwap(
    {
      inputMint: USDC_MINT,
      outputMint: asset.mint,
      amount: leg.amountIn - fee,
      taker: leg.authority,
      payer: config.crank.address,
      destinationTokenAccount: destination,
      slippageBps: leg.bandBps,
      surfnet: config.surfnet,
    },
    config.jupiter,
  );
  result.jupiter = build;
  const jupiter = build.response;
  const outsideSwap = [
    ...jupiter.setupInstructions,
    ...(jupiter.cleanupInstruction ? [jupiter.cleanupInstruction] : []),
  ];
  if (outsideSwap.some((ix) => requiresSigner(ix, leg.authority))) {
    result.error = "Jupiter returned a setup or cleanup instruction the Authority PDA must sign";
    return result;
  }

  const prefix: Instruction[] = [];
  if (asset.kind === AssetKind.preIpo) {
    if (!config.attester) {
      result.error = "pre-IPO leg without an attester key";
      return result;
    }
    const read = await fetchPreStocks({
      ...(config.prestocks?.url ? { url: config.prestocks.url } : {}),
      ...(config.now ? { now: config.now } : {}),
    });
    const { signed } = await attestMark(read, asset.mint, config.attester);
    const decision = decideMark(
      { markPriceE9: signed.attestation.markPriceE9, observedAt: read.observedAt },
      marks.lastAccepted.get(asset.mint) ?? null,
      marks.pendingJump.get(asset.mint) ?? null,
    );
    result.attestation = { signed, read };
    if (!decision.accept) {
      marks.pendingJump.set(asset.mint, decision.pending);
      result.error = "PreStocks mark moved more than 20% and awaits a confirming read";
      return result;
    }
    marks.lastAccepted.set(asset.mint, decision.mark);
    marks.pendingJump.delete(asset.mint);
    prefix.push(ed25519VerifyInstruction(signed));
  }

  const usdcPriceUpdate = prices.accounts.get(USDC_FEED_ID);
  if (!usdcPriceUpdate) throw new Error("USDC/USD was not posted");
  const execute = await buildExecute({
    leg,
    destination,
    swap: unsignedTaker(jupiter.swapInstruction, leg.authority),
    priceUpdate: asset.feedId ? (prices.accounts.get(asset.feedId) ?? null) : null,
    priceUpdate247: asset.feedId247 ? (prices.accounts.get(asset.feedId247) ?? null) : null,
    usdcPriceUpdate,
  });

  const body: Instruction[] = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: config.crank,
      ata: destination,
      owner: leg.owner,
      mint: asset.mint,
      tokenProgram: asset.tokenProgram,
    }),
    ...jupiter.setupInstructions.map(toKitInstruction),
    ...prefix,
    execute,
    ...(jupiter.cleanupInstruction ? [toKitInstruction(jupiter.cleanupInstruction)] : []),
  ];
  const lookupTables = {
    ...toLookupTables(jupiter.addressesByLookupTableAddress),
    ...config.protocolLookupTable,
  };

  const lifetime = await latestLifetime(config.rpc);
  const simulationMessage = buildMessage(
    config.crank,
    lifetime,
    [...computeBudgetInstructions(SIMULATION_COMPUTE_UNITS, 0n), ...body],
    lookupTables,
  );
  result.transactionBytes = messageSize(simulationMessage);
  if (result.transactionBytes > MAX_TRANSACTION_BYTES) {
    result.error = `execute transaction is ${result.transactionBytes} bytes, over ${MAX_TRANSACTION_BYTES}`;
    return result;
  }
  const simulation = await simulate(config.rpc, simulationMessage);
  result.simulation = simulation;
  if (simulation.err) {
    return settleFailure(result, classifyFailure(simulation.err, simulation.logs));
  }

  const units = computeUnitLimitFor(simulation.unitsConsumed ?? BigInt(SIMULATION_COMPUTE_UNITS));
  const sendLifetime = await latestLifetime(config.rpc);
  const message = buildMessage(
    config.crank,
    sendLifetime,
    [...computeBudgetInstructions(units, priorityFeeMicroLamports(jupiter, units)), ...body],
    lookupTables,
  );
  const sent = await signSendConfirm(config.rpc, message);
  result.signature = sent.signature;
  result.slot = sent.slot;
  if (sent.status === "expired") {
    result.outcome = "waiting";
    result.waitReason = WaitReason.LANDING;
    result.failure = { kind: "landing", detail: "blockhash expired before confirmation" };
    return result;
  }
  const { result: tx, raw } = await jsonRpc<{ meta: { logMessages: string[] | null } } | null>(
    config.rpcUrl,
    "getTransaction",
    [
      sent.signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
    ],
  );
  result.rawTransaction = raw;
  const logs = tx?.meta?.logMessages ?? [];
  if (sent.status === "failed") {
    return settleFailure(result, classifyFailure(sent.err, logs));
  }
  result.event = await decodeExecuted(logs);
  if (!result.event) {
    result.error = "confirmed without a LegExecuted event";
    return result;
  }
  result.outcome = "executed";
  return result;
}

function settleFailure<T>(result: LegAttempt<T>, failure: FailureClassification): LegAttempt<T> {
  result.failure = failure;
  if (failure.kind === "program" && failure.reason && failure.error.action === "wait") {
    result.outcome = "waiting";
    result.waitReason = failure.reason;
  } else if (failure.kind === "landing") {
    result.outcome = "waiting";
    result.waitReason = WaitReason.LANDING;
  } else {
    result.outcome = "failed";
    result.error =
      failure.kind === "program"
        ? `${failure.error.name} (${failure.error.code}): ${failure.error.action}`
        : `${failure.kind}: ${failure.kind === "external" ? failure.detail : ""}`;
  }
  return result;
}

export type LegRun<T> = { leg: PendingLeg; attempts: LegAttempt<T>[]; posts: PricePosts[] };

export type PaycheckRun<T> = {
  legs: LegRun<T>[];
  posts: PricePosts[];
  closeSignatures: Signature[];
};

/**
 * Runs every pending leg of one paycheck, largest first. Legs share one posted Hermes update,
 * refreshed when it is older than 15 s; a LANDING result retries with a fresh quote up to five
 * times and a stale or missing attestation is re-signed once. Posted accounts close at the end.
 */
export async function executePaycheckLegs<T>(
  config: PipelineConfig,
  legs: readonly PendingLeg[],
  buildExecute: ExecuteInstructionBuilder,
  decodeExecuted: LegExecutedDecoder<T>,
  marks: MarkState = newMarkState(),
): Promise<PaycheckRun<T>> {
  const now = config.now ?? Date.now;
  const ordered = [...legs].sort((a, b) =>
    a.amountIn === b.amountIn ? a.legIndex - b.legIndex : a.amountIn > b.amountIn ? -1 : 1,
  );
  const feeds = feedsFor(ordered);
  const posts: PricePosts[] = [await postPrices(config, feeds)];
  const runs: LegRun<T>[] = [];
  for (const leg of ordered) {
    const run: LegRun<T> = { leg, attempts: [], posts: [] };
    runs.push(run);
    let landing = 0;
    let resigned = 0;
    for (let attempt = 0; ; attempt++) {
      let result: LegAttempt<T>;
      try {
        let current = posts.at(-1) as PricePosts;
        if (now() - current.fetchedAtMs > PRICE_REFRESH_AGE_SECS * 1000) {
          current = await postPrices(config, feeds);
          posts.push(current);
        }
        if (!run.posts.includes(current)) run.posts.push(current);
        result = await attemptLeg(
          config,
          leg,
          attempt,
          current,
          marks,
          buildExecute,
          decodeExecuted,
        );
      } catch (error) {
        result = crashedAttempt<T>(leg, attempt, now(), error);
      }
      run.attempts.push(result);
      if (result.waitReason === WaitReason.LANDING && landing < LANDING_RETRIES) {
        landing++;
        continue;
      }
      if (
        result.failure?.kind === "program" &&
        result.failure.error.action === "resign" &&
        resigned < 1
      ) {
        resigned++;
        continue;
      }
      break;
    }
  }
  const closeSignatures: Signature[] = [];
  for (const post of posts) closeSignatures.push(...(await closePricePosts(config, post)));
  return { legs: runs, posts, closeSignatures };
}

function crashedAttempt<T>(leg: PendingLeg, attempt: number, nowMs: number, error: unknown) {
  const attemptResult: LegAttempt<T> = {
    key: legAttemptKey(leg.router, leg.seq, leg.legIndex, attempt),
    startedAt: new Date(nowMs).toISOString(),
    jupiter: null,
    attestation: null,
    simulation: null,
    transactionBytes: null,
    outcome: "failed",
    waitReason: null,
    failure: null,
    signature: null,
    slot: null,
    event: null,
    rawTransaction: null,
    error: error instanceof Error ? error.message : String(error),
  };
  return attemptResult;
}
