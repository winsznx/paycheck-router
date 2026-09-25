"use client";

import { Activity, ChartPie, House, type LucideIcon, ReceiptText, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

type NavItem = {
  href: "/app" | "/app/paychecks" | "/app/portfolio" | "/app/activity" | "/app/settings/wallet";
  key: string;
  icon: LucideIcon;
  shortcut: string;
};

const ITEMS: readonly NavItem[] = [
  { href: "/app", key: "home", icon: House, shortcut: "h" },
  { href: "/app/paychecks", key: "paychecks", icon: ReceiptText, shortcut: "p" },
  { href: "/app/portfolio", key: "portfolio", icon: ChartPie, shortcut: "f" },
  { href: "/app/activity", key: "activity", icon: Activity, shortcut: "a" },
  { href: "/app/settings/wallet", key: "settings", icon: Settings, shortcut: "s" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  if (href.startsWith("/app/settings")) return pathname.startsWith("/app/settings");
  return pathname.startsWith(href);
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/** PRD 16.2: bottom tabs on phones, a side rail on tablets, a sidebar on desktop. */
export function AppNav({ statusSlot }: { statusSlot?: React.ReactNode }) {
  const t = useTranslations("app.nav");
  const pathname = usePathname();
  const router = useRouter();

  // Desktop shortcuts: `g h` Home, `g p` Paychecks, `g f` Portfolio. Subscribes to the document.
  useEffect(() => {
    let leader = 0;
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (event.key === "g") {
        leader = Date.now();
        return;
      }
      if (Date.now() - leader > 1200) return;
      const item = ITEMS.find((i) => i.shortcut === event.key);
      if (item) {
        leader = 0;
        router.push(item.href);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return (
    <nav className="app-nav" aria-label={t("label")}>
      <Link href="/app" className="app-nav__brand">
        <span className="app-nav__mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="app-nav__wordmark">{t("wordmark")}</span>
      </Link>
      <ul className="app-nav__list">
        {ITEMS.map(({ href, key, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                className="app-nav__link"
                aria-current={active ? "page" : undefined}
              >
                <Icon size={24} strokeWidth={1.75} aria-hidden="true" />
                <span>{t(key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {statusSlot ? <div className="app-nav__status">{statusSlot}</div> : null}
    </nav>
  );
}
