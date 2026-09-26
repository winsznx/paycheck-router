import { getAddressDecoder } from "@solana/kit";
import { chainEndpoints } from "../config.ts";
import type { Env } from "../env.ts";
import { ApiError } from "../http/problem.ts";

/** The fork answered with an error or not at all: it is resetting or down (503). */
export function forkUnavailable(detail: string): ApiError {
  return new ApiError(503, "upstream_unavailable", detail);
}

let requestId = 0;

/**
 * One JSON-RPC call to the surfnet (cheatcodes `@solana/kit` does not model), with the hosted
 * fork's access header. Transport failures and 5xx become `upstream_unavailable`.
 */
export async function surfnetRpc<T>(env: Env, method: string, params: unknown[]): Promise<T> {
  const endpoints = chainEndpoints(env);
  if (!endpoints.surfnet) throw new ApiError(404, "not_found", "Not a fork environment");
  let response: Response;
  try {
    response = await fetch(endpoints.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...endpoints.headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
    });
  } catch (error) {
    throw forkUnavailable(`The fork did not answer ${method}: ${String(error)}`);
  }
  if (!response.ok) throw forkUnavailable(`The fork answered ${method} with ${response.status}`);
  const body = (await response.json()) as { result?: T; error?: { code: number; message: string } };
  if (body.error) {
    throw new ApiError(502, "chain_error", `${method} failed: ${body.error.message}`);
  }
  return body.result as T;
}

/** Sets an account's lamports, leaving its data and owner as they are. */
export async function setLamports(env: Env, account: string, lamports: bigint): Promise<void> {
  await surfnetRpc(env, "surfnet_setAccount", [account, { lamports: Number(lamports) }]);
}

/** Sets the balance of `owner`'s associated token account, creating it when missing. */
export async function setTokenBalance(
  env: Env,
  owner: string,
  mint: string,
  amount: bigint,
  tokenProgram: string,
): Promise<void> {
  await surfnetRpc(env, "surfnet_setTokenAccount", [
    owner,
    mint,
    { amount: Number(amount), state: "initialized" },
    tokenProgram,
  ]);
}

/**
 * A fork's identity. A fresh fork (restored from the snapshot) has no marker, so core writes one;
 * a marker core did not write means the fork changed underneath it.
 */
export type ForkEpoch = { id: string; startedAt: number };

const MARKER_SEED = "paycheck-router:demo-fork-epoch:v1";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const MARKER_LAMPORTS = 1_000_000;
const ID_BYTES = 16;

/** A fixed address that holds nothing but the current fork epoch. */
export async function epochMarker(): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(MARKER_SEED));
  return getAddressDecoder().decode(new Uint8Array(digest));
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Marker data: a 16-byte random id, then the epoch's start as u64 little-endian unix ms. */
export function encodeEpoch(epoch: ForkEpoch): Uint8Array {
  const bytes = new Uint8Array(ID_BYTES + 8);
  for (let i = 0; i < ID_BYTES; i++) {
    bytes[i] = Number.parseInt(epoch.id.slice(i * 2, i * 2 + 2), 16);
  }
  new DataView(bytes.buffer).setBigUint64(ID_BYTES, BigInt(epoch.startedAt), true);
  return bytes;
}

export function decodeEpoch(bytes: Uint8Array): ForkEpoch | null {
  if (bytes.length !== ID_BYTES + 8) return null;
  return {
    id: hex(bytes.subarray(0, ID_BYTES)),
    startedAt: Number(new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(ID_BYTES, true)),
  };
}

/** The epoch written on this fork, or null on a fork nobody has marked (a fresh one). */
export async function readEpoch(env: Env): Promise<ForkEpoch | null> {
  const result = await surfnetRpc<{ value: { data: [string, string] } | null }>(
    env,
    "getAccountInfo",
    [await epochMarker(), { encoding: "base64", commitment: "confirmed" }],
  );
  if (!result.value) return null;
  return decodeEpoch(Uint8Array.from(atob(result.value.data[0]), (char) => char.charCodeAt(0)));
}

/** Marks this fork with a new epoch that started at `now`. */
export async function markEpoch(env: Env, now: number): Promise<ForkEpoch> {
  const epoch = { id: hex(crypto.getRandomValues(new Uint8Array(ID_BYTES))), startedAt: now };
  await surfnetRpc(env, "surfnet_setAccount", [
    await epochMarker(),
    { lamports: MARKER_LAMPORTS, data: hex(encodeEpoch(epoch)), owner: SYSTEM_PROGRAM },
  ]);
  return epoch;
}
