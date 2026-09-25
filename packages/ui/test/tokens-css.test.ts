import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type ColorToken, colors, cssVarName, type ThemeName } from "../src/tokens/color.ts";
import { duration } from "../src/tokens/motion.ts";
import { seriesColors } from "../src/tokens/series.ts";

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`Missing ${selector}`);
  const open = css.indexOf("{", start);
  return css.slice(open, css.indexOf("}", open));
}

const BLOCKS: Record<ThemeName, string> = {
  dark: block(':root[data-theme="dark"]'),
  light: block(':root[data-theme="light"] {'),
};

describe("tokens.css mirrors the TypeScript tokens", () => {
  for (const theme of ["dark", "light"] as const) {
    for (const token of Object.keys(colors) as ColorToken[]) {
      it(`${theme} ${cssVarName(token)}`, () => {
        expect(BLOCKS[theme]).toContain(`${cssVarName(token)}: ${colors[token][theme]};`);
      });
    }
    seriesColors[theme].forEach((hex, index) => {
      it(`${theme} --series-${index + 1}`, () => {
        expect(BLOCKS[theme]).toContain(`--series-${index + 1}: ${hex};`);
      });
    });
  }

  it("system theme repeats the light values", () => {
    const system = block(':root[data-theme="system"]');
    for (const token of Object.keys(colors) as ColorToken[]) {
      expect(system).toContain(`${cssVarName(token)}: ${colors[token].light};`);
    }
  });

  it("motion durations", () => {
    for (const [name, ms] of Object.entries(duration)) {
      expect(css).toContain(`--dur-${name}: ${ms}ms;`);
    }
  });
});
