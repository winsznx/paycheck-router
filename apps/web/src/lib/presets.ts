import { assetBySymbol } from "@paycheck-router/shared";

export type DraftLeg = { mint: string; symbol: string; weightBps: number; bandBps: number };

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

/** Every preset resolved to registry legs, for passing to client components as data. */
export function allPresetLegs(): Record<string, DraftLeg[]> {
  return Object.fromEntries(Object.keys(PRESETS).map((name) => [name, presetLegs(name)]));
}
