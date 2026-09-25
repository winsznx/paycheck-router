import type { ReactNode } from "react";
import { fontVariables } from "@/app/fonts.ts";
import { showForkBanner } from "@/lib/env.ts";
import { ForkBanner } from "./fork-banner.tsx";
import { ServiceWorker } from "./service-worker.tsx";
import { SkipLink } from "./skip-link.tsx";

export type Theme = "dark" | "light" | "system";

type DocumentProps = {
  locale: string;
  surface: "app" | "site";
  theme?: Theme;
  motion?: "reduced" | undefined;
  dataSaver?: boolean;
  children: ReactNode;
};

/** Shared <html> shell for the public site and the app root layouts. */
export function Document({
  locale,
  surface,
  theme = "dark",
  motion,
  dataSaver = false,
  children,
}: DocumentProps) {
  return (
    <html
      lang={locale}
      data-theme={theme}
      data-motion={motion}
      data-data-saver={dataSaver ? "on" : undefined}
      className={fontVariables}
    >
      <body>
        <SkipLink />
        {showForkBanner(surface) ? <ForkBanner /> : null}
        <ServiceWorker>{children}</ServiceWorker>
      </body>
    </html>
  );
}
