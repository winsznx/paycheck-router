import type { CSSProperties } from "react";

export type AllowanceState = "healthy" | "low" | "revoked";

export type AllowanceMeterProps = {
  /** Remaining allowance in USDC (decimal number, display only). */
  remaining: number;
  /** One paycheck's worth of spend; draws one tick per paycheck. */
  perPaycheck: number;
  /** Scale of the bar, usually the approved allowance. */
  capacity: number;
  state: AllowanceState;
  label: string;
  /** Screen-reader value text, e.g. "370 of 1,500 USDC left, about 1 paycheck". */
  valueText: string;
  caption?: string | undefined;
  captionEnd?: string | undefined;
};

export function AllowanceMeter({
  remaining,
  perPaycheck,
  capacity,
  state,
  label,
  valueText,
  caption,
  captionEnd,
}: AllowanceMeterProps) {
  const safeCapacity = capacity > 0 ? capacity : 1;
  const ratio = state === "revoked" ? 0 : Math.min(Math.max(remaining / safeCapacity, 0), 1);
  const ticks = perPaycheck > 0 ? Math.min(Math.floor(safeCapacity / perPaycheck), 24) : 0;
  return (
    <div className="pr-meter" data-state={state}>
      <meter
        className="pr-sr-only"
        aria-label={label}
        aria-valuetext={valueText}
        min={0}
        max={safeCapacity}
        value={state === "revoked" ? 0 : Math.max(remaining, 0)}
      />
      <div className="pr-meter__bar" aria-hidden="true">
        <span
          className="pr-meter__fill"
          style={{ transform: `scaleX(${ratio})` } as CSSProperties}
        />
        {Array.from({ length: ticks }, (_, i) => {
          const at = ((i + 1) * perPaycheck) / safeCapacity;
          return at < 1 ? (
            <span
              key={at}
              className="pr-meter__tick"
              style={{ insetInlineStart: `${at * 100}%` }}
            />
          ) : null;
        })}
      </div>
      {caption || captionEnd ? (
        <div className="pr-meter__caption pr-small">
          <span>{caption}</span>
          <span className="pr-muted">{captionEnd}</span>
        </div>
      ) : null}
    </div>
  );
}
