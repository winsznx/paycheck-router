/**
 * Building blocks for fork runs: a fresh surfnet, the program deployed under the production
 * program id with a fork-only authority, Config and the registry, funded fork-only keys, the demo
 * worker's router and a paycheck sent as an ordinary transfer. Shared by `pnpm demo:fork`,
 * `pnpm demo:record` and the fork suites.
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  bigintReplacer,
  buildMessage,
  buildSetupInstructions,
  createRpc,
  findAssetPda,
  findAuthorityPda,
  findConfigPda,
  findRouterPda,
  getInitializeConfigInstructionAsync,
  getUpsertAssetInstructionAsync,
  jsonRpc,
  latestLifetime,
  type SendOutcome,
  type SolanaRpc,
  SurfnetCheatcodes,
  signSendConfirm,
  WORMHOLE_PROGRAM_ID,
} from "@paycheck-router/sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ED25519_PROGRAM_ID,
  FORK_KEYS,
  type ForkKeyName,
  INSTRUCTIONS_SYSVAR_ID,
  JUPITER_PROGRAM_ID,
  LAUNCH_CONFIG,
  PROGRAM_ID,
  PYTH_RECEIVER_PROGRAM_ID,
  REGISTRY,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  USDC_DECIMALS,
  USDC_FEED_ID,
  USDC_MINT,
} from "@paycheck-router/shared";
import {
  type Address,
  type AddressesByLookupTableAddress,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import {
  findAddressLookupTablePda,
  getCreateLookupTableInstruction,
  getExtendLookupTableInstruction,
} from "@solana-program/address-lookup-table";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
} from "@solana-program/token";
import { KEYS_DIR, loadKey } from "./surfnet.ts";

const run = promisify(execFile);
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const BPF_LOADER_UPGRADEABLE = address("BPFLoaderUpgradeab1e11111111111111111111111");
const MAX_CLOCK_DRIFT_SECS = 5;
const CLOCK_SYSVAR = "SysvarC1ock11111111111111111111111111111111";
const SOL = 1_000_000_000n;

export type ForkSigners = Record<ForkKeyName, KeyPairSigner>;

export async function loadForkSigners(): Promise<ForkSigners> {
  const names = Object.keys(FORK_KEYS) as ForkKeyName[];
  const entries = await Promise.all(
    names.map(async (name) => [name, await loadKey(name)] as const),
  );
  const signers = Object.fromEntries(entries) as ForkSigners;
  for (const name of names) {
    if (signers[name].address !== FORK_KEYS[name]) {
      throw new Error(`${name} key ${signers[name].address} does not match ${FORK_KEYS[name]}`);
    }
  }
  return signers;
}

export type Surfnet = {
  rpcUrl: string;
  wsUrl: string;
  rpcPort: number;
  wsPort: number;
  /** Where the surfnet fetches mainnet accounts from, without any API key. */
  datasource: string;
  surfpoolVersion: string;
  startSlot: bigint;
  clockDriftSecs: number;
  rpc: SolanaRpc;
  cheat: SurfnetCheatcodes;
  stop: () => Promise<void>;
};

function portIsFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
  });
}

async function freePort(preferred: number, avoid: readonly number[] = []): Promise<number> {
  for (let port = preferred; port < preferred + 200; port++) {
    if (!avoid.includes(port) && (await portIsFree(port))) return port;
  }
  throw new Error(`no free port from ${preferred}`);
}

async function waitForRpc(rpc: SolanaRpc, child: ChildProcess, timeoutMs: number): Promise<bigint> {
  const started = Date.now();
  let lastError: unknown = null;
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`surfpool exited with ${child.exitCode}`);
    try {
      return await rpc.getSlot({ commitment: "confirmed" }).send();
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`surfnet did not answer within ${timeoutMs} ms: ${String(lastError)}`);
}

/** Seconds between the Clock sysvar the program reads and wall time. */
export async function clockDriftSecs(rpcUrl: string): Promise<number> {
  const { result } = await jsonRpc<{
    value: { data: { parsed: { info: { unixTimestamp: number } } } } | null;
  }>(rpcUrl, "getAccountInfo", [CLOCK_SYSVAR, { encoding: "jsonParsed", commitment: "confirmed" }]);
  if (!result.value) throw new Error("surfnet has no Clock sysvar");
  return result.value.data.parsed.info.unixTimestamp - Date.now() / 1000;
}

/**
 * Starts a fresh surfnet forked from mainnet (Helius as the data source when HELIUS_API_KEY is
 * set) and stops it again if its clock is more than 5 s from wall time.
 */
