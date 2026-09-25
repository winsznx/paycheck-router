import { createHash } from "node:crypto";
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
import { buildSwap, FORK_EXCLUDED_DEXES, toInstruction, toLookupTables } from "../lib/jupiter.ts";
import {
  loadKey,
  MINTS,
  setLamports,
  setTokenBalance,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "../lib/surfnet.ts";
import { sendAndConfirm, tokenBalance } from "./run.ts";

const PROBE_PROGRAM = address(
  process.env.CPI_PROBE_PROGRAM_ID ?? "54dbPLMwUVWP4fGock1iznSChCecnzmpQ3uNmcskztyi",
);

function anchorDiscriminator(name: string): Uint8Array {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

export async function runCpiProbe() {
  const crank = await loadKey("crank");
  const worker = await loadKey("demo-worker");
  const router = (await generateKeyPairSigner()).address;
  const [authority] = await getProgramDerivedAddress({
    programAddress: PROBE_PROGRAM,
    seeds: ["authority", getAddressEncoder().encode(router)],
  });

  await setLamports(crank.address, 5_000_000_000n);
  const amount = 10_000_000n;
  await setTokenBalance(authority, MINTS.USDC, amount, TOKEN_PROGRAM);
  const [authorityUsdc] = await findAssociatedTokenPda({
    owner: authority,
    mint: MINTS.USDC,
    tokenProgram: TOKEN_PROGRAM,
  });
  const [destination] = await findAssociatedTokenPda({
    owner: worker.address,
    mint: MINTS.NVDAx,
    tokenProgram: TOKEN_2022_PROGRAM,
  });

  const build = await buildSwap({
    inputMint: MINTS.USDC,
    outputMint: MINTS.NVDAx,
    amount,
    taker: authority,
    payer: crank.address,
    destinationTokenAccount: destination,
    slippageBps: 100,
    excludeDexes: FORK_EXCLUDED_DEXES,
    maxAccounts: 40,
  });

  const swap = build.swapInstruction;
  const data = Buffer.from(swap.data, "base64");
  const probeData = new Uint8Array([
    ...anchorDiscriminator("swap_as_pda"),
    ...getAddressEncoder().encode(router),
    ...getU32Encoder().encode(data.length),
    ...data,
  ]);
  const probeIx: Instruction = {
    programAddress: PROBE_PROGRAM,
    accounts: [
      { address: address(swap.programId), role: AccountRole.READONLY },
      ...swap.accounts.map((a) => ({
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
    data: probeData,
  };

  const destBefore = await tokenBalance(destination);
  const srcBefore = await tokenBalance(authorityUsdc);
  const { signature, err } = await sendAndConfirm(
    crank,
    [
      getSetComputeUnitLimitInstruction({ units: 1_400_000 }),
      getCreateAssociatedTokenIdempotentInstruction({
        payer: crank,
        ata: destination,
        owner: worker.address,
        mint: MINTS.NVDAx,
        tokenProgram: TOKEN_2022_PROGRAM,
      }),
      ...build.setupInstructions.map(toInstruction),
      probeIx,
      ...(build.cleanupInstruction ? [toInstruction(build.cleanupInstruction)] : []),
    ],
    toLookupTables(build.addressesByLookupTableAddress) as Record<Address, Address[]>,
  );
  const received = (await tokenBalance(destination)) - destBefore;
  const spent = srcBefore - (await tokenBalance(authorityUsdc));
  return {
    name: "Jupiter /swap/v2/build instruction runs inside CPI with the Authority PDA as taker",
    pass: err === null && spent === amount && received >= BigInt(build.otherAmountThreshold),
    detail: {
      signature,
      err,
      probeProgram: PROBE_PROGRAM,
      authorityPda: authority,
      swapAccounts: swap.accounts.length,
      setupInstructions: build.setupInstructions.map((ix) => ({
        program: ix.programId,
        accounts: ix.accounts.map((a) => a.pubkey),
      })),
      authorityUsdc,
      route: build.routePlan.map((s) => `${s.swapInfo.label} ${s.percent}%`),
      minOut: build.otherAmountThreshold,
      received: received.toString(),
      usdcSpent: spent.toString(),
    },
  };
}
