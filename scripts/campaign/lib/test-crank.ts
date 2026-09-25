/**
 * A deliberately hostile or out-of-order crank for the harmful-action, replay and stale-context
 * probes. It assembles the same transaction as the SDK pipeline (compute budget, Jupiter setup,
 * the Ed25519 attestation for pre-IPO legs, execute, Jupiter cleanup) from the SDK's own
 * builders, then lets a probe tamper with one piece. It never runs in a product path.
 */
import {
  type ApiInstruction,
  buildJupiterSwap,
  buildMessage,
  classifyFailure,
  closePricePosts,
  computeBudgetInstructions,
  ed25519VerifyInstruction,
  executeInstructionBuilder,
  type FailureClassification,
  feedsFor,
  type JupiterBuildResponse,
  jsonRpc,
  latestLifetime,
  type PendingLeg,
  type PipelineConfig,
  type PricePosts,
  postPrices,
  SIMULATION_COMPUTE_UNITS,
  type SignedAttestation,
  signSendConfirm,
  simulate,
  toKitInstruction,
  toLookupTables,
  unsignedTaker,
} from "@paycheck-router/sdk";
import { type ArtifactRef, AssetKind, USDC_FEED_ID, USDC_MINT } from "@paycheck-router/shared";
import { type Address, address, type Instruction } from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token-2022";
import type { EvidenceBundle } from "../../lib/bundle.ts";
import { toJson } from "../../lib/bundle.ts";
import type { ForkState } from "./case.ts";

export type Tamper = {
  /** Whose token account Jupiter sends the shares to (defaults to the router owner). */
  jupiterRecipient?: Address;
  /** Whose token account `execute_leg` is told is the destination (defaults to the owner). */
  executeRecipient?: Address;
  /** Rewrites Jupiter's swap instruction before it is wrapped, e.g. to change its source. */
  swap?: (swap: ApiInstruction) => ApiInstruction;
  /** A signed attestation to carry instead of none (pre-IPO legs need one). */
  attestation?: SignedAttestation;
};

export type ProbeRun = {
  jupiter: { raw: string; response: JupiterBuildResponse };
  simulation: { err: unknown; logs: readonly string[] };
  simulationRef: ArtifactRef;
  failure: FailureClassification | null;
  /** Set when the probe also sent the transaction. */
  signature: string | null;
  status: string | null;
  transactionRef: ArtifactRef | null;
};

/**
 * Builds one leg's execute transaction with `tamper` applied, simulates it and, when `send` is
 * set, sends it too so the rejection is recorded onchain. Artifacts land under `name`.
 */