export async function startSurfnet(
  opts: { rpcPort?: number; wsPort?: number; logFile?: string } = {},
): Promise<Surfnet> {
  const rpcPort = opts.rpcPort ?? (await freePort(8899));
  const wsPort = opts.wsPort ?? (await freePort(rpcPort + 1, [rpcPort]));
  const helius = process.env.HELIUS_API_KEY;
  const source = helius
    ? ["--rpc-url", `https://mainnet.helius-rpc.com/?api-key=${helius}`]
    : ["--network", "mainnet"];
  const cwd = mkdtempSync(resolve(tmpdir(), "surfnet-"));
  const child = spawn(
    "surfpool",
    [
      "start",
      ...source,
      "--port",
      String(rpcPort),
      "--ws-port",
      String(wsPort),
      "--no-tui",
      "--no-studio",
      "--no-deploy",
      "--yes",
      "--airdrop-amount",
      "0",
    ],
    { cwd, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (opts.logFile) {
    const log = createWriteStream(opts.logFile);
    child.stdout?.pipe(log);
    child.stderr?.pipe(log);
  } else {
    child.stdout?.resume();
    child.stderr?.resume();
  }
  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGINT");
    await new Promise<void>((done) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        done();
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(timer);
        done();
      });
    });
  };
  const rpcUrl = `http://127.0.0.1:${rpcPort}`;
  const rpc = createRpc(rpcUrl);
  try {
    const startSlot = await waitForRpc(rpc, child, 90_000);
    const drift = await clockDriftSecs(rpcUrl);
    if (Math.abs(drift) > MAX_CLOCK_DRIFT_SECS) {
      throw new Error(`surfnet clock is ${drift.toFixed(1)} s from wall time`);
    }
    const { stdout } = await run("surfpool", ["--version"]);
    return {
      rpcUrl,
      wsUrl: `ws://127.0.0.1:${wsPort}`,
      rpcPort,
      wsPort,
      datasource: helius ? "helius mainnet" : "api.mainnet-beta.solana.com",
      surfpoolVersion: stdout.trim(),
      startSlot,
      clockDriftSecs: drift,
      rpc,
      cheat: new SurfnetCheatcodes(rpcUrl),
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** SOL for every fork-only key and 10,000 USDC for each employer, by cheatcode. */
export async function fundForkKeys(surfnet: Surfnet, signers: ForkSigners): Promise<void> {
  const sol: Partial<Record<ForkKeyName, bigint>> = {
    deployer: 20n * SOL,
    admin: 5n * SOL,
    crank: 10n * SOL,
    recorder: 1n * SOL,
    sponsor: 5n * SOL,
    ops: 1n * SOL,
    attester: 1n * SOL,
    guardian: 1n * SOL,
    "demo-worker": 1n * SOL,
    "employer-1": 1n * SOL,
    "employer-2": 1n * SOL,
    "employer-3": 1n * SOL,
  };
  for (const [name, lamports] of Object.entries(sol) as [ForkKeyName, bigint][]) {
    await surfnet.cheat.setAccount(signers[name].address, { lamports });
  }
  for (const name of ["employer-1", "employer-2", "employer-3"] as const) {
    await surfnet.cheat.setTokenAccount(
      signers[name].address,
      USDC_MINT,
      { amount: 10_000n * 10n ** BigInt(USDC_DECIMALS), state: "initialized" },
      TOKEN_PROGRAM_ID,
    );
  }
}

/** Keypair files the Solana CLI can read: it rejects paths with spaces. */
function cliKeysDir(): string {
  if (!KEYS_DIR.includes(" ")) return KEYS_DIR;
  const link = resolve(mkdtempSync(resolve(tmpdir(), "fork-keys-")), "keys");
  symlinkSync(KEYS_DIR, link);
  return link;
}

export type Deployment = { programId: Address; signature: string; sha256: string; soPath: string };

/**
 * Deploys the program binary to the surfnet under the production program id, with the fork-only
 * deployer as fee payer and upgrade authority.
 */
export async function deployProgram(
  surfnet: Surfnet,
  opts: { programSo?: string } = {},
): Promise<Deployment> {
  const soPath =
    opts.programSo ??
    process.env.PROGRAM_SO ??
    resolve(REPO_ROOT, "target", "deploy", "paycheck_router.so");
  if (!existsSync(soPath)) {
    throw new Error(`program binary not found at ${soPath}; build it or set PROGRAM_SO`);
  }
  const sha256 = createHash("sha256").update(readFileSync(soPath)).digest("hex");
  const keys = cliKeysDir();
  const { stdout } = await run(
    "solana",
    [
      "program",
      "deploy",
      "--url",
      surfnet.rpcUrl,
      "--keypair",
      resolve(keys, "deployer.json"),
      "--program-id",
      resolve(keys, "program-id.json"),
      "--upgrade-authority",
      resolve(keys, "deployer.json"),
      "--commitment",
      "confirmed",
      "--output",
      "json",
      soPath,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const result = JSON.parse(stdout) as { programId: string; signature?: string };
  if (result.programId !== PROGRAM_ID) {
    throw new Error(`deployed ${result.programId}, expected ${PROGRAM_ID}`);
  }
  return { programId: PROGRAM_ID, signature: result.signature ?? "", sha256, soPath };
}

async function send(
  surfnet: Surfnet,
  payer: KeyPairSigner,
  instructions: Instruction[],
  lookupTables: AddressesByLookupTableAddress = {},
): Promise<SendOutcome> {
  const outcome = await signSendConfirm(
    surfnet.rpc,
    buildMessage(payer, await latestLifetime(surfnet.rpc), instructions, lookupTables),
  );
  if (outcome.status !== "confirmed") {
    const { result } = await jsonRpc<{ meta: { logMessages: string[] | null } } | null>(
      surfnet.rpcUrl,
      "getTransaction",
      [outcome.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }],
    );
    const logs = result?.meta.logMessages?.slice(-6).join(" | ") ?? "no logs";
    throw new Error(
      `transaction ${outcome.signature} ${outcome.status}: ${JSON.stringify(outcome.err, bigintReplacer)}; ${logs}`,
    );
  }
  return outcome;
}

async function pythReceiverConfig(): Promise<Address> {
  const [config] = await getProgramDerivedAddress({
    programAddress: PYTH_RECEIVER_PROGRAM_ID,
    seeds: ["config"],
  });
  return config;
}

function feedBytes(feedId: string | null): Uint8Array {
  const bytes = new Uint8Array(32);
  if (feedId) bytes.set(Uint8Array.from(Buffer.from(feedId, "hex")));
  return bytes;
}

export type ProtocolSetup = {
  config: Address;
  treasury: Address;
  lookupTable: { address: Address; addresses: Address[] };
  signatures: { label: string; signature: string }[];
};

/**
 * Config with the launch values and fork-only roles, every registry asset, and the protocol
 * lookup table the execute transactions use.
 */
export async function initializeProtocol(
  surfnet: Surfnet,
  signers: ForkSigners,
): Promise<ProtocolSetup> {
  const signatures: ProtocolSetup["signatures"] = [];
  await surfnet.cheat.setTokenAccount(
    signers.admin.address,
    USDC_MINT,
    { amount: 0n, state: "initialized" },
    TOKEN_PROGRAM_ID,
  );
  const [treasury] = await findAssociatedTokenPda({
    owner: signers.admin.address,
    mint: USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  const [programData] = await getProgramDerivedAddress({
    programAddress: BPF_LOADER_UPGRADEABLE,
    seeds: [getAddressEncoder().encode(PROGRAM_ID)],
  });
  const init = await getInitializeConfigInstructionAsync({
    deployer: signers.deployer,
    programData,
    usdcMint: USDC_MINT,
    treasury,
    usdcTokenProgram: TOKEN_PROGRAM_ID,
    admin: signers.admin.address,
    feeBps: LAUNCH_CONFIG.feeBps,
    usdcFeedId: feedBytes(USDC_FEED_ID),
    jupiterProgram: JUPITER_PROGRAM_ID,
    attester: signers.attester.address,
    pauseAuthority: signers.guardian.address,
    maxPriceAgeSecs: LAUNCH_CONFIG.maxPriceAgeSecs,
    maxConfBps: LAUNCH_CONFIG.maxConfBps,
    maxLegUsdc: LAUNCH_CONFIG.maxLegUsdc,
  });
  signatures.push({
    label: "initialize_config",
    signature: (await send(surfnet, signers.deployer, [init])).signature,
  });

  for (const asset of REGISTRY) {
    const upsert = await getUpsertAssetInstructionAsync({
      admin: signers.admin,
      mint: asset.mint,
      tokenProgram: asset.tokenProgram,
      kind: asset.kind,
      issuer: asset.issuer,
      feedId: feedBytes(asset.feedId),
      feedId247: feedBytes(asset.feedId247),
      maxBandBps: asset.maxBandBps,
      band247ExtraBps: asset.band247ExtraBps,
    });
    signatures.push({
      label: `upsert_asset ${asset.symbol}`,
      signature: (await send(surfnet, signers.admin, [upsert])).signature,
    });
  }

  const [config] = await findConfigPda();
  const lookupTable = await createProtocolLookupTable(surfnet, signers.crank, [
    PROGRAM_ID,
    config,
    treasury,
    USDC_MINT,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    JUPITER_PROGRAM_ID,
    PYTH_RECEIVER_PROGRAM_ID,
    WORMHOLE_PROGRAM_ID,
    await pythReceiverConfig(),
    INSTRUCTIONS_SYSVAR_ID,
    ED25519_PROGRAM_ID,
    ...(await Promise.all(
      REGISTRY.map(async (asset) => (await findAssetPda({ mint: asset.mint }))[0]),
    )),
    ...REGISTRY.map((asset) => asset.mint),
  ]);
  signatures.push(...lookupTable.signatures);
  return {
    config,
    treasury,
    lookupTable: { address: lookupTable.address, addresses: lookupTable.addresses },
    signatures,
  };
}

async function createProtocolLookupTable(
  surfnet: Surfnet,
  authority: KeyPairSigner,
  entries: Address[],
): Promise<{ address: Address; addresses: Address[]; signatures: ProtocolSetup["signatures"] }> {
  const addresses = [...new Set(entries)];
  const recentSlot = await surfnet.rpc.getSlot({ commitment: "finalized" }).send();
  const pda = await findAddressLookupTablePda({ authority: authority.address, recentSlot });
  const [table] = pda;
  const signatures: ProtocolSetup["signatures"] = [];
  const create = getCreateLookupTableInstruction({
    address: pda,
    authority: authority.address,
    payer: authority,
    recentSlot,
  });
  signatures.push({
    label: "create protocol lookup table",
    signature: (await send(surfnet, authority, [create])).signature,
  });
  for (let i = 0; i < addresses.length; i += 20) {
    const extend = getExtendLookupTableInstruction({
      address: table,
      authority,
      payer: authority,
      addresses: addresses.slice(i, i + 20),
    });
    signatures.push({
      label: `extend protocol lookup table ${i / 20 + 1}`,
      signature: (await send(surfnet, authority, [extend])).signature,
    });
  }
  const warm = await surfnet.rpc.getSlot({ commitment: "confirmed" }).send();
  while ((await surfnet.rpc.getSlot({ commitment: "confirmed" }).send()) <= warm) {
    await new Promise((r) => setTimeout(r, 400));
  }
  return { address: table, addresses, signatures };
}

export type DemoRouter = {
  router: Address;
  authority: Address;
  payIn: Address;
  signature: string;
};

/**
 * The demo worker's router, created by the setup transaction (create_router plus the approves)
 * with the sponsor paying fees and rent.
 */
export async function createDemoRouter(
  surfnet: Surfnet,
  signers: ForkSigners,
  opts: {
    legs: { symbol: string; weightBps: number; bandBps: number }[];
    investBps: number;
    allowance: bigint;
    recorder?: Address;
  },
): Promise<DemoRouter> {
  const owner = signers["demo-worker"];
  const legs = opts.legs.map((leg) => {
    const asset = REGISTRY.find((a) => a.symbol === leg.symbol);
    if (!asset) throw new Error(`unknown asset ${leg.symbol}`);
    return { mint: asset.mint, weightBps: leg.weightBps, bandBps: leg.bandBps, enabled: true };
  });
  const instructions = await buildSetupInstructions({
    owner,
    payer: signers.sponsor,
    params: {
      recorder: opts.recorder ?? signers.recorder.address,
      investBps: opts.investBps,
      minInflow: 1_000_000n,
      dailyCap: 10_000_000_000n,
      maxWaitSecs: 7 * 24 * 3600,
      autoConvert: false,
      legs,
    },
    allowance: opts.allowance,
  });
  const outcome = await send(surfnet, signers.sponsor, instructions);
  const [router] = await findRouterPda({ owner: owner.address });
  const [authority] = await findAuthorityPda({ router });
  const [payIn] = await findAssociatedTokenPda({
    owner: owner.address,
    mint: USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  return { router, authority, payIn, signature: outcome.signature };
}

/** An ordinary SPL `transferChecked` of USDC from an employer to a worker. */
export async function sendPaycheck(
  surfnet: Surfnet,
  opts: { from: KeyPairSigner; to: Address; amount: bigint },
): Promise<{ signature: string; slot: bigint | null }> {
  const [source] = await findAssociatedTokenPda({
    owner: opts.from.address,
    mint: USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  const [destination] = await findAssociatedTokenPda({
    owner: opts.to,
    mint: USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
  });
  const outcome = await send(surfnet, opts.from, [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: opts.from,
      ata: destination,
      owner: opts.to,
      mint: USDC_MINT,
    }),
    getTransferCheckedInstruction({
      source,
      mint: USDC_MINT,
      destination,
      authority: opts.from,
      amount: opts.amount,
      decimals: USDC_DECIMALS,
    }),
  ]);
  return { signature: outcome.signature, slot: outcome.slot };
}
