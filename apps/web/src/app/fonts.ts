import { JetBrains_Mono, Syne } from "next/font/google";

/** PRD 14.3: self-hosted at build, latin + latin-ext, swap, metric-adjusted fallbacks. */
export const syne = Syne({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-syne",
  adjustFontFallback: true,
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-jetbrains-mono",
  adjustFontFallback: true,
});

export const fontVariables = `${syne.variable} ${jetbrainsMono.variable}`;
