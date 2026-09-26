import * as sdk from "@paycheck-router/sdk";
import {
  AssetKind,
  assetByMint,
  TOKEN_PROGRAM_ID,
  USDC_DECIMALS,
  USDC_FEED_ID,
  USDC_MINT,
  WaitReason,
} from "@paycheck-router/shared";
import {
  AccountRole,
  type Address,
  type AddressesByLookupTableAddress,
  address,
  createNoopSigner,
  createSolanaRpc,
  getBase64EncodedWireTransaction,
  type Instruction,
  type KeyPairSigner,
  partiallySignTransactionMessageWithSigners,
  signature as toSignature,
} from "@solana/kit";
import { fetchAddressLookupTable } from "@solana-program/address-lookup-table";
import {
  findAssociatedTokenPda,
  getApproveCheckedInstruction,
  getRevokeInstruction,
} from "@solana-program/token";
import { routerPdaFor } from "../chain/accounts.ts";
import { createChainClient } from "../chain/client.ts";
import { hotSigner } from "../chain/keys.ts";
import { LEG_STATUS } from "../chain/leg-status.ts";
import { mintTerms } from "../chain/mints.ts";
import { multiplierFromE12 } from "../chain/shares.ts";
import { chainEndpoints } from "../config.ts";
import { throughGate } from "../do/rate-gate.ts";
import { markBookFor } from "../do/stubs.ts";
import type { Env } from "../env.ts";
import { log } from "../log.ts";
import { fromMarkState, toMarkState } from "./marks.ts";
import { type AttemptPricing, type MeasuredQuote, measureQuote } from "./premium.ts";
import type {
  AttemptRecord,
  BuiltTransaction,
  Engine,
  LegJob,
  LegOutcome,
  RouterRef,
  RouterState,
  VerificationOutcome,
} from "./types.ts";

type Executed = NonNullable<Awaited<ReturnType<typeof sdk.decodeLegExecuted>>>;

/**
 * DEXes whose fork copy failed a simulation; the SDK re-quotes around them. Kept for the life of
 * the isolate, which on a surfnet run is the whole run.
 */
const forkExcludedDexes = new Set<string>();

/** JSON-safe copy of an SDK object for evidence and attempt records. */
function plain(value: unknown): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(value, (_key, inner) => (typeof inner === "bigint" ? inner.toString() : inner)),
  ) as Record<string, unknown>;
}

function pendingLegOf(job: LegJob): sdk.PendingLeg {
  const asset = assetByMint(job.mint);
  if (!asset) throw new Error(`asset ${job.mint} is not in the registry`);
  return {
    router: address(job.router.routerPda),
    owner: address(job.router.owner),
    authority: address(job.router.authority),
    paycheck: address(job.paycheckPda),
    seq: job.seq,
    legIndex: job.idx,
    asset,
    amountIn: job.amountIn,
    bandBps: job.bandBps,
  };
}

/** The quote and reference an attempt used, in the shape `measureQuote` reads. */
function attemptPricing(attempt: sdk.LegAttempt<Executed>): AttemptPricing {
  const quote = attempt.jupiter?.response;
  return {
    parsed: attempt.pricePosts?.hermes.response.parsed ?? [],
    markPriceE9: attempt.attestation?.signed.attestation.markPriceE9 ?? null,
    quotedIn: quote ? BigInt(quote.inAmount) : null,
    quotedOut: quote ? BigInt(quote.outAmount) : null,
  };
}

function measuredOf(
  asset: sdk.PendingLeg["asset"],
  attempt: sdk.LegAttempt<Executed>,
  multiplierE12: bigint | null,
): MeasuredQuote | null {
  if (multiplierE12 === null) return null;
  try {
    return measureQuote(asset, attemptPricing(attempt), multiplierE12);
  } catch (error) {
    log.warn("could not measure the attempt's premium", { error });
    return null;
  }
}

