/** PRD 14.4: 4 px grid. */
export const space = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const;

export const radius = { surface: 0, chartSegmentEnd: 4 } as const;

export const border = { divider: 1, control: 2, selected: 2 } as const;

export const hardShadow = { rest: 4, hover: 6, pressed: 0 } as const;

export const layout = {
  columns: { phone: 4, tablet: 8, desktop: 12 },
  gutter: { phone: 16, tabletUp: 24 },
  contentMax: 1200,
  readingMax: 680,
} as const;

/** PRD 16.1 breakpoints, lower bounds in px. */
export const breakpoints = {
  phoneS: 320,
  phoneM: 360,
  phoneL: 390,
  largePhone: 480,
  tablet: 768,
  tabletLandscape: 1024,
  desktop: 1280,
  wide: 1536,
} as const;

export const touchTarget = { min: 44, gap: 8 } as const;

export const buttonHeight = { s: 36, m: 44, l: 56 } as const;
