/**
 * The record-execute-verify path every fork run shares (`pnpm demo:fork`, the campaign cases and
 * the fork suites), turning SDK results into evidence-bundle records.
 */
import {
  decodeRouterSnapshot,
  fetchRouter,
  fetchUpdateAt,
  getPaycheckDecoder,
  type HermesOptions,
  type HermesUpdateResponse,
  type InflowCandidate,
  jsonRpc,
  type LegAttempt,
  type LegExecutedEvent,
  legCosts,
  legExecutedView,
  type ParsedTransactionView,
  type Paycheck,
  type PaycheckRun,
  type PendingLeg,
  type PricePosts,
  reconcileSweep,
  verifyLeg,
} from "@paycheck-router/sdk";
import {
  type ArtifactRef,
  AssetKind,
  assetByMint,
  type LegAttempt as LegAttemptRecord,
  type LegRecord,
  type PythPriceRecord,
  type TransactionRecord,
  USDC_FEED_ID,
  USDC_MINT,
} from "@paycheck-router/shared";
import { type Address, getBase64Encoder } from "@solana/kit";
import { type EvidenceBundle, toJson } from "./bundle.ts";
import type { Surfnet } from "./fork.ts";

const LEG_PENDING = 0;
const LEG_EXECUTED = 1;

/** Every transaction a run sends, with the node's raw getTransaction response kept as evidence. */
export class TransactionLog {
  readonly records: TransactionRecord[] = [];

  constructor(
    private readonly surfnet: Surfnet,
    private readonly bundle: EvidenceBundle,
  ) {}

  async add(label: string, signature: string): Promise<{ raw: string; ref: ArtifactRef | null }> {
    const { result, raw } = await jsonRpc<{ slot: number; meta: { err: unknown } } | null>(
      this.surfnet.rpcUrl,
      "getTransaction",
      [
        signature,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
      ],
    );
    const ref = result ? this.bundle.write(`raw/tx/${signature}.json`, raw) : null;
    this.records.push({
      label,
      signature,
      slot: result?.slot ?? null,
      err: result?.meta.err ?? null,
      raw: ref,
    });
    return { raw, ref };
  }
}

/** Runs the reconcile sweep every `intervalMs` until the router's pay-in shows new USDC. */
export async function detectPaycheck(
  surfnet: Surfnet,
  target: { router: Address; payIn: Address },
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<InflowCandidate> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const [candidate] = await reconcileSweep(surfnet.rpc, [target], decodeRouterSnapshot);
    if (candidate) return candidate;
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 2_000));
  }
  throw new Error(`reconcile sweep saw no inflow within ${timeoutMs / 1000} s`);
}

/** The recorded paycheck's pending legs with the bands the router holds for them. */
export async function pendingLegs(
  surfnet: Surfnet,
  input: {
    router: Address;
    owner: Address;
    authority: Address;
    paycheck: Address;
    account: Paycheck;
  },
): Promise<PendingLeg[]> {
  const router = await fetchRouter(surfnet.rpc, input.router, { commitment: "confirmed" });
  return input.account.legs.flatMap((state, legIndex) => {
    const asset = assetByMint(state.mint);
    const band = router.data.legs.find((leg) => leg.mint === state.mint)?.bandBps;
    if (!asset || band === undefined || state.status !== LEG_PENDING || state.amountIn === 0n) {
      return [];
    }
    return [
      {
        router: input.router,
        owner: input.owner,
        authority: input.authority,
        paycheck: input.paycheck,
        seq: input.account.seq,
        legIndex,
        asset,
        amountIn: state.amountIn,
        bandBps: band,
      },
    ];
  });
}

