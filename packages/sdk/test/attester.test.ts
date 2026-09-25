import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ED25519_PROGRAM_ID } from "@paycheck-router/shared";
import {
  address,
  generateKeyPairSigner,
  getAddressDecoder,
  getPublicKeyFromAddress,
  signatureBytes,
  verifySignature,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  attestMark,
  decideMark,
  decimalToE9,
  ed25519VerifyInstruction,
  encodeMarkAttestation,
  fetchPreStocks,
  MARK_ATTESTATION_LEN,
  signMarkAttestation,
} from "../src/attester.ts";

const recorded = readFileSync(resolve(import.meta.dirname, "fixtures", "prestocks.json"), "utf8");
const OPENAI = address("PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF");

function stubFetch(body: string, status = 200): typeof fetch {
  return async () => new Response(body, { status });
}

describe("decimalToE9", () => {
  it("converts JSON marks exactly from their decimal form", () => {
    expect(decimalToE9(156.00443091)).toBe(156_004_430_910n);
    expect(decimalToE9(1052.49946863)).toBe(1_052_499_468_630n);
    expect(decimalToE9(1)).toBe(1_000_000_000n);
    expect(decimalToE9(1e-7)).toBe(100n);
  });

  it("floors digits past the ninth decimal", () => {
    expect(decimalToE9(0.1234567891)).toBe(123_456_789n);
  });

  it("rejects negative and non-finite marks", () => {
    expect(() => decimalToE9(-1)).toThrow(RangeError);
    expect(() => decimalToE9(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("decideMark", () => {
  const base = { markPriceE9: 1_000_000_000_000n, observedAt: 1_000 };

  it("accepts the first read and moves within 20%", () => {
    expect(decideMark(base, null, null).accept).toBe(true);
    const moved = { markPriceE9: 1_200_000_000_000n, observedAt: 1_010 };
    expect(decideMark(moved, base, null).accept).toBe(true);
  });

  it("holds a jump over 20% until a read 60 s later agrees", () => {
    const jump = { markPriceE9: 1_300_000_000_000n, observedAt: 1_010 };
    const first = decideMark(jump, base, null);
    expect(first.accept).toBe(false);
    const pending = first.accept ? null : first.pending;
    const tooSoon = decideMark({ ...jump, observedAt: 1_050 }, base, pending);
    expect(tooSoon.accept).toBe(false);
    const confirmed = decideMark({ ...jump, observedAt: 1_070 }, base, pending);
    expect(confirmed.accept).toBe(true);
  });

  it("restarts the wait when the confirming read disagrees", () => {
    const jump = { markPriceE9: 1_300_000_000_000n, observedAt: 1_010 };
    const other = { markPriceE9: 1_310_000_000_000n, observedAt: 1_080 };
    const decision = decideMark(other, base, jump);
    expect(decision.accept).toBe(false);
    expect(decision.accept ? null : decision.pending).toEqual(other);
  });
});

describe("MarkAttestation encoding", () => {
  it("lays out mint, u64 mark, i64 time and u8 source in 49 bytes", () => {
    const bytes = encodeMarkAttestation({
      mint: OPENAI,
      markPriceE9: 0x0102030405060708n,
      observedAt: -2n,
      source: 7,
    });
    expect(bytes).toHaveLength(MARK_ATTESTATION_LEN);
    expect(getAddressDecoder().decode(bytes.slice(0, 32))).toBe(OPENAI);
    expect([...bytes.slice(32, 40)]).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect([...bytes.slice(40, 48)]).toEqual([0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(bytes[48]).toBe(7);
  });
});

describe("ed25519VerifyInstruction", () => {
  it("carries one signature the attester's key verifies, with offsets inside itself", async () => {
    const attester = await generateKeyPairSigner();
    const signed = await signMarkAttestation(
      { mint: OPENAI, markPriceE9: 1_023_610_000_000n, observedAt: 1_790_000_000n, source: 0 },
      attester,
    );
    const ix = ed25519VerifyInstruction(signed);
    expect(ix.programAddress).toBe(ED25519_PROGRAM_ID);
    const data = ix.data ?? new Uint8Array();
    const view = new DataView(data.buffer, data.byteOffset);
    expect(data[0]).toBe(1);
    const signatureOffset = view.getUint16(2, true);
    const pubkeyOffset = view.getUint16(6, true);
    const messageOffset = view.getUint16(10, true);
    const messageSize = view.getUint16(12, true);
    for (const at of [4, 8, 14]) expect(view.getUint16(at, true)).toBe(0xffff);
    expect(getAddressDecoder().decode(data.slice(pubkeyOffset, pubkeyOffset + 32))).toBe(
      attester.address,
    );
    const message = data.slice(messageOffset, messageOffset + messageSize);
    const signature = data.slice(signatureOffset, signatureOffset + 64);
    const key = await getPublicKeyFromAddress(attester.address);
    expect(await verifySignature(key, signatureBytes(signature), message)).toBe(true);
  });
});

describe("fetchPreStocks", () => {
  it("parses the recorded API response", async () => {
    const read = await fetchPreStocks({ fetch: stubFetch(recorded), now: () => 1_790_000_000_500 });
    expect(read.entries.length).toBeGreaterThanOrEqual(8);
    expect(read.observedAt).toBe(1_790_000_000);
    expect(read.entries.some((e) => e.contract_address === OPENAI)).toBe(true);
  });

  it("rejects a response with no valid entry", async () => {
    const broken = JSON.stringify([{ name: "x", symbol: "X", contract_address: OPENAI }]);
    await expect(fetchPreStocks({ fetch: stubFetch(broken) })).rejects.toThrow(/no valid entries/);
  });

  it("keeps every valid entry when one entry is malformed", async () => {
    const entries = JSON.parse(recorded) as Record<string, unknown>[];
    const bad = entries.find((e) => e.contract_address !== OPENAI);
    if (!bad) throw new Error("fixture needs a second entry");
    bad.markPrice = "not-a-number";
    const read = await fetchPreStocks({ fetch: stubFetch(JSON.stringify(entries)) });
    expect(read.entries.length).toBe(entries.length - 1);
    expect(read.rejected).toHaveLength(1);
    expect(read.rejected[0]?.contractAddress).toBe(bad.contract_address);
    const attester = await generateKeyPairSigner();
    await expect(attestMark(read, OPENAI, attester)).resolves.toBeDefined();
    await expect(attestMark(read, address(String(bad.contract_address)), attester)).rejects.toThrow(
      /failed validation/,
    );
  });

  it("surfaces HTTP errors", async () => {
    await expect(fetchPreStocks({ fetch: stubFetch("down", 503) })).rejects.toThrow(/503/);
  });

  it("signs the mark of the requested mint", async () => {
    const attester = await generateKeyPairSigner();
    const read = await fetchPreStocks({ fetch: stubFetch(recorded), now: () => 1_790_000_000_000 });
    const { signed, entry } = await attestMark(read, OPENAI, attester);
    expect(signed.attestation.markPriceE9).toBe(decimalToE9(entry.markPrice));
    expect(signed.attestation.observedAt).toBe(1_790_000_000n);
    await expect(
      attestMark(read, address("11111111111111111111111111111111"), attester),
    ).rejects.toThrow(/no entry/);
  });
});
