import type { ReactNode } from "react";

export type SliceFact = { key: string; term: string; value: ReactNode };

export type SliceRowProps = {
  asset: ReactNode;
  usdcIn: ReactNode;
  status: ReactNode;
  /** "+0.4113 SPYx" rises into place when a slice executes (PRD 15.3). */
  delivered?: ReactNode;
  priceCheck?: ReactNode;
  facts: readonly SliceFact[];
  /** Waiting slices: reason sentence, next attempt and actions. */
  reason?: ReactNode;
  footer?: ReactNode;
};

/** Asset chip, USDC in, shares, prices, premium, fee, status and tx link (PRD 13.4, 14.6). */
export function SliceRow({
  asset,
  usdcIn,
  status,
  delivered,
  priceCheck,
  facts,
  reason,
  footer,
}: SliceRowProps) {
  return (
    <li className="pr-slice">
      <div className="pr-slice__main">
        {asset}
        <span className="pr-num">{usdcIn}</span>
      </div>
      <div className="pr-slice__side">
        {status}
        {delivered ? <span className="pr-num pr-slice__rise">{delivered}</span> : null}
        {priceCheck}
      </div>
      {facts.length > 0 ? (
        <dl className="pr-slice__facts">
          {facts.map((fact) => (
            <div key={fact.key}>
              <dt>{fact.term}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {reason ? <div className="pr-slice__reason">{reason}</div> : null}
      {footer}
    </li>
  );
}