function referenceRecord(measured: MeasuredQuote | null): Record<string, unknown> | null {
  if (!measured) return null;
  return {
    source: measured.source,
    refPriceE9: measured.refPriceE9.toString(),
    usdcPriceE9: measured.usdcPriceE9.toString(),
    quotedIn: measured.quotedIn.toString(),
    quotedOut: measured.quotedOut.toString(),
    multiplierE12: measured.multiplierE12.toString(),
    premiumBps: measured.premiumBps,
  };
}

function attemptRecord(
  attempt: sdk.LegAttempt<Executed>,
  attemptNo: number,
  asset: sdk.PendingLeg["asset"],
  multiplierE12: bigint | null,
): AttemptRecord {
  const failure = attempt.failure;
  return {
    attemptNo,
    kind: attempt.signature ? "send" : "simulate",
    outcome: attempt.outcome,
    programErrorCode: failure?.kind === "program" ? failure.error.code : null,
    reason: attempt.waitReason ?? attempt.error ?? (failure ? failure.kind : null),
    signature: attempt.signature,
    cuUsed:
      attempt.simulation?.unitsConsumed !== null && attempt.simulation?.unitsConsumed !== undefined
        ? Number(attempt.simulation.unitsConsumed)
        : null,
    priorityFeeLamports: null,
    quote: attempt.jupiter
      ? {
          inAmount: attempt.jupiter.response.inAmount,
          outAmount: attempt.jupiter.response.outAmount,
          route: attempt.jupiter.response.routePlan.map((hop) => hop.swapInfo.label),
        }
      : null,
    reference: referenceRecord(measuredOf(asset, attempt, multiplierE12)),
    simLogs: attempt.simulation?.logs ?? null,
  };
}

/** Execution price per whole share in USD × 1e9 from what the swap actually delivered. */
function execPriceE9(event: Executed, decimals: number): bigint | null {
  const shares = event.outAmount + event.issuerFee;
  if (shares <= 0n || event.multiplierE12 <= 0n) return null;
  return (
    (event.swappedIn * 1_000n * 10n ** BigInt(decimals) * 1_000_000_000_000n) /
    (shares * event.multiplierE12)
  );
}

/** Maps one leg's run through the SDK pipeline to core's outcome. */
function outcomeOf(
  job: LegJob,
  run: sdk.LegRun<Executed>,
  multiplierE12: bigint | null,
): LegOutcome {
  const records = run.attempts.map((attempt, i) =>
    attemptRecord(attempt, job.attemptNo + i, run.leg.asset, multiplierE12),
  );
  const last = run.attempts.at(-1);
  if (last?.outcome === "executed" && last.event && last.signature) {
    const decimals = run.leg.asset.decimals;
    const view = sdk.legExecutedView(last.event);
    return {
      kind: "executed",
      attempts: records,
      leg: {
        signature: last.signature,
        slot: last.slot ?? 0n,
        outAmount: last.event.outAmount,
        fee: last.event.fee,
        issuerFee: last.event.issuerFee,
        uiMultiplier: multiplierFromE12(last.event.multiplierE12),
        refPriceE9: last.event.refPriceE9,
        execPriceE9: execPriceE9(last.event, decimals),
        premiumBps: Number(sdk.legCosts(view, decimals).premiumBps),
        evidence: {
          event: last.event,
          postedUpdate: run.posts.at(-1)?.hermes.response ?? null,
          attestationSignature: last.attestation?.signed.signature ?? null,
        },
      },
    };
  }
  const programErrorCode = last?.failure?.kind === "program" ? last.failure.error.code : null;
  if (last?.outcome === "waiting" && last.waitReason) {
    const measured = measuredOf(run.leg.asset, last, multiplierE12);
    return {
      kind: "waiting",
      reason: last.waitReason,
      programErrorCode,
      attempts: records,
      measured: measured
        ? { refPriceE9: measured.refPriceE9, premiumBps: measured.premiumBps }
        : null,
    };
  }
  return {
    kind: "failed",
    error: last?.error ?? "attempt ended without an outcome",
    programErrorCode,
    attempts: records,
  };
}

/**
 * The `packages/sdk` pipeline behind core's Engine port. Every read and send goes to the
 * configured chain endpoint, which on a surfnet is the surfnet alone.
 */
