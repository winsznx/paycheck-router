import { ShieldCheck, ShieldQuestion, TriangleAlert } from "lucide-react";

export type PriceCheckTone = "in-band" | "out-of-band" | "none";

export type PriceCheckBadgeProps = {
  tone: PriceCheckTone;
  /** Fully formatted text, e.g. "+0.12% vs Pyth" or "+30.40% vs mark". */
  text: string;
};

const ICON = {
  "in-band": ShieldCheck,
  "out-of-band": TriangleAlert,
  none: ShieldQuestion,
} as const;

export function PriceCheckBadge({ tone, text }: PriceCheckBadgeProps) {
  const Icon = ICON[tone];
  return (
    <span className={`pr-badge pr-badge--${tone}`} data-tone={tone}>
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
      {text}
    </span>
  );
}

export function PreIpoBadge({ label }: { label: string }) {
  return <span className="pr-badge pr-badge--preipo">{label}</span>;
}
