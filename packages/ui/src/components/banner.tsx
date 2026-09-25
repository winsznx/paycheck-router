import type { ReactNode } from "react";

export type BannerTone = "info" | "warn" | "danger" | "incident";

export type BannerProps = {
  tone: BannerTone;
  children: ReactNode;
  /** One action that fixes the state (PRD 14.6). */
  action?: ReactNode;
  /** "status" announces politely; "alert" interrupts. Omit for static banners. */
  live?: "status" | "alert" | undefined;
  className?: string | undefined;
};

export function Banner({ tone, children, action, live, className }: BannerProps) {
  return (
    <div
      className={["pr-banner", `pr-banner--${tone}`, className].filter(Boolean).join(" ")}
      role={live}
      data-tone={tone}
    >
      <p className="pr-banner__text">{children}</p>
      {action}
    </div>
  );
}
