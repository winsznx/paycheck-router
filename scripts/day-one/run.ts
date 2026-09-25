import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Address,
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Instruction,
  type KeyPairSigner,
  pipe,
  type Signature,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import { findAssociatedTokenPda } from "@solana-program/token-2022";
import { buildSwap, FORK_EXCLUDED_DEXES, toInstruction, toLookupTables } from "../lib/jupiter.ts";
import {
  loadKey,
  MINTS,
  rpc,
  SURFNET_RPC_URL,
  setLamports,
  setTokenBalance,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "../lib/surfnet.ts";
import { runCpiProbe } from "./cpi-probe.ts";

type CheckResult = {
  name: string;
  pass: boolean;
  detail: Record<string, unknown>;
};

const solana = createSolanaRpc(SURFNET_RPC_URL);

export async function tokenBalance(account: Address): Promise<bigint> {
  const res = await rpc<{ value: { amount: string } } | null>("getTokenAccountBalance", [
    account,
  ]).catch(() => null);
  return res ? BigInt(res.value.amount) : 0n;
}

export async function sendAndConfirm(
  feePayer: KeyPairSigner,
  instructions: Instruction[],
  lookupTables: Record<Address, Address[]>,
): Promise<{ signature: Signature; err: unknown }> {
  const { value: blockhash } = await solana.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) => compressTransactionMessageUsingAddressLookupTables(m, lookupTables),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  await solana
    .sendTransaction(getBase64EncodedWireTransaction(signed), {
      encoding: "base64",
      skipPreflight: true,
    })
    .send();
  for (let i = 0; i < 60; i++) {
    const { value } = await solana.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return { signature, err: status.err };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`transaction ${signature} not confirmed within 30 s`);
}

async function checkClock(): Promise<CheckResult> {
  const samples: { slot: number; blockTime: number; wall: number; driftSecs: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const slot = await rpc<number>("getSlot", [{ commitment: "confirmed" }]);
    const blockTime = await rpc<number>("getBlockTime", [slot]);
    const clock = await rpc<{ unixTimestamp?: number; unix_timestamp?: number } | null>(
      "surfnet_getClock",
      [],
    ).catch(() => null);
    const wall = Date.now() / 1000;
    const onchain = clock?.unixTimestamp ?? clock?.unix_timestamp ?? blockTime;
    samples.push({ slot, blockTime: onchain, wall, driftSecs: onchain - wall });
    if (i < 6) await new Promise((r) => setTimeout(r, 5_000));
  }
  const maxDrift = Math.max(...samples.map((s) => Math.abs(s.driftSecs)));
  return {
    name: "surfnet clock within 5 s of wall time over 30 s",
    pass: maxDrift <= 5,
    detail: { maxDriftSecs: maxDrift, samples },
  };
}

async function checkJupiterOnFork(): Promise<{ result: CheckResult; signature?: Signature }> {
  const worker = await loadKey("demo-worker");
  await setLamports(worker.address, 2_000_000_000n);
  await setTokenBalance(worker.address, MINTS.USDC, 100_000_000n, TOKEN_PROGRAM);
  const [usdcAta] = await findAssociatedTokenPda({
    owner: worker.address,
    mint: MINTS.USDC,
    tokenProgram: TOKEN_PROGRAM,
  });
  const [nvdaAta] = await findAssociatedTokenPda({
    owner: worker.address,
    mint: MINTS.NVDAx,
    tokenProgram: TOKEN_2022_PROGRAM,
  });
  const usdcBefore = await tokenBalance(usdcAta);
  const nvdaBefore = await tokenBalance(nvdaAta);
  const amount = 10_000_000n;
  const build = await buildSwap({
    inputMint: MINTS.USDC,
    outputMint: MINTS.NVDAx,
    amount,
    taker: worker.address,
    slippageBps: 100,
    excludeDexes: FORK_EXCLUDED_DEXES,
  });
  const instructions: Instruction[] = [
    getSetComputeUnitLimitInstruction({ units: 1_400_000 }),
    ...build.setupInstructions.map(toInstruction),
    toInstruction(build.swapInstruction),
    ...(build.cleanupInstruction ? [toInstruction(build.cleanupInstruction)] : []),
  ];
  const { signature, err } = await sendAndConfirm(
    worker,
    instructions,
    toLookupTables(build.addressesByLookupTableAddress),
  );
  const usdcAfter = await tokenBalance(usdcAta);
  const nvdaAfter = await tokenBalance(nvdaAta);
  const received = nvdaAfter - nvdaBefore;
  return {
    signature,
    result: {
      name: "Jupiter /swap/v2/build route executes on the fork",
      pass:
        err === null &&
        usdcBefore - usdcAfter === amount &&
        received >= BigInt(build.otherAmountThreshold),
      detail: {
        signature,
        err,
        route: build.routePlan.map((s) => `${s.swapInfo.label} ${s.percent}%`),
        quotedOut: build.outAmount,
        minOut: build.otherAmountThreshold,
        received: received.toString(),
        usdcSpent: (usdcBefore - usdcAfter).toString(),
      },
    },
  };
}

async function checkSignatures(signature: Signature | undefined): Promise<CheckResult> {
  const worker = await loadKey("demo-worker");
  const [usdcAta] = await findAssociatedTokenPda({
    owner: worker.address,
    mint: MINTS.USDC,
    tokenProgram: TOKEN_PROGRAM,
  });
  const signatures = await rpc<{ signature: string; slot: number }[]>("getSignaturesForAddress", [
    usdcAta,
    { limit: 10, commitment: "confirmed" },
  ]);
  const listed = signatures.some((s) => s.signature === signature);
  const tx = signature
    ? await rpc<{ slot: number; meta: { err: unknown } } | null>("getTransaction", [
        signature,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
      ])
    : null;
  return {
    name: "getSignaturesForAddress and getTransaction return fork-local transactions",
    pass: listed && tx !== null,
    detail: {
      account: usdcAta,
      signaturesReturned: signatures.length,
      forkSwapListed: listed,
      getTransactionSlot: tx?.slot ?? null,
    },
  };
}

async function main() {
  const startSlot = await rpc<number>("getSlot");
  const results: CheckResult[] = [];
  results.push(await checkClock());
  const jupiter = await checkJupiterOnFork();
  results.push(jupiter.result);
  results.push(await checkSignatures(jupiter.signature));
  if (process.argv.includes("--cpi")) {
    results.push(await runCpiProbe());
  }
  const report = {
    ranAt: new Date().toISOString(),
    environment: "fork",
    surfnetRpc: SURFNET_RPC_URL,
    forkStartSlot: startSlot,
    results,
  };
  const dir = resolve(import.meta.dirname, "..", "..", "evidence", "day-one");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${report.ranAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    file,
    `${JSON.stringify(report, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`,
  );
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  }
  console.log(`report: ${file}`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
}

if (import.meta.main ?? process.argv[1]?.endsWith("run.ts")) {
  await main();
}
