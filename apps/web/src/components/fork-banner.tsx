import { getTranslations } from "next-intl/server";
import { isHostedDemo } from "@/lib/env.ts";

/** PRD 4 "Labels" and 13.5: fixed on every screen of a fork run; never dismissible. */
export async function ForkBanner() {
  const t = await getTranslations("chrome");
  return (
    <div className="fork-banner" data-testid="fork-banner">
      <p>{t(isHostedDemo ? "forkBannerHosted" : "forkBanner")}</p>
    </div>
  );
}