export async function runTamperedLeg(
  fork: ForkState,
  bundle: EvidenceBundle,
  pipeline: PipelineConfig,
  leg: PendingLeg,
  prices: PricePosts,
  treasury: Address,
  name: string,
  tamper: Tamper,
  send: boolean,
): Promise<ProbeRun> {
  const { asset } = leg;
  const fee = (leg.amountIn * BigInt(pipeline.feeBps)) / 10_000n;
  const recipients = [
    ...new Set([
      leg.owner,
      tamper.jupiterRecipient ?? leg.owner,
      tamper.executeRecipient ?? leg.owner,
    ]),
  ];
  const jupiterDestination = await tokenAccount(tamper.jupiterRecipient ?? leg.owner, leg);
  const executeDestination = await tokenAccount(tamper.executeRecipient ?? leg.owner, leg);
  const build = await buildJupiterSwap(
    {
      inputMint: USDC_MINT,
      outputMint: asset.mint,
      amount: leg.amountIn - fee,
      taker: leg.authority,
      payer: pipeline.crank.address,
      destinationTokenAccount: jupiterDestination,
      slippageBps: leg.bandBps,
      surfnet: true,
    },
    pipeline.jupiter,
  );
  bundle.write(`raw/jupiter/${name}.json`, build.raw);
  const swap = tamper.swap
    ? tamper.swap(build.response.swapInstruction)
    : build.response.swapInstruction;
  const usdcPriceUpdate = prices.accounts.get(USDC_FEED_ID);
  if (!usdcPriceUpdate) throw new Error("USDC/USD was not posted");
  const execute = await executeInstructionBuilder({ treasury })({
    leg,
    destination: executeDestination,
    swap: unsignedTaker(swap, leg.authority),
    priceUpdate: asset.feedId ? (prices.accounts.get(asset.feedId) ?? null) : null,
    priceUpdate247: asset.feedId247 ? (prices.accounts.get(asset.feedId247) ?? null) : null,
    usdcPriceUpdate,
  });
  const prefix: Instruction[] = [];
  if (asset.kind === AssetKind.preIpo) {
    if (!tamper.attestation) throw new Error("a pre-IPO probe needs an attestation");
    prefix.push(ed25519VerifyInstruction(tamper.attestation));
  }
  // Nobody outside the program can sign for the Authority PDA, so a route whose setup or cleanup
  // needs that signature cannot be sent as is. The honest pipeline refuses such a route; the
  // hostile crank drops those instructions, records them, and sends the rest.
  const needsAuthority = (ix: ApiInstruction) =>
    ix.accounts.some((a) => a.pubkey === leg.authority && a.isSigner);
  const outside = [
    ...build.response.setupInstructions,
    ...(build.response.cleanupInstruction ? [build.response.cleanupInstruction] : []),
  ];
  const dropped = outside.filter(needsAuthority);
  if (dropped.length > 0) bundle.write(`raw/test-crank/${name}-dropped.json`, toJson(dropped));
  const setup = build.response.setupInstructions.filter((ix) => !needsAuthority(ix));
  const cleanup =
    build.response.cleanupInstruction && !needsAuthority(build.response.cleanupInstruction)
      ? [build.response.cleanupInstruction]
      : [];
  const body: Instruction[] = [
    ...(await Promise.all(
      recipients.map(async (owner) =>
        getCreateAssociatedTokenIdempotentInstruction({
          payer: pipeline.crank,
          ata: await tokenAccount(owner, leg),
          owner,
          mint: asset.mint,
          tokenProgram: asset.tokenProgram,
        }),
      ),
    )),
    ...setup.map(toKitInstruction),
    ...prefix,
    execute,
    ...cleanup.map(toKitInstruction),
  ];
  const lookupTables = {
    ...toLookupTables(build.response.addressesByLookupTableAddress),
    ...pipeline.protocolLookupTable,
  };
  const message = buildMessage(
    pipeline.crank,
    await latestLifetime(fork.surfnet.rpc),
    [...computeBudgetInstructions(SIMULATION_COMPUTE_UNITS, 0n), ...body],
    lookupTables,
  );
  const simulation = await simulate(fork.surfnet.rpc, message);
  const simulationRef = bundle.write(
    `raw/simulation/${name}.json`,
    toJson({ err: simulation.err, logs: simulation.logs, unitsConsumed: simulation.unitsConsumed }),
  );
  const run: ProbeRun = {
    jupiter: { raw: build.raw, response: build.response },
    simulation,
    simulationRef,
    failure: simulation.err ? classifyFailure(simulation.err, simulation.logs) : null,
    signature: null,
    status: null,
    transactionRef: null,
  };
  if (send) {
    const outcome = await signSendConfirm(fork.surfnet.rpc, message);
    run.signature = outcome.signature;
    run.status = outcome.status;
    const { raw } = await jsonRpc<unknown>(fork.surfnet.rpcUrl, "getTransaction", [
      outcome.signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
    ]);
    run.transactionRef = bundle.write(`raw/tx/${outcome.signature}.json`, raw);
  }
  return run;
}

export async function tokenAccount(owner: Address, leg: PendingLeg): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({
    owner,
    mint: leg.asset.mint,
    tokenProgram: leg.asset.tokenProgram,
  });
  return ata;
}

/** Replaces one account in a Jupiter instruction, keeping its role flags. */
export function replaceAccount(swap: ApiInstruction, from: Address, to: Address): ApiInstruction {
  return {
    ...swap,
    accounts: swap.accounts.map((meta) =>
      meta.pubkey === from ? { ...meta, pubkey: address(to) } : meta,
    ),
  };
}

/** The program error name a probe observed, or a description of any other outcome. */
export function observedError(run: ProbeRun): string {
  const failure = run.failure;
  if (!failure) return "simulation:success";
  if (failure.kind === "program") return `error:${failure.error.name}`;
  if (failure.kind === "external") return `external:${failure.program}:${failure.code ?? "none"}`;
  return `landing:${failure.detail}`;
}

/**
 * Posts one fully verified Hermes update for `legs`, runs `body` with it and closes the posted
 * accounts afterwards. Throws with Hermes's refusal when a feed the legs need is refused.
 */
export async function withPrices<T>(
  fork: ForkState,
  pipeline: PipelineConfig,
  legs: PendingLeg[],
  body: (prices: PricePosts) => Promise<T>,
): Promise<T> {
  const { posts, rejected } = await postPrices(pipeline, feedsFor(legs));
  if (!posts || rejected.length > 0) {
    throw new Error(
      `Hermes refused ${rejected.map((r) => `${r.feedId} (${r.status}: ${r.body.slice(0, 120)})`).join(", ") || "every feed"}`,
    );
  }
  for (const signature of posts.signatures) await fork.transactions.add("pyth post", signature);
  try {
    return await body(posts);
  } finally {
    for (const signature of await closePricePosts(pipeline, posts)) {
      await fork.transactions.add("pyth close", signature);
    }
  }
}
