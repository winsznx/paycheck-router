"use client";

import type { SplitSegment } from "@paycheck-router/ui/components";
import { useMotionPreference } from "@paycheck-router/ui/motion";
import {
  duration,
  easing,
  SERIES_SLOTS,
  splitSpring,
  staggerDelay,
} from "@paycheck-router/ui/tokens";
import { domAnimation, LazyMotion, m } from "motion/react";
import type { CSSProperties } from "react";

type SplitSequenceProps = {
  /** e.g. "$1,850.00 USDC" */
  inflowText: string;
  /** e.g. "$370.00 invested" */
  investedText: string;
  investBps: number;
  segments: readonly SplitSegment[];
  label: string;
};

const s = (ms: number) => ms / 1000;

/**
 * PRD 15.3 "Paycheck split": the USDC bar enters, the invested share gains an accent outline,
 * splits into asset segments on the `split` spring, then labels fade in. Reduced motion shows
 * the final split at once with labels present.
 */
export function SplitSequence({
  inflowText,
  investedText,
  investBps,
  segments,
  label,
}: SplitSequenceProps) {
  const reduced = useMotionPreference() === "reduced";
  const segmentsStart = duration.base + duration.fast;
  const labelsAt = segmentsStart + staggerDelay(segments.length) + duration.slow;
  return (
    <LazyMotion features={domAnimation} strict>
      <m.figure
        className="split-seq"
        initial={reduced ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: s(duration.base), ease: easing.out }}
      >
        <figcaption className="split-seq__caption">
          <span className="pr-num">{inflowText}</span>
          <span className="pr-num split-seq__invested">{investedText}</span>
        </figcaption>
        <div className="split-seq__inflow" role="img" aria-label={label}>
          <m.div
            className="split-seq__share"
            style={{ inlineSize: `${Math.max(investBps / 100, 8)}%` }}
            initial={reduced ? false : { boxShadow: "inset 0 0 0 2px rgba(0,0,0,0)" }}
            animate={{ boxShadow: "inset 0 0 0 2px var(--accent)" }}
            transition={{ delay: s(duration.base), duration: s(duration.fast) }}
          >
            {segments.map((segment, index) => (
              <m.div
                key={segment.key}
                className="pr-split__seg"
                data-state={segment.state}
                style={
                  {
                    flexGrow: segment.weightBps,
                    "--seg": `var(--series-${Math.min(segment.colorSlot, SERIES_SLOTS)})`,
                    transformOrigin: "left center",
                  } as CSSProperties
                }
                initial={reduced ? false : { scaleX: 0, opacity: 0 }}
                animate={{ scaleX: 1, opacity: 1 }}
                transition={{ ...splitSpring, delay: s(segmentsStart + staggerDelay(index)) }}
              >
                <span className="pr-split__fill" />
                <span className="pr-split__hatch" />
              </m.div>
            ))}
          </m.div>
        </div>
        <m.ul
          className="pr-split__legend"
          aria-hidden="true"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: s(labelsAt), duration: s(duration.fast) }}
        >
          {segments.map((segment) => (
            <li
              key={segment.key}
              data-state={segment.state}
              style={{ "--seg": `var(--series-${segment.colorSlot})` } as CSSProperties}
            >
              <span translate="no">{segment.ticker}</span>
              <span>{segment.valueText}</span>
              {segment.stateText ? <span className="pr-muted">{segment.stateText}</span> : null}
            </li>
          ))}
        </m.ul>
      </m.figure>
    </LazyMotion>
  );
}
