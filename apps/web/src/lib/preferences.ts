import { cookies } from "next/headers";
import type { Theme } from "@/components/document.tsx";

export const THEME_COOKIE = "pr_theme";
export const MOTION_COOKIE = "pr_motion";
export const DATA_SAVER_COOKIE = "pr_data_saver";

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
