/**
 * P7 chain ablation: what the same slices would have cost in gas on Ethereum mainnet, where
 * xStocks also trade. Read-only public data: an Ethereum RPC for real xStock swap receipts,
 * blocks and fee history, and Pyth ETH/USD from Hermes history. Computed, never executed.
 */
import { fetchUpdateAt, type HermesOptions } from "@paycheck-router/sdk";
import type { ArtifactRef } from "@paycheck-router/shared";
import type { EvidenceBundle } from "../../lib/bundle.ts";
import { toJson } from "../../lib/bundle.ts";
import type { CaseManifest } from "./manifest.ts";
import { hermesPriceE9, median } from "./metrics.ts";
import { readArtifactJson } from "./slices.ts";

export const ETHEREUM_RPC_URL = "https://ethereum-rpc.publicnode.com";
/** NVDAx on Ethereum, from CoinGecko's platform list for the Solana mint. */
export const NVDAX_ETHEREUM = "0xc845b2894dbddd03858fd2d643b4ef725fe0849d";
export const ETH_USD_FEED = "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** Swap events of Uniswap v2, v3 and v4, Balancer v2 and Curve: a receipt with one is a swap. */
export const SWAP_TOPICS = new Set([
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822",
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
  "0x2170c741c41531aec20e7c107c24eecfdd15e69c9bb0a8dd37b1840b9e0b207b",
  "0x8b3e96f2b889fa771c53c981b40daf005f63f637f1869f707052d15a3dd97140",
]);
const SLOT_SECS = 12;
const LOG_SPAN_BLOCKS = 5_000;
const MAX_RECEIPTS = 30;
const MIN_SWAP_RECEIPTS = 3;
export const CHAIN_INDEX = "raw/ethereum/index.json";

export type ChainPoint = {
  slice: string;
  at: string;
  sliceUsdc: string;
  block: string;
  feeHistory: string;
  ethUsd: string;
};

export type ChainIndex = {
  rpcUrl: string;
  token: { symbol: string; ethereum: string };
  logs: string;
  receipts: string[];
  points: ChainPoint[];
};

const ETH_CALL_ATTEMPTS = 3;

