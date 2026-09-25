export type ThemeName = "dark" | "light";

type ThemedValue = Readonly<Record<ThemeName, `#${string}`>>;

/**
 * PRD 14.1. `accentText` splits the light theme's accent into its fill (#00ff94) and its
 * readable text colour (#007a47); in dark both are #00ff94. `dangerInk` is the text on a
 * danger fill: #0a0a0f on the dark fill, white on the light fill (#0a0a0f on #c2183a is 3.28:1).
 */
export const colors = {
  bg: { dark: "#0a0a0f", light: "#fafaf7" },
  surface1: { dark: "#111118", light: "#ffffff" },
  surface2: { dark: "#17171f", light: "#f3f3ef" },
  surface3: { dark: "#1f1f29", light: "#e9e9e2" },
  line: { dark: "#2e2e3b", light: "#e4e4dc" },
  control: { dark: "#666679", light: "#8a8a99" },
  text1: { dark: "#f2f2f5", light: "#0a0a0f" },
  text2: { dark: "#a3a3b2", light: "#55556a" },
  text3: { dark: "#7a7a8c", light: "#6e6e80" },
  accent: { dark: "#00ff94", light: "#00ff94" },
  accentText: { dark: "#00ff94", light: "#007a47" },
  accentInk: { dark: "#0a0a0f", light: "#0a0a0f" },
  info: { dark: "#5aa9ff", light: "#1f5fbf" },
  warn: { dark: "#fab219", light: "#a15c00" },
  danger: { dark: "#ff5c7a", light: "#c2183a" },
  dangerInk: { dark: "#0a0a0f", light: "#ffffff" },
  preipo: { dark: "#b18cff", light: "#5b3fc4" },
  focus: { dark: "#5aa9ff", light: "#1f5fbf" },
} as const satisfies Record<string, ThemedValue>;

export type ColorToken = keyof typeof colors;

export const cssVarName = (token: ColorToken): `--${string}` =>
  `--${token.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase()}`;
