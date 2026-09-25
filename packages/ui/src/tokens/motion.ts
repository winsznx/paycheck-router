/** PRD 15.2. Durations in ms; the CSS variables in tokens.css mirror these values. */
export const duration = {
  instant: 80,
  fast: 140,
  base: 220,
  slow: 360,
  deliberate: 600,
} as const;

export const easing = {
  out: [0.2, 0, 0, 1],
  in: [0.4, 0, 1, 1],
  inOut: [0.4, 0, 0.2, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export const cubicBezier = (curve: readonly [number, number, number, number]) =>
  `cubic-bezier(${curve.join(", ")})`;

/** The one spring in the system, for split segments (overshoot under 2%). */
export const splitSpring = { type: "spring", stiffness: 420, damping: 38, mass: 1 } as const;

export const distance = { press: 4, hoverLift: 2, entrance: 16, rise: 8 } as const;

export const stagger = { stepMs: 40, maxItems: 6 } as const;

export const staggerDelay = (index: number) =>
  Math.min(index, stagger.maxItems - 1) * stagger.stepMs;

export const shimmerMs = 1200;

export const onboardingWelcomeMs = 2400;