export function pricesFor(posts: PricePosts, feeds: readonly string[]): PythPriceRecord[] {
  return posts.hermes.response.parsed
    .filter((p) => feeds.includes(p.id))
    .map((p) => ({
      feedId: p.id,
      price: p.price.price,
      conf: p.price.conf,
      exponent: p.price.expo,
      publishTime: p.price.publish_time,
      postedAccount: posts.accounts.get(p.id) ?? null,
    }));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** One SDK leg attempt as a manifest record, its raw responses written to the bundle. */
export function attemptRecord(
  bundle: EvidenceBundle,
  attempt: LegAttempt<LegExecutedEvent>,
  hermesRef: ArtifactRef | null,
  prices: PythPriceRecord[],
): LegAttemptRecord {
  const key = attempt.key.replaceAll(":", "_");
  const { failure } = attempt;
  const signed = attempt.attestation?.signed;
  return {
    key: attempt.key,
    startedAt: attempt.startedAt,
    jupiterBuild: attempt.jupiter
      ? bundle.write(`raw/jupiter/${key}.json`, attempt.jupiter.raw)
      : null,
    hermesUpdate: hermesRef,
    prices,
    attestation:
      signed && attempt.attestation
        ? {
            mint: signed.attestation.mint,
            markPriceE9: signed.attestation.markPriceE9.toString(),
            observedAt: Number(signed.attestation.observedAt),
            source: signed.attestation.source,
            attester: signed.attester,
            message: hex(signed.message),
            signature: hex(signed.signature),
            apiResponse: bundle.write(`raw/prestocks/${key}.json`, attempt.attestation.read.raw),
          }
        : null,
    simulation: attempt.simulation
      ? {
          unitsConsumed:
            attempt.simulation.unitsConsumed === null
              ? null
              : Number(attempt.simulation.unitsConsumed),
          errorCode:
            failure?.kind === "program"
              ? failure.error.code
              : failure?.kind === "external"
                ? failure.code
                : null,
          errorName: failure?.kind === "program" ? failure.error.name : null,
          logs: bundle.write(
            `raw/simulation/${key}.json`,
            toJson({ err: attempt.simulation.err, logs: attempt.simulation.logs }),
          ),
        }
      : null,
    transactionBytes: attempt.transactionBytes,
    priceRejections: attempt.priceRejections,
    signatures: attempt.signature ? [attempt.signature] : [],
    outcome: attempt.outcome,
    waitReason: attempt.waitReason,
    error:
      attempt.error ??
      (failure?.kind === "external"
        ? `${failure.program}: ${failure.detail}`
        : failure?.kind === "landing"
          ? failure.detail
          : null),
  };
}

export function mergeHistory(...updates: HermesUpdateResponse[]): HermesUpdateResponse {
  return {
    binary: { encoding: "base64", data: updates.flatMap((u) => u.binary.data) },
    parsed: updates.flatMap((u) => u.parsed),
  };
}

/**
 * The fork verifier for one executed leg: the surfnet readback of its Paycheck, Hermes history
 * for the reference feed and USDC/USD at their publish times, and the SDK's re-derivation.
 */
export async function verifyExecuted(input: {
  surfnet: Surfnet;
  bundle: EvidenceBundle;
  transactions: TransactionLog;
  record: LegRecord;
  posts: PricePosts;
  attempt: LegAttempt<LegExecutedEvent>;
  owner: Address;
  hermes: HermesOptions;
}): Promise<void> {
  const { surfnet, bundle, record, posts, attempt } = input;
  if (!attempt.event || !attempt.signature || !attempt.rawTransaction) return;
  const event = legExecutedView(attempt.event);
  const asset = assetByMint(event.mint);
  if (!asset) throw new Error(`executed leg has unknown mint ${event.mint}`);
  const { ref: txRef } = await input.transactions.add(
    `execute ${record.symbol}`,
    attempt.signature,
  );
  const readback = await jsonRpc<{ value: { data: [string, string] } | null }>(
    surfnet.rpcUrl,
    "getAccountInfo",
    [event.paycheck, { encoding: "base64", commitment: "confirmed" }],
  );
  const readbackRef = bundle.write(
    `raw/readback/${event.paycheck}-${record.index}.json`,
    readback.raw,
  );
  const legState = readback.result.value
    ? getPaycheckDecoder().decode(
        Uint8Array.from(getBase64Encoder().encode(readback.result.value.data[0])),
      ).legs[record.index]
    : undefined;

  const feedId =
    event.priceSource === "PythRegular"
      ? asset.feedId
      : event.priceSource === "Pyth247"
        ? asset.feedId247
        : null;
  const postedUsdc = posts.hermes.response.parsed.find((p) => p.id === USDC_FEED_ID);
  const histories: HermesUpdateResponse[] = [];
  const historyRefs: ArtifactRef[] = [];
  if (feedId) {
    const history = await fetchUpdateAt(Number(event.pricePublishTime), [feedId], input.hermes);
    histories.push(history.response);
    historyRefs.push(bundle.write(`raw/hermes/history-${record.index}-asset.json`, history.raw));
  }
  if (postedUsdc) {
    const history = await fetchUpdateAt(
      postedUsdc.price.publish_time,
      [USDC_FEED_ID],
      input.hermes,
    );
    histories.push(history.response);
    historyRefs.push(bundle.write(`raw/hermes/history-${record.index}-usdc.json`, history.raw));
  }

  const verification = await verifyLeg({
    event,
    transaction: (JSON.parse(attempt.rawTransaction) as { result: ParsedTransactionView }).result,
    owner: input.owner,
    usdcMint: USDC_MINT,
    decimals: asset.decimals,
    postedUpdate: posts.hermes.response,
    history: mergeHistory(...histories),
    feedId,
    usdcFeedId: USDC_FEED_ID,
    readback: legState
      ? {
          executed: legState.status === LEG_EXECUTED,
          amountIn: legState.amountIn,
          outAmount: legState.outAmount,
          fee: legState.fee,
          issuerFee: legState.issuerFee,
          refPriceE9: legState.refPriceE9,
        }
      : null,
    attestation: attempt.attestation
      ? {
          attester: attempt.attestation.signed.attester,
          signature: attempt.attestation.signed.signature,
        }
      : null,
  });
  const costs = legCosts(event, asset.decimals);
  record.executed = {
    signature: attempt.signature,
    slot: Number(attempt.slot ?? 0n),
    amountIn: event.amountIn.toString(),
    fee: event.fee.toString(),
    swappedIn: event.swappedIn.toString(),
    outAmount: event.outAmount.toString(),
    issuerFee: event.issuerFee.toString(),
    minOut: event.minOut.toString(),
    refPriceE9: event.refPriceE9.toString(),
    usdcPriceE9: event.usdcPriceE9.toString(),
    multiplierE12: event.multiplierE12.toString(),
    priceSource: event.priceSource,
    pricePublishTime: Number(event.pricePublishTime),
    premiumBps: costs.premiumBps.toString(),
    allInCostBps: costs.allInCostBps.toString(),
    transaction: txRef ?? bundle.write(`raw/tx/${attempt.signature}.json`, attempt.rawTransaction),
    readback: readbackRef,
    history: historyRefs,
  };
  record.verification = verification;
  record.state = verification.state;
}

/**
 * Manifest records for a paycheck run: every attempt with its raw artifacts, the posted Hermes
 * updates and Pyth transactions, and the fork verifier's result for each executed leg.
 */
export async function recordPaycheckRun(input: {
  surfnet: Surfnet;
  bundle: EvidenceBundle;
  transactions: TransactionLog;
  run: PaycheckRun<LegExecutedEvent>;
  owner: Address;
  hermes: HermesOptions;
}): Promise<{ legs: LegRecord[]; feedIds: string[] }> {
  const { bundle, run, transactions } = input;
  const hermesRefs = new Map<PricePosts, ArtifactRef>();
  run.posts.forEach((post, i) => {
    hermesRefs.set(post, bundle.write(`raw/hermes/posted-${i}.json`, post.hermes.raw));
  });
  for (const post of run.posts) {
    for (const signature of post.signatures) await transactions.add("pyth post", signature);
  }
  for (const signature of run.closeSignatures) await transactions.add("pyth close", signature);

  const legs: LegRecord[] = [];
  for (const legRun of run.legs) {
    const { leg } = legRun;
    const feeds = [leg.asset.feedId, leg.asset.feedId247, USDC_FEED_ID].filter(
      (f): f is string => f !== null,
    );
    const attempts = legRun.attempts.map((attempt) => {
      const post = attempt.pricePosts;
      return attemptRecord(
        bundle,
        attempt,
        post ? (hermesRefs.get(post) ?? null) : null,
        post ? pricesFor(post, feeds) : [],
      );
    });
    const last = legRun.attempts.at(-1);
    const record: LegRecord = {
      index: leg.legIndex,
      mint: leg.asset.mint,
      symbol: leg.asset.symbol,
      kind: leg.asset.kind === AssetKind.preIpo ? "pre_ipo" : "listed_equity",
      amountIn: leg.amountIn.toString(),
      bandBps: leg.bandBps,
      state:
        last?.outcome === "waiting"
          ? "WAITING"
          : last?.outcome === "executed"
            ? "EXECUTED"
            : "PENDING",
      waitReason: last?.waitReason ?? null,
      attempts,
      executed: null,
      verification: null,
    };
    const posts = last?.pricePosts;
    if (last?.outcome === "executed" && posts) {
      await verifyExecuted({ ...input, record, posts, attempt: last });
    }
    legs.push(record);
  }
  const feedIds = [...new Set(run.posts.flatMap((p) => p.hermes.response.parsed.map((x) => x.id)))];
  return { legs, feedIds };
}
