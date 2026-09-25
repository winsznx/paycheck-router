import type { ReactNode } from "react";

export type EmptyStateProps = {
  children: ReactNode;
  action?: ReactNode;
};

/** Line-art built from the split-bar motif, one sentence, one action. */
export function EmptyState({ children, action }: EmptyStateProps) {
  return (
    <div className="pr-empty">
      <span className="pr-empty__art" aria-hidden="true">
        <span style={{ blockSize: 16 }} />
        <span style={{ blockSize: 26 }} />
        <span style={{ blockSize: 40 }} />
      </span>
      <p className="pr-body">{children}</p>
      {action}
    </div>
  );
}