/** One read from the public RPC, retried twice: a free endpoint drops the odd request. */
async function ethCall<T>(method: string, params: unknown[]): Promise<{ result: T; raw: string }> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= ETH_CALL_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(ETHEREUM_RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const raw = await res.text();
      const body = JSON.parse(raw) as { result?: T; error?: unknown };
      if (!res.ok || body.error) throw new Error(`${method}: ${raw.slice(0, 300)}`);
      return { result: body.result as T, raw };
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 1_000 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

type Block = { number: string; timestamp: string };

/** The block whose timestamp is closest to `unixSecs`, from the 12 s slot clock and 3 reads. */
async function blockAt(unixSecs: number, latest: Block): Promise<{ block: Block; raw: string }> {
  let number =
    Number.parseInt(latest.number, 16) -
    Math.round((Number.parseInt(latest.timestamp, 16) - unixSecs) / SLOT_SECS);
  let found: { block: Block; raw: string } | null = null;
  for (let i = 0; i < 3; i++) {
    const read = await ethCall<Block>("eth_getBlockByNumber", [`0x${number.toString(16)}`, false]);
    found = { block: read.result, raw: read.raw };
    const drift = unixSecs - Number.parseInt(read.result.timestamp, 16);
    if (Math.abs(drift) < SLOT_SECS) break;
    number += Math.round(drift / SLOT_SECS);
  }
  if (!found) throw new Error(`no block for ${unixSecs}`);
  return found;
}

/** Fetches every Ethereum and Hermes read the chain ablation needs and indexes them. */
export async function fetchChainData(
  bundle: EvidenceBundle,
  points: { slice: string; at: string; sliceUsdc: bigint }[],
  hermes: HermesOptions,
): Promise<ArtifactRef> {
  const latest = await ethCall<Block>("eth_getBlockByNumber", ["latest", false]);
  bundle.write("raw/ethereum/latest-block.json", latest.raw);
  const head = Number.parseInt(latest.result.number, 16);
  const logs = await ethCall<{ transactionHash: string }[]>("eth_getLogs", [
    {
      address: NVDAX_ETHEREUM,
      topics: [TRANSFER_TOPIC],
      fromBlock: `0x${(head - LOG_SPAN_BLOCKS).toString(16)}`,
      toBlock: latest.result.number,
    },
  ]);
  const logsPath = "raw/ethereum/nvdax-transfers.json";
  bundle.write(logsPath, logs.raw);
  const receipts: string[] = [];
  const hashes = [...new Set(logs.result.map((l) => l.transactionHash))].slice(0, MAX_RECEIPTS);
  for (const hash of hashes) {
    const receipt = await ethCall<unknown>("eth_getTransactionReceipt", [hash]);
    const path = `raw/ethereum/receipts/${hash}.json`;
    bundle.write(path, receipt.raw);
    receipts.push(path);
  }
  const indexed: ChainPoint[] = [];
  const byMinute = new Map<number, { block: string; feeHistory: string; ethUsd: string }>();
  for (const point of points) {
    const unix = Math.floor(Date.parse(point.at) / 1000);
    const minute = Math.floor(unix / 60) * 60;
    let reads = byMinute.get(minute);
    if (!reads) {
      const { block, raw } = await blockAt(minute, latest.result);
      const blockPath = `raw/ethereum/blocks/${Number.parseInt(block.number, 16)}.json`;
      bundle.write(blockPath, raw);
      const fees = await ethCall<unknown>("eth_feeHistory", ["0x1", block.number, [50]]);
      const feePath = `raw/ethereum/fee-history/${Number.parseInt(block.number, 16)}.json`;
      bundle.write(feePath, fees.raw);
      const eth = await fetchUpdateAt(minute, [ETH_USD_FEED], hermes);
      const ethPath = `raw/hermes/eth-usd-${minute}.json`;
      bundle.write(ethPath, eth.raw);
      reads = { block: blockPath, feeHistory: feePath, ethUsd: ethPath };
      byMinute.set(minute, reads);
    }
    indexed.push({
      slice: point.slice,
      at: point.at,
      sliceUsdc: point.sliceUsdc.toString(),
      ...reads,
    });
  }
  const index: ChainIndex = {
    rpcUrl: ETHEREUM_RPC_URL,
    token: { symbol: "NVDAx", ethereum: NVDAX_ETHEREUM },
    logs: logsPath,
    receipts,
    points: indexed,
  };
  return bundle.write(CHAIN_INDEX, toJson(index));
}

export function chainIndexRef(manifest: CaseManifest): ArtifactRef | null {
  return manifest.artifacts.find((a) => a.path === CHAIN_INDEX) ?? null;
}

type Receipt = { result: { gasUsed: string; logs: { topics: string[] }[] } };
type FeeHistory = { result: { baseFeePerGas: string[]; reward: string[][] } };

/** Gas cost per point from the stored reads: median swap gas x (base fee + p50 tip) x ETH/USD. */
export function chainCosts(dir: string, artifacts: readonly ArtifactRef[], index: ChainIndex) {
  const ref = (path: string): ArtifactRef => {
    const found = artifacts.find((a) => a.path === path);
    if (!found) throw new Error(`${path} is not in the P7 manifest`);
    return found;
  };
  const swapGas: number[] = [];
  const movingGas: number[] = [];
  for (const path of index.receipts) {
    const receipt = readArtifactJson<Receipt>(dir, ref(path));
    const gas = Number.parseInt(receipt.result.gasUsed, 16);
    movingGas.push(gas);
    if (receipt.result.logs.some((l) => SWAP_TOPICS.has(l.topics[0] ?? ""))) swapGas.push(gas);
  }
  // Recent NVDAx trades on Ethereum go through aggregator and bridge contracts whose events are
  // not the standard AMM swap events. With fewer than three recognised swaps, the gas basis is
  // every recent transaction that moved NVDAx on Ethereum, and the result says so.
  const bySwaps = swapGas.length >= MIN_SWAP_RECEIPTS;
  const gasUnits = median(bySwaps ? swapGas : movingGas);
  const gasBasis = bySwaps
    ? `median gasUsed of ${swapGas.length} NVDAx swap receipts (Uniswap, Balancer or Curve swap events)`
    : `median gasUsed of all ${movingGas.length} recent transactions that moved NVDAx on Ethereum (${swapGas.length} carried a standard AMM swap event)`;
  const points = index.points.map((point) => {
    const fees = readArtifactJson<FeeHistory>(dir, ref(point.feeHistory));
    const base = BigInt(fees.result.baseFeePerGas[0] ?? "0x0");
    const tip = BigInt(fees.result.reward[0]?.[0] ?? "0x0");
    const eth = hermesPriceE9(readArtifactJson(dir, ref(point.ethUsd)), ETH_USD_FEED);
    if (gasUnits === null || !eth) {
      return {
        slice: point.slice,
        at: point.at,
        costUsdMicros: null,
        per20Bps: null,
        perSliceBps: null,
      };
    }
    const weiPerGas = base + tip;
    const costUsdMicros =
      (BigInt(Math.round(gasUnits)) * weiPerGas * eth.priceE9) / 1_000_000_000_000_000_000_000n;
    const sliceMicros = BigInt(point.sliceUsdc);
    return {
      slice: point.slice,
      at: point.at,
      gasPriceWei: weiPerGas.toString(),
      ethUsdE9: eth.priceE9.toString(),
      costUsdMicros: costUsdMicros.toString(),
      per20Bps: Number((costUsdMicros * 10_000n) / 20_000_000n),
      perSliceBps: sliceMicros > 0n ? Number((costUsdMicros * 10_000n) / sliceMicros) : null,
    };
  });
  const per20 = points.flatMap((p) => (p.per20Bps === null ? [] : [p.per20Bps]));
  return {
    rpcUrl: index.rpcUrl,
    token: index.token,
    swapReceipts: swapGas.length,
    gasBasis,
    receiptsRead: index.receipts.length,
    gasUnitsMedian: gasUnits,
    medianPer20Bps: median(per20),
    medianPer20Usd: median(per20) === null ? null : ((median(per20) as number) * 20) / 10_000,
    points,
  };
}
