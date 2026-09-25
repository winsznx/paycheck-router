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
import {
  type FeedRejection,
  fetchEntitledUpdate,
  type HermesOptions,
  type HermesUpdate,
} from "./hermes.ts";
import { legAttemptKey } from "./idempotency.ts";
import { jsonRpc } from "./json-rpc.ts";
import {
  type ApiInstruction,
  buildJupiterSwap,
  fetchProgramLabels,
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
/**
 * Floor on a price-post transaction's compute limit. The receiver's per-instruction hints left a
 * re-post on a fork failing with ProgramFailedToComplete; posts pay no priority fee, so headroom
 * costs nothing.
 */
export const POST_MIN_COMPUTE_UNITS = 400_000;
/** A shared price post is refreshed once it is this old, to stay inside the 30 s guard. */
export const PRICE_REFRESH_AGE_SECS = 15;
/** LANDING retries rebuild from the quote this many times before giving up the attempt. */
export const LANDING_RETRIES = 5;

export type PipelineConfig = {
  rpc: SolanaRpc;
  rpcUrl: string;
  /** Surfnet runs exclude proprietary AMMs and send only to `rpcUrl`. */
  surfnet: boolean;
  /**
   * Surfnet only: DEX labels excluded after their program failed inside a simulated route.
   * The pipeline adds to it; a fork's copy of such a pool stays broken for the whole run.
   */
  forkExcludedDexes?: Set<string>;
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
  /** Hermes refusals that kept this leg from being priced. */
  priceRejections: FeedRejection[];
  /** The posted prices the attempt simulated with. */
  pricePosts: PricePosts | null;
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

/**
 * Fetches one Hermes update for every feed, dropping any Hermes refuses, and posts it fully
 * verified, in order. `posts` is null when Hermes refused every feed.
 */
export async function postPrices(
  config: PipelineConfig,
  feeds: readonly string[],
): Promise<{ posts: PricePosts | null; rejected: FeedRejection[] }> {
  const fetchedAtMs = (config.now ?? Date.now)();
  const { update, rejected } = await fetchEntitledUpdate(feeds, config.hermes);
  if (!update) return { posts: null, rejected };
  return { posts: await postUpdate(config, update, fetchedAtMs), rejected };
}

async function postUpdate(
  config: PipelineConfig,
  hermes: HermesUpdate,
  fetchedAtMs: number,
): Promise<PricePosts> {
  const plan = await planPythPosts({
    rpc: config.rpc,
    payer: config.crank,
    updates: hermes.response.binary.data,
  });
  const lifetime = await latestLifetime(config.rpc);
  const batches = packGroups(
    config.crank,
    lifetime,
    plan.post,
    config.protocolLookupTable,
    0n,
    POST_MIN_COMPUTE_UNITS,
  );
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
  /** Returns posted prices fresh enough to simulate with, refreshing them if needed. */
  freshPrices: () => Promise<PricePosts>,
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
    priceRejections: [],
    pricePosts: null,
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
      ...(config.forkExcludedDexes ? { forkExcludedDexes: [...config.forkExcludedDexes] } : {}),
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

  const prices = await freshPrices();
  result.pricePosts = prices;
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

/** Callbacks so a caller can stream progress while a paycheck's legs run. */
export type PipelineHooks<T> = {
  onLegStart?: (leg: PendingLeg) => void | Promise<void>;
  onAttempt?: (leg: PendingLeg, attempt: LegAttempt<T>) => void | Promise<void>;
  onLegDone?: (run: LegRun<T>) => void | Promise<void>;
};

export type LegRun<T> = { leg: PendingLeg; attempts: LegAttempt<T>[]; posts: PricePosts[] };

export type PaycheckRun<T> = {
  legs: LegRun<T>[];
  posts: PricePosts[];
  closeSignatures: Signature[];
  /** Feeds Hermes refused during the run, with its status and body as evidence. */
  rejected: FeedRejection[];
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
  hooks: PipelineHooks<T> = {},
): Promise<PaycheckRun<T>> {
  const now = config.now ?? Date.now;
  const ordered = [...legs].sort((a, b) =>
    a.amountIn === b.amountIn ? a.legIndex - b.legIndex : a.amountIn > b.amountIn ? -1 : 1,
  );
  const rejected = new Map<string, FeedRejection>();
  const first = await postPrices(config, feedsFor(ordered));
  for (const rejection of first.rejected) rejected.set(rejection.feedId, rejection);
  let latest = first.posts;
  const posts: PricePosts[] = latest ? [latest] : [];
  const runs: LegRun<T>[] = [];
  for (const leg of ordered) {
    const run: LegRun<T> = { leg, attempts: [], posts: [] };
    runs.push(run);
    await hooks.onLegStart?.(leg);
    let landing = 0;
    let resigned = 0;
    let restaled = 0;
    let rerouted = 0;
    let forceRefresh = false;
    const refresh = async (force: boolean): Promise<PricePosts | null> => {
      if (latest && !force && now() - latest.fetchedAtMs <= PRICE_REFRESH_AGE_SECS * 1000) {
        return latest;
      }
      const feeds = feedsFor(ordered).filter((feed) => !rejected.has(feed));
      const refreshed = await postPrices(config, feeds);
      for (const rejection of refreshed.rejected) rejected.set(rejection.feedId, rejection);
      latest = refreshed.posts;
      if (latest) posts.push(latest);
      return latest;
    };
    for (let attempt = 0; ; attempt++) {
      let result: LegAttempt<T>;
      try {
        const current = await refresh(forceRefresh);
        forceRefresh = false;
        const refused = requiredFeeds(leg).flatMap((feed) => rejected.get(feed) ?? []);
        if (refused.length > 0 || !current) {
          result = unavailableAttempt<T>(leg, attempt, now(), refused);
        } else {
          result = await attemptLeg(
            config,
            leg,
            attempt,
            async () => {
              const fresh = await refresh(false);
              if (!fresh) throw new Error("Hermes stopped serving this paycheck's feeds");
              return fresh;
            },
            marks,
            buildExecute,
            decodeExecuted,
          );
          if (result.pricePosts && !run.posts.includes(result.pricePosts)) {
            run.posts.push(result.pricePosts);
          }
        }
      } catch (error) {
        result = crashedAttempt<T>(leg, attempt, now(), error);
      }
      run.attempts.push(result);
      await hooks.onAttempt?.(leg, result);
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
      const failedDex = config.surfnet ? await routeDexThatFailed(config, result) : null;
      if (failedDex && config.forkExcludedDexes && rerouted < 2) {
        config.forkExcludedDexes.add(failedDex);
        result.error = `${result.error ?? "route failed"}; excluding ${failedDex} on this fork and re-quoting`;
        rerouted++;
        continue;
      }
      // A fork fetches a route's pools from mainnet during the first simulation, which can age
      // the posted prices past the guard. One retry with a fresh post tells that apart from a
      // closed market, whose price stays stale however fresh the post.
      if (
        result.failure?.kind === "program" &&
        result.failure.error.name === "PriceStale" &&
        restaled < 1
      ) {
        restaled++;
        forceRefresh = true;
        continue;
      }
      break;
    }
    await hooks.onLegDone?.(run);
  }
  const closeSignatures: Signature[] = [];
  for (const post of posts) closeSignatures.push(...(await closePricePosts(config, post)));
  return { legs: runs, posts, closeSignatures, rejected: [...rejected.values()] };
}

let programLabels: Promise<Record<string, string>> | null = null;

/** The label of the routed DEX whose program failed the simulation, if the route used one. */
async function routeDexThatFailed<T>(
  config: PipelineConfig,
  result: LegAttempt<T>,
): Promise<string | null> {
  if (result.failure?.kind !== "external" || !result.jupiter) return null;
  programLabels ??= fetchProgramLabels(config.jupiter);
  const label = (await programLabels)[result.failure.program];
  if (!label) return null;
  const routed = result.jupiter.response.routePlan.some((hop) => hop.swapInfo.label === label);
  return routed ? label : null;
}

/**
 * Feeds a leg cannot execute without: USDC/USD always, and a listed equity's regular feed. The
 * program reads the regular feed account first and turns to the 24/7 feed only when that price
 * is stale, so a refused regular feed leaves the leg unpriceable even if its 24/7 feed is served.
 */
export function requiredFeeds(leg: PendingLeg): string[] {
  const feeds = [USDC_FEED_ID];
  if (leg.asset.kind === AssetKind.listedEquity && leg.asset.feedId) feeds.push(leg.asset.feedId);
  return feeds;
}

function unavailableAttempt<T>(
  leg: PendingLeg,
  attempt: number,
  nowMs: number,
  refused: FeedRejection[],
): LegAttempt<T> {
  return {
    ...crashedAttempt<T>(leg, attempt, nowMs, null),
    priceRejections: refused,
    outcome: "waiting",
    waitReason: WaitReason.PRICE_UNAVAILABLE,
    error:
      refused.length > 0
        ? refused.map((r) => `Hermes ${r.status} for ${r.feedId}: ${r.body}`).join("; ")
        : "Hermes refused every feed this paycheck needs",
  };
}

function crashedAttempt<T>(leg: PendingLeg, attempt: number, nowMs: number, error: unknown) {
  const attemptResult: LegAttempt<T> = {
    key: legAttemptKey(leg.router, leg.seq, leg.legIndex, attempt),
    startedAt: new Date(nowMs).toISOString(),
    jupiter: null,
    attestation: null,
    simulation: null,
    transactionBytes: null,
    priceRejections: [],
    pricePosts: null,
    outcome: "failed",
    waitReason: null,
    failure: null,
    signature: null,
    slot: null,
    event: null,
    rawTransaction: null,
    error: error === null ? null : error instanceof Error ? error.message : String(error),
  };
  return attemptResult;
}
