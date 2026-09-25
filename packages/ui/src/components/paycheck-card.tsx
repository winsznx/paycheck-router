import type { ReactNode } from "react";
import { SplitBar, type SplitSegment } from "./split-bar.tsx";

export type PaycheckCardState = "recording" | "executing" | "waiting" | "complete" | "expired";

export type PaycheckCardProps = {
  state: PaycheckCardState;
  amount: ReactNode;
  payer: ReactNode;
  time: ReactNode;
  invested: ReactNode;
  segments: readonly SplitSegment[];
  splitLabel: string;
  /** One line summarising slice statuses, e.g. "3 bought, 1 waiting". */
  summary: ReactNode;
  status: ReactNode;
  viewTransitionName?: string | undefined;
};

export function PaycheckCard({
  state,
  amount,
  payer,
  time,
  invested,
  segments,
  splitLabel,
  summary,
  status,
  viewTransitionName,
}: PaycheckCardProps) {
  return (
    <div className="pr-paycheck" data-state={state}>
      <div className="pr-paycheck__head">
        <span className="pr-num" style={{ fontSize: 22, lineHeight: "28px" }}>
          {amount}
        </span>
        {status}
      </div>
      <p className="pr-paycheck__meta pr-small">
        {payer} · {time}
      </p>
      <SplitBar
        segments={segments}
        label={splitLabel}
        total={invested}
        viewTransitionName={viewTransitionName}
      />
      <p className="pr-small">{summary}</p>
    </div>
  );
}
