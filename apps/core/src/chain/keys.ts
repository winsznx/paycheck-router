import { createKeyPairSignerFromBytes, getBase58Encoder, type KeyPairSigner } from "@solana/kit";
import type { Env } from "../env.ts";

export type HotKey = "CRANK_KEY" | "RECORDER_KEY" | "SPONSOR_KEY" | "ATTESTER_KEY" | "EMPLOYER_KEY";

/** Accepts a 64-byte secret key as a JSON byte array or as base58. */
export function secretKeyBytes(raw: string): Uint8Array {
  const trimmed = raw.trim();
  const bytes = trimmed.startsWith("[")
    ? Uint8Array.from(JSON.parse(trimmed) as number[])
    : new Uint8Array(getBase58Encoder().encode(trimmed));
  if (bytes.length !== 64) throw new Error(`secret key must be 64 bytes, got ${bytes.length}`);
  return bytes;
}

const signers = new Map<string, Promise<KeyPairSigner>>();

/** WebCrypto Ed25519 signer for a hot key held as a Workers secret. */
export function hotSigner(env: Env, key: HotKey): Promise<KeyPairSigner> {
  const raw = env[key];
  if (!raw) throw new Error(`${key} is not set`);
  let signer = signers.get(raw);
  if (!signer) {
    signer = createKeyPairSignerFromBytes(secretKeyBytes(raw));
    signers.set(raw, signer);
  }
  return signer;
}
