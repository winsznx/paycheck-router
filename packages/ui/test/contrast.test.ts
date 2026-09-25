import { describe, expect, it } from "vitest";
import { type ColorToken, colors, type ThemeName } from "../src/tokens/color.ts";
import { contrastRatio } from "../src/tokens/contrast.ts";

/**
 * PRD 14.1: the build fails if any token pair drops below 4.5:1 for text or 3:1 for controls.
 * Pairs list the surfaces each foreground is allowed on. `text3` is limited to the canvas:
 * on surface-1 it measures 4.47:1 (dark) and on surface-2 4.49:1 (light), under AA.
 */
const TEXT_PAIRS: ReadonlyArray<readonly [ColorToken, readonly ColorToken[]]> = [
  ["text1", ["bg", "surface1", "surface2", "surface3"]],
  ["text2", ["bg", "surface1", "surface2", "surface3"]],
  ["text3", ["bg"]],
  ["accentText", ["bg", "surface1", "surface2"]],
  ["info", ["bg", "surface1", "surface2"]],
  ["warn", ["bg", "surface1", "surface2"]],
  ["danger", ["bg", "surface1", "surface2"]],
  ["preipo", ["bg", "surface1", "surface2"]],
  ["accentInk", ["accent"]],
  ["dangerInk", ["danger"]],
];

const CONTROL_PAIRS: ReadonlyArray<readonly [ColorToken, readonly ColorToken[]]> = [
  ["control", ["bg", "surface1", "surface2"]],
  ["focus", ["bg", "surface1", "surface2", "surface3"]],
];

const THEMES: readonly ThemeName[] = ["dark", "light"];

describe("colour tokens meet WCAG 2.2 AA", () => {
  for (const theme of THEMES) {
    for (const [fg, surfaces] of TEXT_PAIRS) {
      for (const surface of surfaces) {
        it(`${theme}: ${fg} on ${surface} ≥ 4.5`, () => {
          expect(contrastRatio(colors[fg][theme], colors[surface][theme])).toBeGreaterThanOrEqual(
            4.5,
          );
        });
      }
    }
    for (const [fg, surfaces] of CONTROL_PAIRS) {
      for (const surface of surfaces) {
        it(`${theme}: ${fg} on ${surface} ≥ 3`, () => {
          expect(contrastRatio(colors[fg][theme], colors[surface][theme])).toBeGreaterThanOrEqual(
            3,
          );
        });
      }
    }
  }

  it("matches the PRD's published ratios", () => {
    expect(contrastRatio(colors.text1.dark, colors.bg.dark)).toBeCloseTo(17.68, 2);
    expect(contrastRatio(colors.accent.dark, colors.bg.dark)).toBeCloseTo(14.8, 1);
    expect(contrastRatio(colors.control.dark, colors.surface2.dark)).toBeCloseTo(3.17, 2);
  });
});
