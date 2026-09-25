import { PROGRAM_ID, WaitReason } from "@paycheck-router/shared";
import { getBase64Decoder, getU64Decoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { classifyFailure } from "../src/errors.ts";
import { decodeEvents, eventDiscriminator, programDataFromLogs } from "../src/events.ts";
import { legAttemptKey, parseLegAttemptKey, paycheckKey } from "../src/idempotency.ts";

const JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

describe("classifyFailure", () => {
  it("maps our OutputBelowMinimum to a premium wait", () => {
    const logs = [
      `Program ${PROGRAM_ID} invoke [1]`,
      "Program log: AnchorError occurred. Error Code: OutputBelowMinimum. Error Number: 6022.",
      `Program ${PROGRAM_ID} failed: custom program error: 0x1786`,
    ];
    const result = classifyFailure({ InstructionError: [3, { Custom: 6022 }] }, logs);
    expect(result.kind).toBe("program");
    expect(result.kind === "program" && result.reason).toBe(WaitReason.PREMIUM_TOO_HIGH);
  });

  it("attributes an overlapping code raised inside Jupiter to Jupiter", () => {
    const logs = [
      `Program ${PROGRAM_ID} invoke [1]`,
      `Program ${JUP} invoke [2]`,
      `Program ${JUP} failed: custom program error: 0x1771`,
      `Program ${PROGRAM_ID} failed: custom program error: 0x1771`,
    ];
    const result = classifyFailure({ InstructionError: [3, { Custom: 6001 }] }, logs);
    expect(result).toMatchObject({ kind: "external", program: JUP, code: 6001 });
  });

  it("treats a transaction that never ran as landing", () => {
    expect(classifyFailure("BlockhashNotFound", []).kind).toBe("landing");
  });

  it("maps PriceStale to MARKET_CLOSED", () => {
    const logs = [`Program ${PROGRAM_ID} failed: custom program error: 0x177c`];
    const result = classifyFailure({ InstructionError: [2, { Custom: 6012n }] }, logs);
    expect(result.kind === "program" && result.reason).toBe(WaitReason.MARKET_CLOSED);
  });
});

describe("event logs", () => {
  it("keeps only data our program emitted at the top of the stack", async () => {
    const disc = await eventDiscriminator("LegExecuted");
    const payload = new Uint8Array([...disc, 42, 0, 0, 0, 0, 0, 0, 0]);
    const encoded = getBase64Decoder().decode(payload);
    const logs = [
      `Program ${PROGRAM_ID} invoke [1]`,
      `Program ${JUP} invoke [2]`,
      `Program data: ${encoded}`,
      `Program ${JUP} success`,
      `Program data: ${encoded}`,
      `Program ${PROGRAM_ID} success`,
    ];
    expect(programDataFromLogs(logs)).toHaveLength(1);
    const events = await decodeEvents(logs, "LegExecuted", getU64Decoder());
    expect(events).toEqual([42n]);
    expect(await decodeEvents(logs, "LegExpired", getU64Decoder())).toEqual([]);
  });
});

describe("idempotency keys", () => {
  it("round-trips router:seq:leg:attempt", () => {
    const router = PROGRAM_ID;
    const key = legAttemptKey(router, 7n, 2, 3);
    expect(key).toBe(`${router}:7:2:3`);
    expect(parseLegAttemptKey(key)).toEqual({ router, seq: 7n, legIndex: 2, attempt: 3 });
    expect(paycheckKey(router, 7n)).toBe(`${router}:7`);
    expect(() => parseLegAttemptKey("a:b:c")).toThrow();
    expect(() => parseLegAttemptKey(`${router}:x:1:1`)).toThrow();
  });
});
