"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation.ts";

export type SiteMenuItem = { href: string; label: string; external?: boolean };

/**
 * The phone and tablet menu: a full-width panel under the header. Escape and any navigation
 * close it and return focus to the button; the page behind doesn't scroll while it's open.
 */
export function SiteMenu({
  items,
  buttonLabel,
  navLabel,
}: {
  items: readonly SiteMenuItem[];
  buttonLabel: string;
  navLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [openedAt, setOpenedAt] = useState(pathname);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelId = useId();

  if (open && pathname !== openedAt) {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const root = document.documentElement;
    root.dataset.menuOpen = "true";
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      delete root.dataset.menuOpen;
    };
  }, [open]);

  function toggle() {
    setOpenedAt(pathname);
    setOpen((value) => !value);
  }

  return (
    <div className="site-menu">
      <button
        ref={buttonRef}
        type="button"
        className="pr-icon-btn"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={buttonLabel}
        onClick={toggle}
      >
        {open ? (
          <X size={24} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <Menu size={24} strokeWidth={1.75} aria-hidden="true" />
        )}
      </button>
      <nav
        ref={panelRef}
        id={panelId}
        aria-label={navLabel}
        className="site-menu__panel"
        hidden={!open}
      >
        <ul>
          {items.map((item) => (
            <li key={item.href}>
              {item.external ? (
                <a href={item.href} onClick={() => setOpen(false)}>
                  {item.label}
                </a>
              ) : (
                <Link href={item.href} onClick={() => setOpen(false)}>
                  {item.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
