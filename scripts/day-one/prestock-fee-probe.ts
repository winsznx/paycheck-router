import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FORK_EXCLUDED_DEXES } from "@paycheck-router/shared";
import {
  AccountRole,
  type Address,
  address,
  generateKeyPairSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU32Encoder,
  type Instruction,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token-2022";
import { sendAndConfirm, tokenBalance } from "../day-one/run.ts";
import { buildSwap, toInstruction, toLookupTables } from "../lib/jupiter.ts";
import {
  loadKey,
  MINTS,
  rpc,
  setLamports,
  setTokenBalance,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "../lib/surfnet.ts";

const PROBE = address("54dbPLMwUVWP4fGock1iznSChCecnzmpQ3uNmcskztyi");
const MINT = address(process.argv[2] ?? "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF");
const disc = (n: string) => createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
const crank = await loadKey("crank");
const worker = await loadKey("demo-worker");
const router = (await generateKeyPairSigner()).address;
const [authority] = await getProgramDerivedAddress({
  programAddress: PROBE,
  seeds: ["authority", getAddressEncoder().encode(router)],
});
await setLamports(crank.address, 5_000_000_000n);
const amount = 100_000_000n;
await setTokenBalance(authority, MINTS.USDC, amount, TOKEN_PROGRAM);
const [dest] = await findAssociatedTokenPda({
  owner: worker.address,
  mint: MINT,
  tokenProgram: TOKEN_2022_PROGRAM,
});
const [authOut] = await findAssociatedTokenPda({
  owner: authority,
  mint: MINT,
  tokenProgram: TOKEN_2022_PROGRAM,
});
const b = await buildSwap({
  inputMint: MINTS.USDC,
  outputMint: MINT,
  amount,
  taker: authority,
  payer: crank.address,
  destinationTokenAccount: dest,
  slippageBps: 1000,
  maxAccounts: 40,
  excludeDexes: FORK_EXCLUDED_DEXES,
});
const s = b.swapInstruction;
const data = Buffer.from(s.data, "base64");
const ix: Instruction = {
  programAddress: PROBE,
  accounts: [
    { address: address(s.programId), role: AccountRole.READONLY },
    ...s.accounts.map((a) => ({
      address: address(a.pubkey),
      role:
        a.pubkey === authority
          ? a.isWritable
            ? AccountRole.WRITABLE
            : AccountRole.READONLY
          : a.isSigner && a.isWritable
            ? AccountRole.WRITABLE_SIGNER
            : a.isSigner
              ? AccountRole.READONLY_SIGNER
              : a.isWritable
                ? AccountRole.WRITABLE
                : AccountRole.READONLY,
    })),
  ],
  data: new Uint8Array([
    ...disc("swap_as_pda"),
    ...getAddressEncoder().encode(router),
    ...getU32Encoder().encode(data.length),
    ...data,
  ]),
};
const before = await tokenBalance(dest);
const { signature, err } = await sendAndConfirm(
  crank,
  [
    getSetComputeUnitLimitInstruction({ units: 1_400_000 }),
    getCreateAssociatedTokenIdempotentInstruction({
      payer: crank,
      ata: dest,
      owner: worker.address,
      mint: MINT,
      tokenProgram: TOKEN_2022_PROGRAM,
    }),
    ...b.setupInstructions.map(toInstruction),
    ix,
    ...(b.cleanupInstruction ? [toInstruction(b.cleanupInstruction)] : []),
  ],
  toLookupTables(b.addressesByLookupTableAddress) as Record<Address, Address[]>,
);
const received = (await tokenBalance(dest)) - before;
const tx = await rpc<{
  meta?: {
    postTokenBalances?: { mint: string; owner: string; uiTokenAmount: { amount: string } }[];
  };
} | null>("getTransaction", [
  signature,
  { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
]);
const post = (tx?.meta?.postTokenBalances ?? [])
  .filter((x) => x.mint === MINT)
  .map((x) => ({ owner: x.owner, amount: x.uiTokenAmount.amount }));
const report = {
  ranAt: new Date().toISOString(),
  environment: "fork",
  purpose:
    "Measure what a PreStocks buy delivers to the owner: gross output, Token-2022 transfer fee withheld, Scaled UI multiplier",
  mint: MINT,
  signature,
  err,
  route: b.routePlan.map((r) => `${r.swapInfo.label} ${r.percent}%`),
  usdcIn: amount.toString(),
  quotedOut: b.outAmount,
  minOut: b.otherAmountThreshold,
  received: received.toString(),
  authorityOutAta: authOut,
  postBalances: post,
};
const dir = resolve(import.meta.dirname, "..", "..", "evidence", "day-one");
mkdirSync(dir, { recursive: true });
writeFileSync(
  resolve(dir, `prestocks-fee-${report.ranAt.replace(/[:.]/g, "-")}.json`),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
