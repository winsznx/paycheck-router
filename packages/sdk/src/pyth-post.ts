/**
 * Fully verified Pyth price posts, built with `@solana/kit` from the Wormhole core bridge and
 * Pyth receiver instruction layouts: create and write an encoded VAA, verify it against the full
 * guardian set, post one `PriceUpdateV2` per feed, then close everything to return the rent.
 *
 * This is the instruction sequence `@pythnetwork/pyth-solana-receiver` builds with
 * `closeUpdateAccounts: true`. That package cannot load under Node's ESM loader, so the SDK
 * builds the same instructions itself.
 */
import { PYTH_RECEIVER_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "@paycheck-router/shared";
import {
  AccountRole,
  type Address,
  address,
  generateKeyPairSigner,
  getBase64Encoder,
  getProgramDerivedAddress,
  getU32Encoder,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import type { SolanaRpc } from "./rpc.ts";

export const WORMHOLE_PROGRAM_ID = address("HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ");

/** Bytes before the VAA body in an encoded VAA account. */
export const VAA_START = 46;
/** First write covers this many VAA bytes so create, init and write fit one transaction. */
export const VAA_SPLIT_INDEX = 721;

const COMPUTE = {
  createAccount: 5_000,
  initEncodedVaa: 3_000,
  writeEncodedVaa: 3_000,
  verifyEncodedVaa: 350_000,
  postUpdate: 35_000,
  closeEncodedVaa: 30_000,
  reclaimRent: 30_000,
} as const;

const ACCUMULATOR_MAGIC = [0x50, 0x4e, 0x41, 0x55];
const PROOF_SIZE = 20;

export type AccumulatorUpdate = {
  vaa: Uint8Array;
  updates: { message: Uint8Array; proof: Uint8Array[] }[];
};

/** Splits a Hermes accumulator update (`PNAU` v1.0) into its VAA and Merkle price updates. */
export function parseAccumulatorUpdate(data: Uint8Array): AccumulatorUpdate {
  if (!ACCUMULATOR_MAGIC.every((byte, i) => data[i] === byte) || data[4] !== 1 || data[5] !== 0) {
    throw new Error("not a v1.0 accumulator update");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let cursor = 6;
  cursor += 1 + view.getUint8(cursor);
  cursor += 1;
  const vaaSize = view.getUint16(cursor);
  cursor += 2;
  const vaa = data.slice(cursor, cursor + vaaSize);
  cursor += vaaSize;
  const count = view.getUint8(cursor);
  cursor += 1;
  const updates: AccumulatorUpdate["updates"] = [];
  for (let i = 0; i < count; i++) {
    const messageSize = view.getUint16(cursor);
    cursor += 2;
    const message = data.slice(cursor, cursor + messageSize);
    cursor += messageSize;
    const proofs = view.getUint8(cursor);
    cursor += 1;
    const proof: Uint8Array[] = [];
    for (let p = 0; p < proofs; p++) {
      proof.push(data.slice(cursor, cursor + PROOF_SIZE));
      cursor += PROOF_SIZE;
    }
    updates.push({ message, proof });
  }
  if (cursor !== data.length) throw new Error("accumulator update has trailing bytes");
  return { vaa, updates };
}

export type PriceFeedMessage = {
  feedId: string;
  price: bigint;
  conf: bigint;
  exponent: number;
  publishTime: bigint;
  prevPublishTime: bigint;
  emaPrice: bigint;
  emaConf: bigint;
};

export function parsePriceFeedMessage(message: Uint8Array): PriceFeedMessage {
  if (message[0] !== 0) throw new Error("not a price feed message");
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  const hex = Array.from(message.slice(1, 33), (b) => b.toString(16).padStart(2, "0")).join("");
  return {
    feedId: hex,
    price: view.getBigInt64(33),
    conf: view.getBigUint64(41),
    exponent: view.getInt32(49),
    publishTime: view.getBigInt64(53),
    prevPublishTime: view.getBigInt64(61),
    emaPrice: view.getBigInt64(69),
    emaConf: view.getBigUint64(77),
  };
}

/** Index of the guardian set that signed a VAA: bytes 1..5, big-endian. */
export function guardianSetIndex(vaa: Uint8Array): number {
  return new DataView(vaa.buffer, vaa.byteOffset, vaa.byteLength).getUint32(1);
}

const discriminators = new Map<string, Uint8Array>();

/** Anchor's instruction discriminator: sha256("global:<name>")[0..8]. */
export async function instructionDiscriminator(name: string): Promise<Uint8Array> {
  const cached = discriminators.get(name);
  if (cached) return cached;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`global:${name}`));
  const value = new Uint8Array(digest).slice(0, 8);
  discriminators.set(name, value);
  return value;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const u32 = (value: number) => Uint8Array.from(getU32Encoder().encode(value));

function u32BigEndian(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function signerMeta(signer: KeyPairSigner, isWritable: boolean) {
  return {
    address: signer.address,
    role: isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER,
    signer,
  };
}

const writable = (value: Address) => ({ address: value, role: AccountRole.WRITABLE });
const readonly = (value: Address) => ({ address: value, role: AccountRole.READONLY });

async function pda(program: Address, seeds: (string | Uint8Array)[]): Promise<Address> {
  const [value] = await getProgramDerivedAddress({ programAddress: program, seeds });
  return value;
}

export type InstructionGroup = {
  instructions: Instruction[];
  computeUnits: number;
};

export type PythPostPlan = {
  /** Groups to send, in order, before any transaction that reads the prices. */
  post: InstructionGroup[];
  /** Groups that close the encoded VAAs and every price update account, sent last. */
  close: InstructionGroup[];
  /** Feed id (lowercase hex, no 0x) to the account its update is posted to. */
  priceUpdateAccounts: Map<string, Address>;
  messages: PriceFeedMessage[];
};

function randomTreasuryId(): number {
  return crypto.getRandomValues(new Uint8Array(1))[0] ?? 0;
}

/** Plans fully verified posts for Hermes accumulator updates (base64). */
export async function planPythPosts(params: {
  rpc: SolanaRpc;
  payer: KeyPairSigner;
  updates: readonly string[];
  treasuryId?: number;
}): Promise<PythPostPlan> {
  const { rpc, payer } = params;
  const treasuryId = params.treasuryId ?? randomTreasuryId();
  const config = await pda(PYTH_RECEIVER_PROGRAM_ID, ["config"]);
  const treasury = await pda(PYTH_RECEIVER_PROGRAM_ID, ["treasury", Uint8Array.of(treasuryId)]);
  const post: InstructionGroup[] = [];
  const close: InstructionGroup[] = [];
  const priceUpdateAccounts = new Map<string, Address>();
  const messages: PriceFeedMessage[] = [];

  for (const update of params.updates) {
    const parsed = parseAccumulatorUpdate(Uint8Array.from(getBase64Encoder().encode(update)));
    const { vaa } = parsed;
    const encodedVaa = await generateKeyPairSigner();
    const space = BigInt(vaa.length + VAA_START);
    const lamports = await rpc.getMinimumBalanceForRentExemption(space).send();
    const guardianSet = await pda(WORMHOLE_PROGRAM_ID, [
      "GuardianSet",
      u32BigEndian(guardianSetIndex(vaa)),
    ]);
    const writeVaa = async (index: number, chunk: Uint8Array): Promise<Instruction> => ({
      programAddress: WORMHOLE_PROGRAM_ID,
      accounts: [signerMeta(payer, false), writable(encodedVaa.address)],
      data: concat(
        await instructionDiscriminator("write_encoded_vaa"),
        u32(index),
        u32(chunk.length),
        chunk,
      ),
    });

    post.push({
      instructions: [
        getCreateAccountInstruction({
          payer,
          newAccount: encodedVaa,
          lamports,
          space,
          programAddress: WORMHOLE_PROGRAM_ID,
        }),
        {
          programAddress: WORMHOLE_PROGRAM_ID,
          accounts: [signerMeta(payer, false), writable(encodedVaa.address)],
          data: await instructionDiscriminator("init_encoded_vaa"),
        },
      ],
      computeUnits: COMPUTE.createAccount + COMPUTE.initEncodedVaa,
    });
    post.push({
      instructions: [await writeVaa(0, vaa.slice(0, VAA_SPLIT_INDEX))],
      computeUnits: COMPUTE.writeEncodedVaa,
    });
    if (vaa.length > VAA_SPLIT_INDEX) {
      post.push({
        instructions: [await writeVaa(VAA_SPLIT_INDEX, vaa.slice(VAA_SPLIT_INDEX))],
        computeUnits: COMPUTE.writeEncodedVaa,
      });
    }
    post.push({
      instructions: [
        {
          programAddress: WORMHOLE_PROGRAM_ID,
          accounts: [signerMeta(payer, false), writable(encodedVaa.address), readonly(guardianSet)],
          data: await instructionDiscriminator("verify_encoded_vaa_v1"),
        },
      ],
      computeUnits: COMPUTE.verifyEncodedVaa,
    });

    for (const { message, proof } of parsed.updates) {
      const feed = parsePriceFeedMessage(message);
      messages.push(feed);
      const priceUpdate = await generateKeyPairSigner();
      post.push({
        instructions: [
          {
            programAddress: PYTH_RECEIVER_PROGRAM_ID,
            accounts: [
              signerMeta(payer, true),
              readonly(encodedVaa.address),
              readonly(config),
              writable(treasury),
              signerMeta(priceUpdate, true),
              readonly(SYSTEM_PROGRAM_ID),
              signerMeta(payer, false),
            ],
            data: concat(
              await instructionDiscriminator("post_update"),
              u32(message.length),
              message,
              u32(proof.length),
              ...proof,
              Uint8Array.of(treasuryId),
            ),
          },
        ],
        computeUnits: COMPUTE.postUpdate,
      });
      priceUpdateAccounts.set(feed.feedId, priceUpdate.address);
      close.push({
        instructions: [
          {
            programAddress: PYTH_RECEIVER_PROGRAM_ID,
            accounts: [signerMeta(payer, true), writable(priceUpdate.address)],
            data: await instructionDiscriminator("reclaim_rent"),
          },
        ],
        computeUnits: COMPUTE.reclaimRent,
      });
    }
    close.push({
      instructions: [
        {
          programAddress: WORMHOLE_PROGRAM_ID,
          accounts: [signerMeta(payer, true), writable(encodedVaa.address)],
          data: await instructionDiscriminator("close_encoded_vaa"),
        },
      ],
      computeUnits: COMPUTE.closeEncodedVaa,
    });
  }
  return { post, close, priceUpdateAccounts, messages };
}
