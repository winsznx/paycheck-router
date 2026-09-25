import { ED25519_PROGRAM_ID } from "@paycheck-router/shared";
import {
  type Address,
  getAddressEncoder,
  type Instruction,
  type KeyPairSigner,
  signBytes,
} from "@solana/kit";
import { z } from "zod";
import { getMarkAttestationEncoder, type MarkAttestation } from "./generated/index.ts";
import type { FetchLike } from "./json-rpc.ts";

export const PRESTOCKS_API_URL = "https://prestocks.com/api/prestocks";

/** `MarkAttestation.source` for marks read from the PreStocks public API. */
export const ATTESTATION_SOURCE_PRESTOCKS_API = 0;

/** A mark that moved more than this since the last read needs a confirming read. */
export const MARK_JUMP_LIMIT_BPS = 2_000n;
/** The confirming read must come at least this long after the jump was seen. */
export const MARK_CONFIRM_DELAY_SECS = 60;

export const PreStocksEntry = z.object({
  name: z.string(),
  symbol: z.string(),
  contract_address: z.string().min(32).max(44),
  markPrice: z.number().positive().finite(),
  tokenPrice: z.number().positive().finite(),
  impliedValuation: z.number().positive().finite(),
  supply: z.number().nonnegative().finite(),
});
export type PreStocksEntry = z.infer<typeof PreStocksEntry>;

export const PreStocksResponse = z.array(PreStocksEntry).min(1);

export type PreStocksRead = {
  entries: PreStocksEntry[];
  raw: string;
  /** Unix seconds when the response arrived. */
  observedAt: number;
};

export async function fetchPreStocks(
  options: { url?: string; fetch?: FetchLike; now?: () => number } = {},
): Promise<PreStocksRead> {
  const res = await (options.fetch ?? fetch)(options.url ?? PRESTOCKS_API_URL);
  const raw = await res.text();
  if (!res.ok) throw new Error(`PreStocks API ${res.status}: ${raw.slice(0, 300)}`);
  const observedAt = Math.floor((options.now ?? Date.now)() / 1000);
  return { entries: PreStocksResponse.parse(JSON.parse(raw)), raw, observedAt };
}

/**
 * Converts a JSON number to 1e9 fixed point from its shortest decimal form, flooring past the
 * ninth decimal, so 156.00443091 becomes exactly 156004430910.
 */
export function decimalToE9(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`invalid decimal ${value}`);
  const [mantissa = "0", exponentPart] = value.toString().toLowerCase().split("e");
  const exponent = exponentPart ? Number(exponentPart) : 0;
  const [whole = "0", fraction = ""] = mantissa.split(".");
  const digits = BigInt(whole + fraction);
  const scale = 9 + exponent - fraction.length;
  return scale >= 0 ? digits * 10n ** BigInt(scale) : digits / 10n ** BigInt(-scale);
}

export type MarkObservation = { markPriceE9: bigint; observedAt: number };

export type MarkDecision =
  | { accept: true; mark: MarkObservation }
  | { accept: false; reason: "jump_unconfirmed"; pending: MarkObservation };

/**
 * The 20% rule: a mark that moved more than 20% since the last accepted read is held until a
 * second read at least 60 s later agrees with it.
 */
export function decideMark(
  current: MarkObservation,
  lastAccepted: MarkObservation | null,
  pendingJump: MarkObservation | null,
): MarkDecision {
  if (!lastAccepted) return { accept: true, mark: current };
  const delta =
    current.markPriceE9 > lastAccepted.markPriceE9
      ? current.markPriceE9 - lastAccepted.markPriceE9
      : lastAccepted.markPriceE9 - current.markPriceE9;
  if (delta * 10_000n <= lastAccepted.markPriceE9 * MARK_JUMP_LIMIT_BPS) {
    return { accept: true, mark: current };
  }
  const confirmed =
    pendingJump !== null &&
    current.observedAt - pendingJump.observedAt >= MARK_CONFIRM_DELAY_SECS &&
    current.markPriceE9 === pendingJump.markPriceE9;
  if (confirmed) return { accept: true, mark: current };
  return {
    accept: false,
    reason: "jump_unconfirmed",
    pending: pendingJump && pendingJump.markPriceE9 === current.markPriceE9 ? pendingJump : current,
  };
}

export const MARK_ATTESTATION_LEN = 32 + 8 + 8 + 1;

/** Borsh `MarkAttestation { mint, mark_price_e9: u64, observed_at: i64, source: u8 }`. */
export function encodeMarkAttestation(attestation: MarkAttestation): Uint8Array {
  return Uint8Array.from(getMarkAttestationEncoder().encode(attestation));
}

export type SignedAttestation = {
  attestation: MarkAttestation;
  message: Uint8Array;
  signature: Uint8Array;
  attester: Address;
};

export async function signMarkAttestation(
  attestation: MarkAttestation,
  attester: KeyPairSigner,
): Promise<SignedAttestation> {
  const message = encodeMarkAttestation(attestation);
  const signature = await signBytes(attester.keyPair.privateKey, message);
  return { attestation, message, signature, attester: attester.address };
}

const ED25519_HEADER_LEN = 16;
const ED25519_PUBKEY_LEN = 32;
const ED25519_SIGNATURE_LEN = 64;
const CURRENT_INSTRUCTION = 0xffff;

/**
 * An Ed25519 sigverify instruction carrying one signature, with every offset inside itself.
 * The execute transaction places it immediately before `execute_prestock_leg`.
 */
export function ed25519VerifyInstruction(signed: SignedAttestation): Instruction {
  const pubkeyOffset = ED25519_HEADER_LEN;
  const signatureOffset = pubkeyOffset + ED25519_PUBKEY_LEN;
  const messageOffset = signatureOffset + ED25519_SIGNATURE_LEN;
  const data = new Uint8Array(messageOffset + signed.message.length);
  const view = new DataView(data.buffer);
  data[0] = 1;
  data[1] = 0;
  view.setUint16(2, signatureOffset, true);
  view.setUint16(4, CURRENT_INSTRUCTION, true);
  view.setUint16(6, pubkeyOffset, true);
  view.setUint16(8, CURRENT_INSTRUCTION, true);
  view.setUint16(10, messageOffset, true);
  view.setUint16(12, signed.message.length, true);
  view.setUint16(14, CURRENT_INSTRUCTION, true);
  data.set(getAddressEncoder().encode(signed.attester), pubkeyOffset);
  data.set(signed.signature, signatureOffset);
  data.set(signed.message, messageOffset);
  return { programAddress: ED25519_PROGRAM_ID, accounts: [], data };
}

/** Reads one mint's mark from a PreStocks response and signs it. */
export async function attestMark(
  read: PreStocksRead,
  mint: Address,
  attester: KeyPairSigner,
): Promise<{ signed: SignedAttestation; entry: PreStocksEntry }> {
  const entry = read.entries.find((e) => e.contract_address === mint);
  if (!entry) throw new Error(`PreStocks API has no entry for ${mint}`);
  const signed = await signMarkAttestation(
    {
      mint,
      markPriceE9: decimalToE9(entry.markPrice),
      observedAt: BigInt(read.observedAt),
      source: ATTESTATION_SOURCE_PRESTOCKS_API,
    },
    attester,
  );
  return { signed, entry };
}
