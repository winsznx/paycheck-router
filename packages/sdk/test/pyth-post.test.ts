import { PYTH_RECEIVER_PROGRAM_ID } from "@paycheck-router/shared";
import { generateKeyPairSigner, getBase64Decoder, getU32Decoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  guardianSetIndex,
  instructionDiscriminator,
  parseAccumulatorUpdate,
  parsePriceFeedMessage,
  planPythPosts,
  VAA_SPLIT_INDEX,
  WORMHOLE_PROGRAM_ID,
} from "../src/pyth-post.ts";
import type { SolanaRpc } from "../src/rpc.ts";

const FEED = "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593";

function priceMessage(): Uint8Array {
  const out = new Uint8Array(85);
  const view = new DataView(out.buffer);
  out[0] = 0;
  out.set(
    Uint8Array.from(FEED.match(/../g) ?? [], (h) => Number.parseInt(h, 16)),
    1,
  );
  view.setBigInt64(33, 18_012_345n);
  view.setBigUint64(41, 9_000n);
  view.setInt32(49, -5);
  view.setBigInt64(53, 1_790_000_000n);
  view.setBigInt64(61, 1_789_999_999n);
  view.setBigInt64(69, 18_000_000n);
  view.setBigUint64(77, 8_000n);
  return out;
}

/** A synthetic PNAU v1.0 update: header, a VAA signed by guardian set 4, one message, two proofs. */
function accumulator(vaaLength: number): Uint8Array {
  const vaa = new Uint8Array(vaaLength);
  new DataView(vaa.buffer).setUint32(1, 4);
  const message = priceMessage();
  const parts = [
    Uint8Array.of(0x50, 0x4e, 0x41, 0x55, 1, 0, 0, 0),
    Uint8Array.of(vaaLength >> 8, vaaLength & 0xff),
    vaa,
    Uint8Array.of(1, message.length >> 8, message.length & 0xff),
    message,
    Uint8Array.of(2),
    new Uint8Array(20).fill(7),
    new Uint8Array(20).fill(9),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const rpc = {
  getMinimumBalanceForRentExemption: () => ({ send: async () => 2_000_000n }),
} as unknown as SolanaRpc;

describe("accumulator parsing", () => {
  it("splits the VAA from the Merkle price updates", () => {
    const parsed = parseAccumulatorUpdate(accumulator(900));
    expect(parsed.vaa).toHaveLength(900);
    expect(guardianSetIndex(parsed.vaa)).toBe(4);
    expect(parsed.updates).toHaveLength(1);
    expect(parsed.updates[0]?.proof).toHaveLength(2);
  });

  it("reads the price feed message fields big-endian", () => {
    const message = parsePriceFeedMessage(priceMessage());
    expect(message).toMatchObject({
      feedId: FEED,
      price: 18_012_345n,
      conf: 9_000n,
      exponent: -5,
      publishTime: 1_790_000_000n,
    });
  });

  it("rejects anything that is not a v1.0 accumulator", () => {
    expect(() => parseAccumulatorUpdate(Uint8Array.of(1, 2, 3, 4, 5, 6))).toThrow();
    const trailing = new Uint8Array([...accumulator(100), 0]);
    expect(() => parseAccumulatorUpdate(trailing)).toThrow(/trailing/);
  });
});

describe("planPythPosts", () => {
  it("creates, writes in two parts, verifies, posts and plans the closes", async () => {
    const payer = await generateKeyPairSigner();
    const update = getBase64Decoder().decode(accumulator(900));
    const plan = await planPythPosts({ rpc, payer, updates: [update], treasuryId: 3 });
    const programs = plan.post.flatMap((g) => g.instructions.map((ix) => ix.programAddress));
    expect(programs).toEqual([
      "11111111111111111111111111111111",
      WORMHOLE_PROGRAM_ID,
      WORMHOLE_PROGRAM_ID,
      WORMHOLE_PROGRAM_ID,
      WORMHOLE_PROGRAM_ID,
      PYTH_RECEIVER_PROGRAM_ID,
    ]);
    const secondWrite = plan.post[2]?.instructions[0]?.data ?? new Uint8Array();
    expect([...secondWrite.slice(0, 8)]).toEqual([
      ...(await instructionDiscriminator("write_encoded_vaa")),
    ]);
    expect(getU32Decoder().decode(secondWrite.slice(8, 12))).toBe(VAA_SPLIT_INDEX);
    expect(getU32Decoder().decode(secondWrite.slice(12, 16))).toBe(900 - VAA_SPLIT_INDEX);
    const postData = plan.post[4]?.instructions[0]?.data ?? new Uint8Array();
    expect(postData.at(-1)).toBe(3);
    expect(plan.priceUpdateAccounts.has(FEED)).toBe(true);
    expect(plan.close.map((g) => g.instructions[0]?.programAddress)).toEqual([
      PYTH_RECEIVER_PROGRAM_ID,
      WORMHOLE_PROGRAM_ID,
    ]);
  });

  it("skips the second write when the VAA fits the first", async () => {
    const payer = await generateKeyPairSigner();
    const update = getBase64Decoder().decode(accumulator(500));
    const plan = await planPythPosts({ rpc, payer, updates: [update] });
    expect(plan.post).toHaveLength(4);
  });
});
