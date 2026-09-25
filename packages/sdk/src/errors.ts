import {
  PROGRAM_ID,
  type ProgramErrorInfo,
  programErrorByCode,
  type WaitReason,
} from "@paycheck-router/shared";

export type FailureClassification =
  /** Our program rejected the leg with a known code. */
  | { kind: "program"; error: ProgramErrorInfo; reason: WaitReason | null }
  /** Another program failed (Jupiter route, token program, Pyth receiver). */
  | { kind: "external"; program: string; code: number | null; detail: string }
  /** The transaction never ran: blockhash, fees, account locks, size. */
  | { kind: "landing"; detail: string };

const FAILED_CUSTOM = /^Program (\w+) failed: custom program error: 0x([0-9a-fA-F]+)$/;
const FAILED_OTHER = /^Program (\w+) failed: (.+)$/;

/**
 * Attributes a failed simulation or transaction to the program that raised it. The innermost
 * failing program logs its failure first, which matters because Jupiter's error codes overlap
 * ours (both start at 6000).
 */
export function classifyFailure(
  err: unknown,
  logs: readonly string[],
  programId: string = PROGRAM_ID,
): FailureClassification {
  for (const line of logs) {
    const custom = FAILED_CUSTOM.exec(line);
    if (custom) {
      const [, program = "", hex = "0"] = custom;
      const code = Number.parseInt(hex, 16);
      if (program === programId) {
        const info = programErrorByCode(code);
        if (info) return { kind: "program", error: info, reason: info.reason };
      }
      return { kind: "external", program, code, detail: line };
    }
    const other = FAILED_OTHER.exec(line);
    if (other) {
      const [, program = "", detail = ""] = other;
      return { kind: "external", program, code: null, detail };
    }
  }
  const custom = customCodeOf(err);
  if (custom !== null && logs.length === 0) {
    const info = programErrorByCode(custom);
    if (info) return { kind: "program", error: info, reason: info.reason };
  }
  return { kind: "landing", detail: JSON.stringify(err, bigintReplacer) };
}

function customCodeOf(err: unknown): number | null {
  if (typeof err !== "object" || err === null || !("InstructionError" in err)) return null;
  const detail = (err as { InstructionError: unknown }).InstructionError;
  if (!Array.isArray(detail)) return null;
  const inner = detail[1] as unknown;
  if (typeof inner === "object" && inner !== null && "Custom" in inner) {
    return Number((inner as { Custom: number | bigint }).Custom);
  }
  return null;
}

export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
