import { CircleHelp } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { AppNav } from "@/components/app/app-nav.tsx";
import { RouterStatusPill } from "@/components/app/router-status.tsx";
import { SessionGate } from "@/components/app/session-gate.tsx";
import { CONTENT_ID } from "@/components/skip-link.tsx";

export default async function MainAppLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("app.nav");
  return (
    <div className="app-frame">
      <AppNav statusSlot={<RouterStatusPill />} />
      <div className="app-frame__main">
        <header className="app-topbar">
          <RouterStatusPill />
          <Link href="/help" className="app-topbar__help">
            <CircleHelp size={20} strokeWidth={1.75} aria-hidden="true" />
            <span>{t("help")}</span>
          </Link>
        </header>
        <main id={CONTENT_ID} className="app-content">
          <SessionGate>{children}</SessionGate>
        </main>
      </div>
    </div>
  );
}
