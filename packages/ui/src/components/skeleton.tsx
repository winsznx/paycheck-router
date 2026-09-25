import type { CSSProperties } from "react";

export type SkeletonProps = {
  width?: CSSProperties["inlineSize"];
  height: CSSProperties["blockSize"];
  className?: string | undefined;
};

/** Blocks that match the final layout; the shimmer stops under reduced motion. */
export function Skeleton({ width = "100%", height, className }: SkeletonProps) {
  return (
    <span
      className={["pr-skeleton", className].filter(Boolean).join(" ")}
      style={{ inlineSize: width, blockSize: height }}
      aria-hidden="true"
    />
  );
}
