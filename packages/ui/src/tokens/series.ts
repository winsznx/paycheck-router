import type { ThemeName } from "./color.ts";

/** PRD 14.2: categorical slots 1–8. An asset keeps its slot for the life of a router. */
export const seriesColors = {
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
} as const satisfies Record<ThemeName, readonly string[]>;

export const SERIES_SLOTS = 8;

export type SeriesSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export function isSeriesSlot(value: number): value is SeriesSlot {
  return Number.isInteger(value) && value >= 1 && value <= SERIES_SLOTS;
}

export const seriesVar = (slot: SeriesSlot) => `var(--series-${slot})`;
