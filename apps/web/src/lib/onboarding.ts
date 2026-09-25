"use client";

import { assetBySymbol } from "@paycheck-router/shared";
import { useSyncExternalStore } from "react";

export type DraftLeg = { mint: string; symbol: string; weightBps: number; bandBps: number };

/** Every answer is kept as a draft so leaving mid-way resumes at the same step (3.3.7). */
export type Draft = {
  countryDeclared: string | null;
  notUsPerson: boolean;
  termsAccepted: boolean;
  wallet: string | null;
  typicalPaycheckUsdc: string;
  minInflowUsdc: string;
  investBps: number;
  legs: DraftLeg[];
  allowancePaychecks: 3 | 6 | "custom";
  customAllowanceUsdc: string;
};

export const TERMS_VERSION = "2026-09-25";
export const RISK_VERSION = "2026-09-25";
export const DEFAULT_MIN_INFLOW_USDC = "20";
export const DEFAULT_MAX_WAIT_SECS = 72 * 60 * 60;

type PresetSeed = readonly (readonly [symbol: string, weightPercent: number])[];

/** PRD 13.4 split editor presets. */
export const PRESETS: Readonly<Record<string, PresetSeed>> = {
  core: [["SPYx", 100]],
  coreTech: [
    ["SPYx", 70],
    ["QQQx", 30],
  ],
  techTilt: [
    ["QQQx", 40],
    ["NVDAx", 20],
    ["MSFTx", 20],
    ["GOOGLx", 20],
  ],
  preIpoSpice: [
    ["SPYx", 60],
    ["NVDAx", 20],
    ["Anthropic", 10],
    ["OpenAI", 10],
  ],
};

export function presetLegs(name: string): DraftLeg[] {
  return (PRESETS[name] ?? []).map(([symbol, percent]) => {
    const asset = assetBySymbol(symbol);
    return {
      mint: asset.mint,
      symbol: asset.symbol,
      weightBps: percent * 100,
      bandBps: asset.defaultBandBps,
    };
  });
}

const STORAGE_KEY = "pr_onboarding_draft";

const INITIAL: Draft = {
  countryDeclared: null,
  notUsPerson: false,
  termsAccepted: false,
  wallet: null,
  typicalPaycheckUsdc: "",
  minInflowUsdc: DEFAULT_MIN_INFLOW_USDC,
  investBps: 2000,
  legs: [],
  allowancePaychecks: 3,
  customAllowanceUsdc: "",
};

let draft: Draft = INITIAL;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) draft = { ...INITIAL, ...(JSON.parse(raw) as Partial<Draft>) };
  } catch {
    draft = INITIAL;
  }
}

export function updateDraft(patch: Partial<Draft>) {
  load();
  draft = { ...draft, ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // A private window can refuse storage; the draft still lives for this tab.
  }
  for (const listener of listeners) listener();
}

export function clearDraft() {
  draft = INITIAL;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
  for (const listener of listeners) listener();
}

export function useDraft(): Draft {
  return useSyncExternalStore(
    (listener) => {
      load();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => {
      load();
      return draft;
    },
    () => INITIAL,
  );
}

export const totalWeightBps = (legs: readonly DraftLeg[]) =>
  legs.reduce((sum, leg) => sum + leg.weightBps, 0);

/** Decimal USDC string to base units, or null when it is not a positive amount. */
export function toBaseUnits(value: string): string | null {
  const match = /^(\d{1,12})(?:[.,](\d{0,6}))?$/.exec(value.trim());
  if (!match?.[1]) return null;
  const units = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  return units > 0n ? units.toString() : null;
}

export function allowanceBaseUnits(d: Draft): string | null {
  if (d.allowancePaychecks === "custom") return toBaseUnits(d.customAllowanceUsdc);
  const paycheck = toBaseUnits(d.typicalPaycheckUsdc);
  if (!paycheck) return null;
  const perPaycheck = (BigInt(paycheck) * BigInt(d.investBps)) / 10_000n;
  return (perPaycheck * BigInt(d.allowancePaychecks)).toString();
}
