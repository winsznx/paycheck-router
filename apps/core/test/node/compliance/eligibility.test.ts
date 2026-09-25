import { describe, expect, it } from "vitest";
import { eligibilityFor } from "../../../src/compliance/eligibility.ts";

describe("eligibilityFor", () => {
  const base = { countryDeclared: "NG", countryIp: "NG", usPerson: false, sanctions: [] as const };

  it("admits a declared non-US person outside sanctioned countries", () => {
    expect(eligibilityFor(base)).toBe("eligible");
    expect(eligibilityFor({ ...base, sanctions: ["not_configured"] })).toBe("eligible");
  });

  it.each([
    [{ usPerson: true }, "blocked_us"],
    [{ countryDeclared: "US" }, "blocked_us"],
    [{ countryDeclared: "PR" }, "blocked_us"],
    [{ countryIp: "US" }, "blocked_us"],
    [{ countryDeclared: "IR" }, "blocked_country"],
    [{ countryIp: "KP" }, "blocked_country"],
    [{ sanctions: ["clear", "flagged"] as const }, "blocked_sanctions"],
  ])("blocks %o as %s", (override, status) => {
    expect(eligibilityFor({ ...base, ...override })).toBe(status);
  });
});
