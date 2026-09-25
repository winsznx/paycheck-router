export type TypeStyle = {
  family: "display" | "mono";
  mobile: readonly [size: number, line: number];
  desktop: readonly [size: number, line: number];
  weight: number;
  trackingEm: number;
  uppercase?: true;
};

/** PRD 14.3. Syne carries words, JetBrains Mono carries every number. */
export const typeScale = {
  display: {
    family: "display",
    mobile: [40, 44],
    desktop: [64, 68],
    weight: 800,
    trackingEm: -0.03,
  },
  h1: { family: "display", mobile: [32, 38], desktop: [44, 50], weight: 700, trackingEm: -0.02 },
  h2: { family: "display", mobile: [24, 30], desktop: [32, 38], weight: 700, trackingEm: -0.01 },
  h3: { family: "display", mobile: [20, 26], desktop: [22, 28], weight: 600, trackingEm: 0 },
  bodyL: { family: "display", mobile: [18, 28], desktop: [18, 28], weight: 400, trackingEm: 0 },
  body: { family: "display", mobile: [16, 24], desktop: [16, 24], weight: 400, trackingEm: 0 },
  small: { family: "display", mobile: [14, 20], desktop: [14, 20], weight: 500, trackingEm: 0 },
  label: {
    family: "mono",
    mobile: [12, 16],
    desktop: [12, 16],
    weight: 500,
    trackingEm: 0.08,
    uppercase: true,
  },
  numberXl: { family: "mono", mobile: [40, 44], desktop: [56, 60], weight: 600, trackingEm: -0.02 },
  number: { family: "mono", mobile: [16, 24], desktop: [16, 24], weight: 500, trackingEm: 0 },
  code: { family: "mono", mobile: [14, 20], desktop: [14, 20], weight: 400, trackingEm: 0 },
} as const satisfies Record<string, TypeStyle>;