export function createSdkEngine(env: Env): Engine {
  const endpoints = chainEndpoints(env);
  const rpc = createSolanaRpc(endpoints.rpcUrl, { headers: endpoints.headers });
  const chain = createChainClient(endpoints);
  const verifyRpc = createSolanaRpc(endpoints.verifyRpcUrl, { headers: endpoints.headers });
  const hermes: sdk.HermesOptions = {
    baseUrl: env.HERMES_URL,
    ...(env.PYTH_API_KEY ? { apiKey: env.PYTH_API_KEY } : {}),
  };
  const jupiter: sdk.JupiterClientOptions = {
    ...(env.JUPITER_API_KEY ? { apiKey: env.JUPITER_API_KEY } : {}),
    fetch: async (input, init) => {
      await throughGate(env.RATE_GATE, "jupiter");
      return fetch(input, init);
    },
  };

  let configCache: Promise<{ treasury: Address; feeBps: number; attester: Address }> | null = null;
  const protocolConfig = () => {
    configCache ??= (async () => {
      const [configPda] = await sdk.findConfigPda();
      const config = await sdk.fetchConfig(rpc, configPda, { commitment: "confirmed" });
      return {
        treasury: config.data.treasury,
        feeBps: config.data.feeBps,
        attester: config.data.attester,
      };
    })();
    return configCache;
  };

  /** The protocol lookup table (`PROTOCOL_ALT`) keeps execute transactions under 1,232 bytes. */
  let lookupCache: Promise<AddressesByLookupTableAddress> | null = null;
  const protocolLookupTable = () => {
    lookupCache ??= (async () => {
      if (!env.PROTOCOL_ALT) return {};
      const table = address(env.PROTOCOL_ALT);
      const account = await fetchAddressLookupTable(rpc, table, { commitment: "confirmed" });
      return { [table]: account.data.addresses };
    })().catch((error: unknown) => {
      lookupCache = null;
      throw error;
    });
    return lookupCache;
  };

  const pipelineConfig = async (): Promise<sdk.PipelineConfig> => {
    const config = await protocolConfig();
    return {
      rpc,
      rpcUrl: endpoints.rpcUrl,
      surfnet: endpoints.surfnet,
      crank: await hotSigner(env, "CRANK_KEY"),
      attester: env.ATTESTER_KEY ? await hotSigner(env, "ATTESTER_KEY") : null,
      jupiter,
      hermes,
      protocolLookupTable: await protocolLookupTable(),
      ...(endpoints.surfnet ? { forkExcludedDexes } : {}),
      feeBps: config.feeBps,
    };
  };

  async function sendWith(payer: KeyPairSigner, instructions: Instruction[]): Promise<string> {
    const outcome = await sdk.signSendConfirm(
      rpc,
      sdk.buildMessage(payer, await sdk.latestLifetime(rpc), instructions),
    );
    if (outcome.status !== "confirmed") {
      throw new Error(
        `transaction ${outcome.signature} ${outcome.status}: ${JSON.stringify(plain({ err: outcome.err }))}`,
      );
    }
    return outcome.signature;
  }

  async function sponsoredTransaction(
    instructions: Instruction[],
    summary: string[],
  ): Promise<BuiltTransaction> {
    const sponsor = await hotSigner(env, "SPONSOR_KEY");
    const lifetime = await sdk.latestLifetime(rpc);
    const message = sdk.buildMessage(sponsor, lifetime, instructions);
    const signed = await partiallySignTransactionMessageWithSigners(message);
    return {
      tx: getBase64EncodedWireTransaction(signed),
      feePayer: sponsor.address,
      lastValidBlockHeight: lifetime.lastValidBlockHeight,
      summary,
    };
  }

  return {
    async sweep(routers, inFlight) {
      const hits = await sdk.reconcileSweep(
        rpc,
        routers.map((router) => ({
          router: address(router.routerPda),
          payIn: address(router.payIn),
        })),
        sdk.decodeRouterSnapshot,
        inFlight,
      );
      return hits.map((hit) => ({
        routerPda: hit.router,
        balance: hit.balance,
        watermark: hit.watermark,
        delta: hit.delta,
        slot: hit.slot,
      }));
    },

    async resolveInflows(payIn, until) {
      const inflows = await sdk.resolveInflows(
        rpc,
        address(payIn),
        until ? toSignature(until) : null,
      );
      return inflows.map((inflow) => ({
        signature: inflow.signature,
        slot: inflow.slot,
        amount: inflow.amount,
        sender: inflow.sender,
      }));
    },

    classify(inflow, router, rules) {
      return sdk.classifyInflow(
        { amount: inflow.amount, sender: inflow.sender ? address(inflow.sender) : null },
        {
          owner: address(router.owner),
          authority: address(router.authority),
          routerMinInflow: rules.minInflow,
          appThreshold: rules.appThreshold,
          taggedPayersOnly: rules.taggedPayersOnly,
          taggedPayers: new Set(rules.taggedPayers.map((payer) => address(payer))),
        },
      );
    },

    async recordPaycheck(router: RouterRef) {
      const recorder = await hotSigner(env, "RECORDER_KEY");
      const crank = await hotSigner(env, "CRANK_KEY");
      const detectedSlot = await rpc.getSlot({ commitment: "confirmed" }).send();
      const { outcome, paycheck, account } = await sdk.recordPaycheck(rpc, {
        recorder,
        payer: crank,
        router: address(router.routerPda),
        payIn: address(router.payIn),
        detectedSlot,
      });
      if (outcome.status !== "confirmed" || !account) {
        const failure = outcome.status === "failed" ? sdk.classifyFailure(outcome.err, []) : null;
        if (failure?.kind === "program" && failure.error.name === "NoNewInflow") {
          return { kind: "nothing_new" };
        }
        return {
          kind: "failed",
          error: `record_paycheck ${outcome.status}: ${JSON.stringify(plain({ err: outcome.err }))}`,
          programErrorCode: failure?.kind === "program" ? failure.error.code : null,
        };
      }
      const routerAccount = await sdk.fetchRouter(rpc, address(router.routerPda), {
        commitment: "confirmed",
      });
      const bands = new Map(routerAccount.data.legs.map((leg) => [leg.mint, leg.bandBps]));
      return {
        kind: "recorded",
        paycheck: {
          signature: outcome.signature,
          paycheckPda: paycheck,
          seq: account.seq,
          inflow: account.inflow,
          investTotal: account.investTotal,
          recordedAt: new Date(Number(account.recordedAt) * 1000),
          expiresAt: new Date(Number(account.expiresAt) * 1000),
          legs: account.legs.map((leg, idx) => ({
            idx,
            mint: leg.mint,
            amountIn: leg.amountIn,
            bandBps: bands.get(leg.mint) ?? 0,
          })),
        },
      };
    },

    async skipInflow(router) {
      const recorder = await hotSigner(env, "RECORDER_KEY");
      const crank = await hotSigner(env, "CRANK_KEY");
      const signature = await sendWith(crank, [
        sdk.getSkipInflowInstruction({
          signer: recorder,
          router: address(router.routerPda),
          payIn: address(router.payIn),
        }),
      ]);
      return { signature };
    },

    async executeLegs(jobs, hooks) {
      if (jobs.length === 0) return;
      const config = await pipelineConfig();
      const { treasury } = await protocolConfig();
      const byIndex = new Map(jobs.map((job) => [job.idx, job]));
      const reported = new Set<number>();
      const book = markBookFor(env);
      const marks = toMarkState(await book.load());
      try {
        await sdk.executePaycheckLegs(
          config,
          jobs.map(pendingLegOf),
          sdk.executeInstructionBuilder({ treasury }),
          sdk.decodeLegExecuted,
          marks,
          {
            onLegStart: async (leg) => {
              const job = byIndex.get(leg.legIndex);
              if (job) await hooks.executing(job);
            },
            onLegDone: async (run) => {
              const job = byIndex.get(run.leg.legIndex);
              if (!job) return;
              reported.add(job.idx);
              const terms = await mintTerms(chain, [run.leg.asset.mint], new Date()).catch(
                (error: unknown) => {
                  log.warn("could not read the mint's multiplier", { error });
                  return null;
                },
              );
              const multiplierE12 = terms?.get(run.leg.asset.mint)?.multiplierE12 ?? null;
              await hooks.outcome(job, outcomeOf(job, run, multiplierE12));
            },
          },
        );
      } catch (error) {
        log.error("paycheck batch failed", { error });
        for (const job of jobs) {
          if (reported.has(job.idx)) continue;
          await hooks.outcome(job, {
            kind: "waiting",
            reason: WaitReason.LANDING,
            programErrorCode: null,
            attempts: [
              {
                attemptNo: job.attemptNo,
                kind: "simulate",
                outcome: "failed",
                programErrorCode: null,
                reason: error instanceof Error ? error.message : String(error),
                signature: null,
                cuUsed: null,
                priorityFeeLamports: null,
                quote: null,
                reference: null,
                simLogs: null,
              },
            ],
          });
        }
      }
      await book.save(fromMarkState(marks));
    },

    async expireLeg(job) {
      const crank = await hotSigner(env, "CRANK_KEY");
      const signature = await sendWith(crank, [
        sdk.buildExpireLegInstruction({
          router: address(job.router.routerPda),
          paycheck: address(job.paycheckPda),
          legIndex: job.idx,
        }),
      ]);
      return { signature };
    },

    async verifyLeg(job): Promise<VerificationOutcome> {
      const asset = assetByMint(job.mint);
      if (!asset) throw new Error(`asset ${job.mint} is not in the registry`);
      const event = job.evidence.event as Executed | undefined;
      if (!event) throw new Error("verification needs the decoded LegExecuted event");
      const view = sdk.legExecutedView(event);
      const commitment = endpoints.surfnet ? "confirmed" : "finalized";
      const transaction = await verifyRpc
        .getTransaction(toSignature(job.signature), {
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
          commitment,
        })
        .send();
      if (!transaction) throw new Error(`transaction ${job.signature} is not ${commitment} yet`);
      const paycheck = await sdk.fetchPaycheck(verifyRpc, address(view.paycheck), { commitment });
      const legState = paycheck.data.legs[job.idx];
      const feedId =
        view.priceSource === "Pyth247"
          ? asset.feedId247
          : view.priceSource === "PythRegular"
            ? asset.feedId
            : null;
      const postedUpdate = (job.evidence.postedUpdate as sdk.HermesUpdateResponse | null) ?? null;
      const history = await historyAtPublishTimes(
        hermes,
        feedId ? { feedId, publishTime: Number(view.pricePublishTime) } : null,
        postedUpdate?.parsed.find((p) => p.id === USDC_FEED_ID)?.price.publish_time ?? null,
      );
      const { attester } = await protocolConfig();
      const attestationSignature = job.evidence.attestationSignature as
        | Uint8Array
        | null
        | undefined;
      const result = await sdk.verifyLeg({
        event: view,
        transaction: transaction as unknown as sdk.ParsedTransactionView,
        owner: address(job.router.owner),
        usdcMint: USDC_MINT,
        decimals: asset.decimals,
        postedUpdate,
        history,
        feedId,
        usdcFeedId: USDC_FEED_ID,
        readback: legState
          ? {
              executed: legState.status === LEG_STATUS.executed,
              amountIn: legState.amountIn,
              outAmount: legState.outAmount,
              fee: legState.fee,
              issuerFee: legState.issuerFee,
              executedAt: legState.executedAt,
              refPriceE9: legState.refPriceE9,
            }
          : null,
        attestation:
          asset.kind === AssetKind.preIpo && attestationSignature
            ? { attester, signature: attestationSignature }
            : null,
      });
      const failed = result.checks.filter((check) => !check.pass);
      const received = BigInt(event.outAmount);
      return {
        rpcProvider: endpoints.verifyProvider,
        finalizedSlot: BigInt(transaction.slot),
        ownerDeltaRaw: received,
        ownerUsdcDelta: -(event.amountIn - event.dustReturned),
        recomputedMinOut: event.minOut,
        recomputedPremiumBps: Number(sdk.legCosts(view, asset.decimals).premiumBps),
        matches: result.state === "VERIFIED",
        diff:
          failed.length > 0
            ? { failed: plain(failed), checks: plain(result.checks) }
            : { checks: plain(result.checks) },
        hermesPublishTime: new Date(Number(view.pricePublishTime) * 1000),
      };
    },

    async readRouter(routerPda) {
      const account = await sdk.fetchMaybeRouter(rpc, address(routerPda), {
        commitment: "confirmed",
      });
      if (!account.exists) return null;
      const data = account.data;
      const state: RouterState = {
        owner: data.owner,
        payIn: data.payIn,
        recorder: data.recorder,
        investBps: data.investBps,
        minInflow: data.minInflow,
        dailyCap: data.dailyCap,
        maxWaitSecs: data.maxWaitSecs,
        autoConvert: data.autoConvert,
        paused: data.paused,
        watermark: data.watermark,
        paycheckSeq: data.paycheckSeq,
        legs: data.legs.slice(0, data.legCount).map((leg) => ({
          mint: leg.mint,
          weightBps: leg.weightBps,
          bandBps: leg.bandBps,
          enabled: leg.enabled,
        })),
      };
      return state;
    },

    async buildCreateRouter(input) {
      const sponsor = await hotSigner(env, "SPONSOR_KEY");
      const recorder = await hotSigner(env, "RECORDER_KEY");
      const instructions = await sdk.buildSetupInstructions({
        owner: address(input.owner),
        payer: sponsor,
        allowance: input.allowance,
        params: {
          recorder: recorder.address,
          investBps: input.investBps,
          minInflow: input.minInflow,
          dailyCap: input.dailyCap,
          maxWaitSecs: input.maxWaitSecs,
          autoConvert: input.autoConvert,
          legs: input.legs.map((leg) => ({
            mint: address(leg.mint),
            weightBps: leg.weightBps,
            bandBps: leg.bandBps,
            enabled: true,
          })),
        },
      });
      const symbols = input.legs.map((leg) => assetByMint(leg.mint)?.symbol ?? leg.mint);
      const allowance = (Number(input.allowance) / 1_000_000).toLocaleString("en-US");
      const summary = [
        "Create your Paycheck Router",
        `Allow it to spend up to ${allowance} USDC from this wallet, only to buy ${symbols.join(", ")} into this wallet`,
      ];
      const preIpo = input.legs
        .map((leg) => assetByMint(leg.mint))
        .filter((asset) => asset?.kind === AssetKind.preIpo)
        .map((asset) => asset?.symbol);
      if (preIpo.length > 0) {
        summary.push(`Allow ${preIpo.join(", ")} conversion at IPO, into this wallet only`);
      }
      summary.push("Network fees and account rent paid by Paycheck Router");
      return sponsoredTransaction(instructions, summary);
    },

    async buildCancelLeg(input) {
      const router = await routerPdaFor(address(env.PROGRAM_ID), address(input.owner));
      const instruction = sdk.buildCancelLegInstruction({
        owner: createNoopSigner(address(input.owner)),
        router,
        paycheck: address(input.paycheckPda),
        legIndex: input.idx,
      });
      return sponsoredTransaction(
        [instruction],
        ["Cancel this waiting slice", "Its USDC stays in your wallet"],
      );
    },

    async buildRouterAction(action) {
      const owner = createNoopSigner(address(action.owner));
      const router = await routerPdaFor(address(env.PROGRAM_ID), owner.address);
      const [payIn] = await findAssociatedTokenPda({
        owner: owner.address,
        mint: USDC_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
      });
      switch (action.kind) {
        case "update": {
          const recorder = await hotSigner(env, "RECORDER_KEY");
          const instruction = await sdk.getUpdateRouterInstructionAsync({
            owner,
            router,
            params: {
              recorder: recorder.address,
              investBps: action.investBps,
              minInflow: action.minInflow,
              dailyCap: action.dailyCap,
              maxWaitSecs: action.maxWaitSecs,
              autoConvert: action.autoConvert,
              legs: action.legs.map((leg) => ({
                mint: address(leg.mint),
                weightBps: leg.weightBps,
                bandBps: leg.bandBps,
                enabled: true,
              })),
            },
          });
          const assets = await Promise.all(
            action.legs.map(async (leg) => ({
              address: (await sdk.findAssetPda({ mint: address(leg.mint) }))[0],
              role: AccountRole.READONLY,
            })),
          );
          return sponsoredTransaction(
            [{ ...instruction, accounts: [...(instruction.accounts ?? []), ...assets] }],
            ["Change your split and rules", "Network fees paid by Paycheck Router"],
          );
        }
        case "pause":
          return sponsoredTransaction(
            [
              await sdk.getSetRouterPausedInstructionAsync({
                owner,
                router,
                paused: action.paused,
              }),
            ],
            [action.paused ? "Pause your Paycheck Router" : "Resume your Paycheck Router"],
          );
        case "allowance": {
          const [authority] = await sdk.findAuthorityPda({ router });
          const usdc = (Number(action.amount) / 1_000_000).toLocaleString("en-US");
          return sponsoredTransaction(
            [
              getApproveCheckedInstruction({
                source: payIn,
                mint: USDC_MINT,
                delegate: authority,
                owner,
                amount: action.amount,
                decimals: USDC_DECIMALS,
              }),
            ],
            [`Allow your Paycheck Router to spend up to ${usdc} USDC from this wallet`],
          );
        }
        case "revoke":
          return sponsoredTransaction(
            [getRevokeInstruction({ source: payIn, owner })],
            [
              "Revoke your Paycheck Router's USDC allowance",
              "Nothing will be bought until you approve again",
            ],
          );
        case "close": {
          const state = await sdk.fetchRouter(rpc, router, { commitment: "confirmed" });
          const [authority] = await sdk.findAuthorityPda({ router });
          const [authorityUsdc] = await findAssociatedTokenPda({
            owner: authority,
            mint: USDC_MINT,
            tokenProgram: TOKEN_PROGRAM_ID,
          });
          const instruction = await sdk.getCloseRouterInstructionAsync({
            owner,
            router,
            rentPayer: state.data.rentPayer,
            authority,
            authorityUsdc,
            payIn,
            usdcMint: USDC_MINT,
            usdcTokenProgram: TOKEN_PROGRAM_ID,
          });
          return sponsoredTransaction(
            [instruction, getRevokeInstruction({ source: payIn, owner })],
            [
              "Close your Paycheck Router and revoke its allowance",
              "Account rent returns to whoever paid it",
            ],
          );
        }
      }
    },

    async buildBuyNow() {
      throw new Error("buy-now needs execute_leg_owner support in the SDK pipeline");
    },
  };
}

/**
 * Hermes history for each price the leg used, each at its own publish time: the asset's feed at
 * the event's publish time, and USDC/USD at the publish time of the posted USDC update. A pre-IPO
 * leg's event time is the attestation's, which need not match the USDC post's.
 */
async function historyAtPublishTimes(
  hermes: sdk.HermesOptions,
  asset: { feedId: string; publishTime: number } | null,
  usdcPublishTime: number | null,
): Promise<sdk.HermesUpdateResponse | null> {
  const requests: Promise<sdk.HermesUpdateResponse>[] = [];
  if (asset) {
    requests.push(
      sdk.fetchUpdateAt(asset.publishTime, [asset.feedId], hermes).then((u) => u.response),
    );
  }
  if (usdcPublishTime !== null) {
    requests.push(
      sdk.fetchUpdateAt(usdcPublishTime, [USDC_FEED_ID], hermes).then((u) => u.response),
    );
  }
  if (requests.length === 0) return null;
  try {
    const updates = await Promise.all(requests);
    return {
      binary: { encoding: "base64", data: updates.flatMap((u) => u.binary.data) },
      parsed: updates.flatMap((u) => u.parsed),
    };
  } catch (error) {
    log.warn("Hermes history unavailable", { error });
    return null;
  }
}
