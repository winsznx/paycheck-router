import type { CSSProperties, ReactNode } from "react";
import { type SeriesSlot, seriesVar } from "../tokens/series.ts";

/**
 * planned: outline only; filling: executing; filled: executed or verified;
 * waiting: 45° warn hatch; empty: expired or cancelled (the USDC never moved).
 */
export type SegmentState = "planned" | "filling" | "filled" | "waiting" | "empty";

export type SplitSegment = {
  key: string;
  ticker: string;
  weightBps: number;
  colorSlot: SeriesSlot;
  state: SegmentState;
  /** Legend text after the ticker, e.g. "70%" or "$259.00". */
  valueText: string;
  /** Extra legend text for waiting segments, e.g. "Waiting". */
  stateText?: string | undefined;
};

export type SplitBarProps = {
  segments: readonly SplitSegment[];
  /** Accessible name listing every segment: "SPYx 70%, NVDAx 20%, Anthropic 10%" (PRD 17.1). */
  label: string;
  total?: ReactNode;
  totalCaption?: ReactNode;
  /** Pairs the bar with a paycheck header morph (PRD 15.3 route change). */
  viewTransitionName?: string | undefined;
};

export function splitBarLabel(
  segments: readonly Pick<SplitSegment, "ticker" | "valueText" | "stateText">[],
): string {
  return segments
    .map((s) => [s.ticker, s.valueText, s.stateText].filter(Boolean).join(" "))
    .join(", ");
}

export function SplitBar({
  segments,
  label,
  total,
  totalCaption,
  viewTransitionName,
}: SplitBarProps) {
  return (
    <figure className="pr-split">
      {total !== undefined ? (
        <figcaption className="pr-split__total">
          <span className="pr-num">{total}</span>
          {totalCaption ? <span className="pr-small pr-muted">{totalCaption}</span> : null}
        </figcaption>
      ) : null}
      <div
        className="pr-split__track"
        role="img"
        aria-label={label}
        style={viewTransitionName ? ({ viewTransitionName } as CSSProperties) : undefined}
      >
        {segments.map((segment) => (
          <div
            key={segment.key}
            className="pr-split__seg"
            data-state={segment.state}
            style={
              {
                flexGrow: segment.weightBps,
                "--seg": seriesVar(segment.colorSlot),
              } as CSSProperties
            }
          >
            <span className="pr-split__fill" />
            <span className="pr-split__hatch" />
          </div>
        ))}
      </div>
      <ul className="pr-split__legend" aria-hidden="true">
        {segments.map((segment) => (
          <li
            key={segment.key}
            data-state={segment.state}
            style={{ "--seg": seriesVar(segment.colorSlot) } as CSSProperties}
          >
            <span translate="no">{segment.ticker}</span>
            <span>{segment.valueText}</span>
            {segment.stateText ? <span className="pr-muted">{segment.stateText}</span> : null}
          </li>
        ))}
      </ul>
    </figure>
  );
}
