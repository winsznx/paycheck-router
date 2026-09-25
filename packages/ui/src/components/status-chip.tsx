import {
  ArrowRightLeft,
  Ban,
  Check,
  Clock,
  Hourglass,
  type LucideIcon,
  ShieldAlert,
  ShieldCheck,
  TimerOff,
} from "lucide-react";

export type SliceStatus =
  | "pending"
  | "executing"
  | "executed"
  | "verified"
  | "waiting"
  | "expired"
  | "cancelled"
  | "unverified";

const ICONS: Record<SliceStatus, LucideIcon> = {
  pending: Clock,
  executing: ArrowRightLeft,
  executed: Check,
  verified: ShieldCheck,
  waiting: Hourglass,
  expired: TimerOff,
  cancelled: Ban,
  unverified: ShieldAlert,
};

export type StatusChipProps = {
  status: SliceStatus;
  /** Visible text, e.g. "Waiting". */
  label: string;
  /** Spelled-out state for screen readers, e.g. "Waiting: market closed" (PRD 17.1). */
  description?: string | undefined;
};

/** Icon + label + colour, never colour alone (PRD 14.6). */
export function StatusChip({ status, label, description }: StatusChipProps) {
  const Icon = ICONS[status];
  return (
    <span className={`pr-chip pr-chip--${status}`} data-status={status}>
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
      <span aria-hidden={description ? true : undefined}>{label}</span>
      {description ? <span className="pr-sr-only">{description}</span> : null}
    </span>
  );
}
