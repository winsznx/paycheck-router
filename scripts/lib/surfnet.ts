import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Address,
  address,
  createKeyPairSignerFromBytes,
  type KeyPairSigner,
} from "@solana/kit";

export const SURFNET_RPC_URL = process.env.SURFNET_RPC_URL ?? "http://127.0.0.1:8899";

let requestId = 0;

export async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(SURFNET_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
  if (body.error) {
    throw new Error(`${method} failed: ${body.error.code} ${body.error.message}`);
  }
  return body.result as T;
}

export async function setLamports(owner: Address, lamports: bigint): Promise<void> {
  await rpc("surfnet_setAccount", [owner, { lamports: Number(lamports) }]);
}

export async function setTokenBalance(
  owner: Address,
  mint: Address,
  amount: bigint,
  tokenProgram?: Address,
): Promise<void> {
  const params: unknown[] = [owner, mint, { amount: Number(amount), state: "initialized" }];
  if (tokenProgram) params.push(tokenProgram);
  await rpc("surfnet_setTokenAccount", params);
}

const KEYS_DIR =
  process.env.PAYCHECK_ROUTER_KEYS_DIR ??
  resolve(import.meta.dirname, "..", "..", "internal", "keys");

export async function loadKey(name: string): Promise<KeyPairSigner> {
  const path = resolve(KEYS_DIR, `${name}.json`);
  const bytes = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]);
  return createKeyPairSignerFromBytes(bytes);
}

export const MINTS = {
  USDC: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  NVDAx: address("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"),
} as const;

export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
