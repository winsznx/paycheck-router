import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildExpireLegInstruction,
  buildMessage,
  classifyInflow,
  decodeLegExecuted,
  executeInstructionBuilder,
  executePaycheckLegs,
  type FeedRejection,
  fetchConfig,
  getSkipInflowInstruction,
  HermesError,
  type InflowRules,
  jsonRpc,
  type LegAttempt,
  type LegExecutedEvent,
  latestLifetime,
  legAttemptKey,
  type MarkState,
  newMarkState,
  nextAttempt,
  type Paycheck,
  type PaycheckRun,
  type PendingLeg,
  type PipelineConfig,
  type PricePosts,
  recordPaycheck,
  resolveInflows,
  signSendConfirm,
} from "@paycheck-router/sdk";
import {
  type ArtifactRef,
  assetBySymbol,
  FORK_KEYS,
  type LegRecord,
  PROGRAM_ID,
  RETRY_SCHEDULES,
  type RunManifest,
  TOKEN_PROGRAM_ID,
  USDC_MINT,
  WaitReason,
} from "@paycheck-router/shared";
import {
  type Address,
  address,
  generateKeyPairSigner,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token-2022";
import { EvidenceBundle, toJson } from "../../lib/bundle.ts";
import { createDemoRouter, sendPaycheck } from "../../lib/fork.ts";
import { detectPaycheck, pendingLegs, recordPaycheckRun, TransactionLog } from "../../lib/run.ts";
import { type CaseContext, type ForkState, requireFork } from "./case.ts";
import { requireHermes } from "./env.ts";
import type { PaycheckEntry } from "./manifest.ts";
import { INFRASTRUCTURE_FAILURE } from "./slices.ts";

const DETECT_TIMEOUT_MS = 60_000;
const _SWEEP_INTERVAL_MS = 2_000;
const EXPIRY_GRACE_MS = 5_000;
const INFRASTRUCTURE_RETRY_MS = 60_000;
/** The fork clock can trail wall time by a few seconds; expire_leg retries until it passes. */
const EXPIRE_ATTEMPTS = 6;
const EXPIRE_RETRY_MS = 20_000;

export type LegSpec = { symbol: string; weightBps: number; bandBps: number };

export type WorkerRouter = {
  name: string;
  owner: KeyPairSigner;
  router: Address;
  authority: Address;
  payIn: Address;
  investBps: number;
  legs: LegSpec[];
  minInflow: bigint;
};

/** A fresh fork-only worker, held in memory for this run and recorded by public key. */
export async function ephemeralWorker(ctx: CaseContext, name: string): Promise<KeyPairSigner> {
  const signer = await generateKeyPairSigner();
  ctx.extraKeys[name] = signer.address;
  return signer;
}

/** The setup transaction through `createDemoRouter`: create_router plus the approves. */
export async function setupRouter(
  ctx: CaseContext,
  opts: {
    name: string;
    owner?: KeyPairSigner;
    legs: LegSpec[];
    investBps: number;
    minInflow?: bigint;
    maxWaitSecs?: number;
    allowance?: bigint;
  },
): Promise<WorkerRouter> {
  const fork = requireFork(ctx);
  const owner = opts.owner ?? ctx.signers["demo-worker"];
  const minInflow = opts.minInflow ?? 1_000_000n;
  const created = await createDemoRouter(fork.surfnet, ctx.signers, {
    owner,
    legs: opts.legs,
    investBps: opts.investBps,
    allowance: opts.allowance ?? 20_000_000_000n,
    minInflow,
    ...(opts.maxWaitSecs ? { maxWaitSecs: opts.maxWaitSecs } : {}),
  });
  await fork.transactions.add(`setup ${opts.name}: create_router and approves`, created.signature);
  ctx.log(`router ${created.router} for ${opts.name}`);
  return {
    name: opts.name,
    owner,
    router: created.router,
    authority: created.authority,
    payIn: created.payIn,
    investBps: opts.investBps,
    legs: opts.legs,
    minInflow,
  };
}

export type PaycheckSpec = {
  label: string;
  employer: string;
  employerSigner: KeyPairSigner;
  amount: bigint;
  rules?: Partial<Pick<InflowRules, "appThreshold" | "taggedPayersOnly" | "taggedPayers">>;
  /** Wall-clock deadline for retrying waiting legs on the product's backoff. */
  retryUntilMs?: number;
  /** Runs after record_paycheck and before the pipeline (time travel, hostile probes). */
  beforeExecute?: (recorded: RecordedPaycheck) => Promise<void>;
  detectTimeoutMs?: number;
  /** Replaces the employer's transferChecked, e.g. for a self-transfer. */
  send?: () => Promise<{ signature: string }>;
};

export type RecordedPaycheck = {
  paycheck: Address;
  account: Paycheck;
  pending: PendingLeg[];
  pipeline: PipelineConfig;
  treasury: Address;
};

export type LegOutcome = {
  record: LegRecord;
  leg: PendingLeg;
  attempts: LegAttempt<LegExecutedEvent>[];
  posts: PricePosts[];
};

export type PaycheckResult = {
  entry: PaycheckEntry;
  bundle: EvidenceBundle;
  /** Case-relative directory of the paycheck bundle. */
  subdir: string;
  manifest: RunManifest;
  legs: LegOutcome[];
  paycheck: Address | null;
  account: Paycheck | null;
  pipeline: PipelineConfig | null;
  before: ArtifactRef | null;
  after: ArtifactRef | null;
  sendSignature: string | null;
};

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function destinationFor(owner: Address, symbol: string): Promise<Address> {
  const asset = assetBySymbol(symbol);
  const [ata] = await findAssociatedTokenPda({
    owner,
    mint: asset.mint,
    tokenProgram: asset.tokenProgram,
  });
  return ata;
}

/** The owner's USDC and share accounts, raw `getMultipleAccounts` (jsonParsed). */
export async function snapshotBalances(
  fork: ForkState,
  bundle: EvidenceBundle,
  router: WorkerRouter,
  name: string,
): Promise<ArtifactRef> {
  const accounts = [
    router.payIn,
    ...(await Promise.all(
      router.legs.map((leg) => destinationFor(router.owner.address, leg.symbol)),
    )),
  ];
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getMultipleAccounts",
    params: [accounts, { encoding: "jsonParsed", commitment: "confirmed" }],
  };
  const res = await fetch(fork.surfnet.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  return bundle.write(
    `raw/balances/${name}.json`,
    toJson({ request: body, response: JSON.parse(raw) }),
  );
}

/** Raw `getAccountInfo` (jsonParsed) for one account, stored in the bundle. */
export async function snapshotAccount(
  fork: ForkState,
  bundle: EvidenceBundle,
  account: Address,
  path: string,
): Promise<{ ref: ArtifactRef; value: unknown }> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getAccountInfo",
    params: [account, { encoding: "jsonParsed", commitment: "confirmed" }],
  };
  const res = await fetch(fork.surfnet.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = JSON.parse(await res.text()) as { result?: { value: unknown } };
  return {
    ref: bundle.write(path, toJson({ request: body, response })),
    value: response.result?.value ?? null,
  };
}

