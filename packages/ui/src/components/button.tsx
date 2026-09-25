import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "s" | "m" | "l";

type ClassOptions = { variant?: ButtonVariant; size?: ButtonSize; block?: boolean };

/** Shared by <Button> and by link components that must look like buttons. */
export function buttonClassName({
  variant = "primary",
  size = "m",
  block = false,
}: ClassOptions = {}): string {
  return [
    "pr-btn",
    `pr-btn--${variant}`,
    size === "m" ? "" : `pr-btn--${size}`,
    block ? "pr-btn--block" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  ClassOptions & {
    /** While set, the width holds, the label becomes this verb ("Signing") and a 2 px bar runs. */
    loadingLabel?: string | undefined;
    children: ReactNode;
  };

export function Button({
  variant,
  size,
  block,
  loadingLabel,
  className,
  children,
  type = "button",
  disabled,
  ...rest
}: ButtonProps) {
  const loading = loadingLabel !== undefined;
  return (
    <button
      type={type}
      className={[buttonClassName({ variant, size, block }), className].filter(Boolean).join(" ")}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...rest}
    >
      {loading ? loadingLabel : children}
      {loading ? <span className="pr-btn__progress" aria-hidden="true" /> : null}
    </button>
  );
}
