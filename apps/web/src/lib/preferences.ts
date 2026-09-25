import { cookies } from "next/headers";
import type { Theme } from "@/components/document.tsx";
import { DATA_SAVER_COOKIE, MOTION_COOKIE, THEME_COOKIE } from "./preference-cookies.ts";

export type DisplayPreferences = {
  theme: Theme;
  motion: "reduced" | undefined;
  dataSaver: boolean;
};

/** Device-level display preferences (PRD 13.4 Settings > preferences). Dark is the default. */
export async function readDisplayPreferences(): Promise<DisplayPreferences> {
  const store = await cookies();
  const theme = store.get(THEME_COOKIE)?.value;
  return {
    theme: theme === "light" || theme === "system" ? theme : "dark",
    motion: store.get(MOTION_COOKIE)?.value === "reduced" ? "reduced" : undefined,
    dataSaver: store.get(DATA_SAVER_COOKIE)?.value === "on",
  };
}
