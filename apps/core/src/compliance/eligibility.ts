import type { api } from "@paycheck-router/shared";

/** The US and its inhabited territories: every one of them makes the user a US person. */
const US_COUNTRIES = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM"]);

/** Comprehensively sanctioned jurisdictions (OFAC country programmes). */
const SANCTIONED_COUNTRIES = new Set(["CU", "IR", "KP", "SY"]);

type SanctionsStatus = api.EligibilityResponse["sanctions"][number]["status"];

export type EligibilityInput = {
  countryDeclared: string;
  countryIp: string | null;
  usPerson: boolean;
  sanctions: readonly SanctionsStatus[];
};

export function eligibilityFor(input: EligibilityInput): api.EligibilityStatus {
  if (input.sanctions.includes("flagged")) return "blocked_sanctions";
  if (input.usPerson || US_COUNTRIES.has(input.countryDeclared)) return "blocked_us";
  if (input.countryIp && US_COUNTRIES.has(input.countryIp)) return "blocked_us";
  if (SANCTIONED_COUNTRIES.has(input.countryDeclared)) return "blocked_country";
  if (input.countryIp && SANCTIONED_COUNTRIES.has(input.countryIp)) return "blocked_country";
  return "eligible";
}
