import {
  decodeLegExecuted,
  executeInstructionBuilder,
  executePaycheckLegs,
  fetchConfig,
  getPaycheckDecoder,
  type HermesOptions,
  jsonRpc,
  type LegExecutedEvent,
  type MarkState,
  newMarkState,
  type Paycheck,
  type PaycheckRun,
  type PendingLeg,
  type PipelineConfig,
  recordPaycheck,
} from "@paycheck-router/sdk";
import type { Address, Signature } from "@solana/kit";
import { getBase64Encoder } from "@solana/kit";
import {
  createDemoRouter,
  type DemoRouter,
  deployProgram,
  type ForkSigners,
  fundForkKeys,
  initializeProtocol,
  loadForkSigners,
  type ProtocolSetup,
  type Surfnet,
  sendPaycheck,
  startSurfnet,
} from "../../scripts/lib/fork.ts";
import { detectPaycheck, pendingLegs } from "../../scripts/lib/run.ts";

export const PAYCHECK_USDC = 1_850_000_000n;

export function hermesOptions(): HermesOptions {
  const apiKey = process.env.PYTH_API_KEY;
  if (!apiKey) throw new Error("PYTH_API_KEY is required: Hermes answers 401 without it");
  return { apiKey, ...(process.env.HERMES_URL ? { baseUrl: process.env.HERMES_URL } : {}) };
}

export type ForkPaycheck = {
  surfnet: Surfnet;
  signers: ForkSigners;
  protocol: ProtocolSetup;
  demo: DemoRouter;
  paycheck: Address;
  recordSignature: Signature;
  account: Paycheck;
  detectedSlot: bigint;
};

/**
 * A fresh surfnet with the program deployed, Config and the registry initialized, the demo
 * worker's router split as given, and one paycheck detected by the sweep and recorded.
 */
export async function forkWithPaycheck(
  split: { symbol: string; weightBps: number; bandBps: number }[],
  opts: { investBps?: number; amount?: bigint } = {},
): Promise<ForkPaycheck> {
  const signers = await loadForkSigners();
  const surfnet = await startSurfnet(
    process.env.FORK_TEST_RPC_PORT ? { rpcPort: Number(process.env.FORK_TEST_RPC_PORT) } : {},
  );
  try {
    await fundForkKeys(surfnet, signers);
    await deployProgram(surfnet);
    const protocol = await initializeProtocol(surfnet, signers);
    const demo = await createDemoRouter(surfnet, signers, {
      legs: split,
      investBps: opts.investBps ?? 2_000,
      allowance: 10_000_000_000n,
    });
    await sendPaycheck(surfnet, {
      from: signers["employer-1"],
      to: signers["demo-worker"].address,
      amount: opts.amount ?? PAYCHECK_USDC,
    });
    const candidate = await detectPaycheck(surfnet, { router: demo.router, payIn: demo.payIn });
    const recorded = await recordPaycheck(surfnet.rpc, {
      recorder: signers.recorder,
      payer: signers.crank,
      router: demo.router,
      payIn: demo.payIn,
      detectedSlot: candidate.slot,
    });
    if (recorded.outcome.status !== "confirmed" || !recorded.account) {
      throw new Error(`record_paycheck ${recorded.outcome.status}`);
    }
    return {
      surfnet,
      signers,
      protocol,
      demo,
      paycheck: recorded.paycheck,
      recordSignature: recorded.outcome.signature,
      account: recorded.account,
      detectedSlot: candidate.slot,
    };
  } catch (error) {
    await surfnet.stop();
    throw error;
  }
}

export async function pipelineConfig(
  fork: ForkPaycheck,
  overrides: Partial<PipelineConfig> = {},
): Promise<PipelineConfig> {
  const config = await fetchConfig(fork.surfnet.rpc, fork.protocol.config);
  return {
    rpc: fork.surfnet.rpc,
    rpcUrl: fork.surfnet.rpcUrl,
    surfnet: true,
    forkExcludedDexes: new Set(),
    crank: fork.signers.crank,
    attester: fork.signers.attester,
    jupiter: process.env.JUPITER_API_KEY ? { apiKey: process.env.JUPITER_API_KEY } : {},
    hermes: hermesOptions(),
    protocolLookupTable: {
      [fork.protocol.lookupTable.address]: fork.protocol.lookupTable.addresses,
    },
    feeBps: config.data.feeBps,
    ...overrides,
  };
}

/** The paycheck's legs still pending on chain now. */
export async function legsOf(fork: ForkPaycheck, symbols?: string[]): Promise<PendingLeg[]> {
  const legs = await pendingLegs(fork.surfnet, {
    router: fork.demo.router,
    owner: fork.signers["demo-worker"].address,
    authority: fork.demo.authority,
    paycheck: fork.paycheck,
    account: await readPaycheck(fork),
  });
  return symbols ? legs.filter((leg) => symbols.includes(leg.asset.symbol)) : legs;
}

export async function runLegs(
  fork: ForkPaycheck,
  legs: PendingLeg[],
  opts: { config?: Partial<PipelineConfig>; marks?: MarkState } = {},
): Promise<PaycheckRun<LegExecutedEvent>> {
  const config = await pipelineConfig(fork, opts.config);
  const onchain = await fetchConfig(fork.surfnet.rpc, fork.protocol.config);
  return executePaycheckLegs(
    config,
    legs,
    executeInstructionBuilder({ treasury: onchain.data.treasury }),
    decodeLegExecuted,
    opts.marks ?? newMarkState(),
  );
}

/** The Paycheck account as the surfnet holds it now. */
export async function readPaycheck(fork: ForkPaycheck): Promise<Paycheck> {
  const { result } = await jsonRpc<{ value: { data: [string, string] } | null }>(
    fork.surfnet.rpcUrl,
    "getAccountInfo",
    [fork.paycheck, { encoding: "base64", commitment: "confirmed" }],
  );
  if (!result.value) throw new Error("paycheck account missing");
  return getPaycheckDecoder().decode(
    Uint8Array.from(getBase64Encoder().encode(result.value.data[0])),
  );
}
