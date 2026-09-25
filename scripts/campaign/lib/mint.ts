/** Token-2022 mint layout: the base mint padded to an account's 165 bytes, then the type byte. */
const EXTENSIONS_OFFSET = 166;
const TLV_HEADER = 4;
/** `ExtensionType::ScaledUiAmount` in spl-token-2022. */
export const SCALED_UI_AMOUNT_EXTENSION = 25;
/** authority (32) | multiplier f64 | new_multiplier_effective_timestamp i64 | new_multiplier f64 */
const EFFECTIVE_TIMESTAMP_OFFSET = 40;
const NEW_MULTIPLIER_OFFSET = 48;
const SCALED_UI_AMOUNT_LEN = 56;

export type ScaledUiAmount = {
  multiplier: number;
  newMultiplierEffectiveTimestamp: bigint;
  newMultiplier: number;
};

function findScaledUiAmount(data: Uint8Array): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = EXTENSIONS_OFFSET;
  while (offset + TLV_HEADER <= data.length) {
    const type = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    if (type === SCALED_UI_AMOUNT_EXTENSION) {
      if (length !== SCALED_UI_AMOUNT_LEN) {
        throw new Error(
          `ScaledUiAmount extension is ${length} bytes, expected ${SCALED_UI_AMOUNT_LEN}`,
        );
      }
      return offset + TLV_HEADER;
    }
    if (type === 0) break;
    offset += TLV_HEADER + length;
  }
  throw new Error("mint has no ScaledUiAmount extension");
}

export function readScaledUiAmount(data: Uint8Array): ScaledUiAmount {
  const start = findScaledUiAmount(data);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    multiplier: view.getFloat64(start + 32, true),
    newMultiplierEffectiveTimestamp: view.getBigInt64(start + EFFECTIVE_TIMESTAMP_OFFSET, true),
    newMultiplier: view.getFloat64(start + NEW_MULTIPLIER_OFFSET, true),
  };
}

/** A copy of the mint with a pending multiplier change, as the issuer's authority would set it. */
export function withPendingMultiplier(
  data: Uint8Array,
  newMultiplier: number,
  effectiveTimestamp: bigint,
): Uint8Array {
  const out = Uint8Array.from(data);
  const start = findScaledUiAmount(out);
  const view = new DataView(out.buffer);
  view.setBigInt64(start + EFFECTIVE_TIMESTAMP_OFFSET, effectiveTimestamp, true);
  view.setFloat64(start + NEW_MULTIPLIER_OFFSET, newMultiplier, true);
  return out;
}
