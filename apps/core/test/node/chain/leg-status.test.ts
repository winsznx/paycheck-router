import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEG_STATUS } from "../../../src/chain/leg-status.ts";

// The IDL carries LegState.status as a plain u8, so the numbering lives in the program source.
const stateRs = readFileSync(
  new URL("../../../../../programs/paycheck_router/src/state.rs", import.meta.url),
  "utf8",
);

function programLegStatus(): Record<string, number> {
  const body = /pub enum LegStatus \{([^}]*)\}/.exec(stateRs)?.[1] ?? "";
  return Object.fromEntries(
    [...body.matchAll(/(\w+)\s*=\s*(\d+)/g)].map(([, name, value]) => [name, Number(value)]),
  );
}

describe("LEG_STATUS", () => {
  it("matches the program's LegStatus discriminants", () => {
    expect(programLegStatus()).toEqual({
      Pending: LEG_STATUS.pending,
      Executed: LEG_STATUS.executed,
      Expired: LEG_STATUS.expired,
      Cancelled: LEG_STATUS.cancelled,
    });
  });
});