export async function pipelineFor(ctx: CaseContext, fork: ForkState): Promise<PipelineConfig> {
  const config = await fetchConfig(fork.surfnet.rpc, fork.protocol.config);
  return {
    rpc: fork.surfnet.rpc,
    rpcUrl: fork.surfnet.rpcUrl,
    surfnet: true,
    crank: ctx.signers.crank,
    attester: ctx.signers.attester,
    jupiter: ctx.env.jupiter,
    hermes: requireHermes(ctx.env),
    protocolLookupTable: {
      [fork.protocol.lookupTable.address]: fork.protocol.lookupTable.addresses,
    },
    feeBps: config.data.feeBps,
    forkExcludedDexes: new Set<string>(),
  };
}

function isRetryable(reason: WaitReason | null): reason is WaitReason {
  if (!reason || reason === WaitReason.LANDING) return false;
  return RETRY_SCHEDULES[reason].kind === "backoff";
}

/**
 * Accounts the previous route wrote that the surfnet copied from mainnet. Resetting them makes
 * the retry trade against current pool state instead of the copy taken at the first touch.
 */
async function refreshRoutes(
  fork: ForkState,
  bundle: EvidenceBundle,
  router: WorkerRouter,
  attempts: LegAttempt<LegExecutedEvent>[],
  round: number,
): Promise<void> {
  const ours = new Set<string>([
    router.owner.address,
    router.authority,
    router.payIn,
    fork.protocol.treasury,
    FORK_KEYS.crank,
  ]);
  for (const leg of router.legs) {
    ours.add(await destinationFor(router.owner.address, leg.symbol));
    ours.add(await destinationFor(router.authority, leg.symbol));
  }
  const [authorityUsdc] = await findAssociatedTokenPda({
    owner: router.authority,
    mint: USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  ours.add(authorityUsdc);
  const reset = new Set<string>();
  for (const attempt of attempts) {
    for (const meta of attempt.jupiter?.response.swapInstruction.accounts ?? []) {
      if (meta.isWritable && !meta.isSigner && !ours.has(meta.pubkey)) reset.add(meta.pubkey);
    }
  }
  for (const key of reset) await fork.surfnet.cheat.resetAccount(address(key));
  bundle.write(`raw/refresh/round-${round}.json`, toJson({ resetAccounts: [...reset] }));
}

async function expireLegs(
  ctx: CaseContext,
  fork: ForkState,
  transactions: TransactionLog,
  router: WorkerRouter,
  paycheck: Address,
  legs: PendingLeg[],
): Promise<Signature[]> {
  const signatures: Signature[] = [];
  for (const leg of legs) {
    for (let attempt = 1; attempt <= EXPIRE_ATTEMPTS; attempt++) {
      const outcome = await signSendConfirm(
        fork.surfnet.rpc,
        buildMessage(ctx.signers.crank, await latestLifetime(fork.surfnet.rpc), [
          buildExpireLegInstruction({ router: router.router, paycheck, legIndex: leg.legIndex }),
        ]),
      );
      const label = `expire_leg ${leg.asset.symbol}`;
      await transactions.add(
        outcome.status === "confirmed" ? label : `${label} (attempt ${attempt})`,
        outcome.signature,
      );
      ctx.log(`${label}: ${outcome.status}`);
      signatures.push(outcome.signature);
      if (outcome.status === "confirmed") break;
      await new Promise((r) => setTimeout(r, EXPIRE_RETRY_MS));
    }
  }
  return signatures;
}

/**
 * One paycheck end to end through the product's code: the employer's transfer, the reconcile
 * sweep, classification, `record_paycheck` (or `skip_inflow`), the SDK leg pipeline with the
 * product's backoff for waiting legs, `expire_leg` at expiry, and the fork verifier. The
 * paycheck's own RunManifest is written whatever happens.
 */
export async function runPaycheck(
  ctx: CaseContext,
  router: WorkerRouter,
  spec: PaycheckSpec,
  marks: MarkState = newMarkState(),
): Promise<PaycheckResult> {
  const fork = requireFork(ctx);
  const index = ctx.paychecks.length + 1;
  const subdir = `paychecks/${String(index).padStart(2, "0")}-${slug(spec.label)}`;
  const bundle = new EvidenceBundle(resolve(ctx.dir, subdir));
  const transactions = new TransactionLog(fork.surfnet, bundle);
  const manifest: Omit<RunManifest, "artifacts"> = {
    schemaVersion: 1,
    runId: `${ctx.runId}/${subdir}`,
    environment: "fork",
    fork: {
      startSlot: Number(fork.surfnet.startSlot),
      rpcUrl: fork.surfnet.rpcUrl,
      datasource: fork.surfnet.datasource,
      surfpoolVersion: fork.surfnet.surfpoolVersion,
      clockDriftSecs: fork.surfnet.clockDriftSecs,
    },
    startedAt: new Date().toISOString(),
    finishedAt: null,
    commit: ctx.commit,
    programId: PROGRAM_ID,
    programSha256: fork.deployment.sha256,
    programExecutableHash: ctx.env.programExecutableHash,
    programSource: ctx.env.programSource,
    crankVersion: ctx.crankVersion,
    rpc: { sender: fork.surfnet.rpcUrl, verifier: fork.surfnet.rpcUrl },
    feedIds: [],
    keys: { ...FORK_KEYS, ...ctx.extraKeys },
    router: {
      address: router.router,
      owner: router.owner.address,
      authority: router.authority,
      investBps: router.investBps,
      legs: router.legs.map((leg) => ({
        mint: assetBySymbol(leg.symbol).mint,
        symbol: leg.symbol,
        weightBps: leg.weightBps,
      })),
    },
    paycheck: null,
    transactions: [],
    legs: [],
    error: null,
  };
  const result: PaycheckResult = {
    entry: {
      label: spec.label,
      employer: spec.employer,
      employerAddress: spec.employerSigner.address,
      worker: router.name,
      workerAddress: router.owner.address,
      router: router.router,
      amount: spec.amount.toString(),
      bundle: { path: `${subdir}/manifest.json`, sha256: "0".repeat(64) },
      classification: null,
      recorded: false,
      error: null,
    },
    bundle,
    subdir,
    manifest: { ...manifest, artifacts: [] },
    legs: [],
    paycheck: null,
    account: null,
    pipeline: null,
    before: null,
    after: null,
    sendSignature: null,
  };

  try {
    result.before = await snapshotBalances(fork, bundle, router, "before");
    for (const leg of router.legs) {
      await snapshotAccount(
        fork,
        bundle,
        assetBySymbol(leg.symbol).mint,
        `raw/mints/${leg.symbol}.json`,
      );
    }
    const epoch = await jsonRpc<unknown>(fork.surfnet.rpcUrl, "getEpochInfo", [
      { commitment: "confirmed" },
    ]);
    bundle.write("raw/epoch.json", epoch.raw);
    const sent = spec.send
      ? await spec.send()
      : await sendPaycheck(fork.surfnet, {
          from: spec.employerSigner,
          to: router.owner.address,
          amount: spec.amount,
        });
    result.sendSignature = sent.signature;
    await transactions.add(`paycheck: ${spec.employer} transferChecked`, sent.signature);
    ctx.log(`${spec.label}: ${spec.employer} sent ${spec.amount} USDC base units`);

    const candidate = await detectPaycheck(
      fork.surfnet,
      { router: router.router, payIn: router.payIn },
      { timeoutMs: spec.detectTimeoutMs ?? DETECT_TIMEOUT_MS },
    ).catch((error: unknown) => {
      ctx.log(`${spec.label}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (!candidate) {
      result.entry.classification = "not_detected";
      ctx.log(`${spec.label}: the reconcile sweep saw no inflow above watermark + minimum`);
      return result;
    }
    const inflows = await resolveInflows(fork.surfnet.rpc, router.payIn, null);
    const inflow = inflows.find((i) => i.signature === sent.signature) ?? inflows[0];
    if (!inflow) throw new Error("the sweep saw a balance but no credit transaction");
    const decision = classifyInflow(
      { amount: inflow.amount, sender: inflow.sender },
      {
        owner: router.owner.address,
        authority: router.authority,
        routerMinInflow: router.minInflow,
        appThreshold: spec.rules?.appThreshold ?? router.minInflow,
        taggedPayersOnly: spec.rules?.taggedPayersOnly ?? false,
        taggedPayers: spec.rules?.taggedPayers ?? new Set(),
      },
    );
    result.entry.classification = decision.action === "record" ? "record" : decision.reason;
    ctx.log(
      `${spec.label}: detected +${candidate.delta} from ${inflow.sender}: ${result.entry.classification}`,
    );

    if (decision.action === "skip") {
      const skip = await signSendConfirm(
        fork.surfnet.rpc,
        buildMessage(ctx.signers.recorder, await latestLifetime(fork.surfnet.rpc), [
          getSkipInflowInstruction({
            signer: ctx.signers.recorder,
            router: router.router,
            payIn: router.payIn,
          }),
        ]),
      );
      await transactions.add(`skip_inflow (${decision.reason})`, skip.signature);
      return result;
    }

    const recorded = await recordPaycheck(fork.surfnet.rpc, {
      recorder: ctx.signers.recorder,
      payer: ctx.signers.crank,
      router: router.router,
      payIn: router.payIn,
      detectedSlot: candidate.slot,
    });
    await transactions.add("record_paycheck", recorded.outcome.signature);
    if (recorded.outcome.status !== "confirmed" || !recorded.account) {
      throw new Error(`record_paycheck ${recorded.outcome.status}`);
    }
    const account = recorded.account;
    result.entry.recorded = true;
    result.paycheck = recorded.paycheck;
    result.account = account;
    manifest.paycheck = {
      address: recorded.paycheck,
      seq: account.seq.toString(),
      inflow: account.inflow.toString(),
      investTotal: account.investTotal.toString(),
      sender: inflow.sender,
      inflowSignature: inflow.signature,
      recordSignature: recorded.outcome.signature,
    };
    ctx.log(`${spec.label}: recorded ${recorded.paycheck}, invest ${account.investTotal}`);

    const pending = await pendingLegs(fork.surfnet, {
      router: router.router,
      owner: router.owner.address,
      authority: router.authority,
      paycheck: recorded.paycheck,
      account,
    });
    const pipeline = await pipelineFor(ctx, fork);
    result.pipeline = pipeline;
    await spec.beforeExecute?.({
      paycheck: recorded.paycheck,
      account,
      pending,
      pipeline,
      treasury: (await fetchConfig(fork.surfnet.rpc, fork.protocol.config)).data.treasury,
    });
    result.legs = await executeWithRetries(ctx, fork, bundle, transactions, router, {
      pipeline,
      pending,
      marks,
      paycheck: recorded.paycheck,
      expiresAtMs: Number(account.expiresAt) * 1000,
      retryUntilMs: spec.retryUntilMs ?? null,
    });
    manifest.feedIds = [
      ...new Set(
        result.legs.flatMap((l) =>
          l.posts.flatMap((p) => p.hermes.response.parsed.map((x) => x.id)),
        ),
      ),
    ];
    for (const outcome of result.legs) manifest.legs.push(outcome.record);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    result.entry.error = message;
    manifest.error = message;
    if (caught instanceof HermesError) {
      bundle.write(
        "raw/hermes/refused.json",
        toJson({ status: caught.status, url: caught.url, body: caught.body }),
      );
    }
    ctx.log(`${spec.label}: stopped: ${message}`);
  } finally {
    try {
      result.after = await snapshotBalances(fork, bundle, router, "after");
    } catch (caught) {
      ctx.notes.push(`${spec.label}: after-balances snapshot failed: ${String(caught)}`);
    }
    manifest.transactions = transactions.records;
    manifest.finishedAt = new Date().toISOString();
    const path = bundle.writeManifest(manifest);
    const content = readFileSync(path, "utf8");
    result.entry.bundle = { path: `${subdir}/manifest.json`, sha256: sha256(content) };
    result.manifest = JSON.parse(content) as RunManifest;
    ctx.paychecks.push(result.entry);
  }
  return result;
}

type ExecuteInput = {
  pipeline: PipelineConfig;
  pending: PendingLeg[];
  marks: MarkState;
  paycheck: Address;
  expiresAtMs: number;
  retryUntilMs: number | null;
};

async function executeWithRetries(
  ctx: CaseContext,
  fork: ForkState,
  bundle: EvidenceBundle,
  transactions: TransactionLog,
  router: WorkerRouter,
  input: ExecuteInput,
): Promise<LegOutcome[]> {
  const runs = new Map<
    number,
    { leg: PendingLeg; rounds: { attempts: LegAttempt<LegExecutedEvent>[]; posts: PricePosts[] }[] }
  >();
  const allPosts: PricePosts[] = [];
  const closeSignatures: Signature[] = [];
  const rejected: FeedRejection[] = [];
  const expired = new Set<number>();
  let pending = input.pending;
  let round = 0;
  const treasury = (await fetchConfig(fork.surfnet.rpc, fork.protocol.config)).data.treasury;
  while (pending.length > 0) {
    const result = await executePaycheckLegs(
      input.pipeline,
      pending,
      executeInstructionBuilder({ treasury }),
      decodeLegExecuted,
      input.marks,
      {
        onAttempt: (leg, attempt) =>
          ctx.log(
            `leg ${leg.legIndex} ${leg.asset.symbol} round ${round}: ${attempt.outcome}${attempt.waitReason ? ` ${attempt.waitReason}` : ""}${attempt.error ? ` (${attempt.error})` : ""}`,
          ),
      },
    );
    allPosts.push(...result.posts);
    closeSignatures.push(...result.closeSignatures);
    rejected.push(...result.rejected);
    if (result.rejected.length > 0) {
      bundle.write(`raw/hermes/rejected-round-${round}.json`, toJson(result.rejected));
    }
    for (const legRun of result.legs) {
      const entry = runs.get(legRun.leg.legIndex) ?? { leg: legRun.leg, rounds: [] };
      entry.rounds.push({ attempts: legRun.attempts, posts: legRun.posts });
      runs.set(legRun.leg.legIndex, entry);
    }

    const waiting = result.legs.filter((legRun) => {
      const last = legRun.attempts.at(-1);
      if (last?.outcome === "failed") return INFRASTRUCTURE_FAILURE.test(last.error ?? "");
      return last?.outcome === "waiting" && isRetryable(last.waitReason);
    });
    if (waiting.length === 0) break;
    const now = Date.now();
    if (now >= input.expiresAtMs) {
      await expireLegs(
        ctx,
        fork,
        transactions,
        router,
        input.paycheck,
        waiting.map((w) => w.leg),
      );
      for (const w of waiting) expired.add(w.leg.legIndex);
      break;
    }
    if (input.retryUntilMs === null) break;
    const nextAt = Math.min(
      ...waiting.map((legRun) => {
        const last = legRun.attempts.at(-1);
        // A datasource or transport failure says nothing about the market: retry in a minute.
        if (last?.outcome === "failed") return now + INFRASTRUCTURE_RETRY_MS;
        const reason = last?.waitReason ?? WaitReason.PREMIUM_TOO_HIGH;
        const prior = (runs.get(legRun.leg.legIndex)?.rounds ?? [])
          .flatMap((r) => r.attempts)
          .filter((a) => a.waitReason === reason).length;
        const next = nextAttempt(reason, prior - 1, now);
        return next.kind === "at" ? next.unixMs : Number.POSITIVE_INFINITY;
      }),
    );
    const wakeAt = Math.min(nextAt, input.expiresAtMs + EXPIRY_GRACE_MS);
    if (wakeAt > input.retryUntilMs) {
      ctx.notes.push(
        `${waiting.map((w) => w.leg.asset.symbol).join(", ")} still waiting at the case's retry deadline`,
      );
      break;
    }
    round++;
    ctx.log(`waiting legs retry at ${new Date(wakeAt).toISOString()} (round ${round})`);
    await new Promise((r) => setTimeout(r, Math.max(0, wakeAt - Date.now())));
    if (Date.now() >= input.expiresAtMs) {
      await expireLegs(
        ctx,
        fork,
        transactions,
        router,
        input.paycheck,
        waiting.map((w) => w.leg),
      );
      for (const w of waiting) expired.add(w.leg.legIndex);
      break;
    }
    await refreshRoutes(
      fork,
      bundle,
      router,
      waiting.flatMap((w) => w.attempts),
      round,
    );
    pending = waiting.map((w) => w.leg);
  }

  const merged: PaycheckRun<LegExecutedEvent> = {
    legs: [...runs.values()]
      .sort((a, b) => a.leg.legIndex - b.leg.legIndex)
      .map(({ leg, rounds }) => ({
        leg,
        // Each executePaycheckLegs call counts attempts from zero; across retry rounds the
        // counter continues, so every attempt's artifacts get their own paths.
        attempts: rounds
          .flatMap((r) => r.attempts)
          .map((attempt, i) => ({
            ...attempt,
            key: legAttemptKey(leg.router, leg.seq, leg.legIndex, i),
          })),
        posts: rounds.flatMap((r) => r.posts),
      })),
    posts: allPosts,
    closeSignatures,
    rejected,
  };
  const recorded = await recordPaycheckRun({
    surfnet: fork.surfnet,
    bundle,
    transactions,
    run: merged,
    owner: router.owner.address,
    hermes: requireHermes(ctx.env),
  });
  return recorded.legs.map((record) => {
    const legRun = merged.legs.find((l) => l.leg.legIndex === record.index);
    if (!legRun) throw new Error(`no run for leg ${record.index}`);
    if (expired.has(record.index)) {
      record.state = "EXPIRED";
      record.waitReason = WaitReason.EXPIRED;
    }
    return { record, leg: legRun.leg, attempts: legRun.attempts, posts: legRun.posts };
  });
}
