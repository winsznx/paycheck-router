"use client";

import { formatUsdWhole } from "@paycheck-router/ui/format";
import { useLocale } from "next-intl";
import { useEffect, useRef, useState } from "react";

const DURATION_MS = 900;

function motionReduced(): boolean {
  return (
    document.documentElement.dataset.motion === "reduced" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * A figure that counts up once when it scrolls into view. The server renders the final value,
 * so readers without scripts, or with reduced motion, only ever see the real number.
 */
export function CountUp({
  value,
  format,
  className,
}: {
  value: number;
  format: "usd" | "integer";
  className?: string;
}) {
  const locale = useLocale();
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const element = ref.current;
    if (!element || motionReduced() || !("IntersectionObserver" in window)) return;
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min(1, (now - start) / DURATION_MS);
          setShown(value * (1 - (1 - progress) ** 3));
          if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {format === "usd" ? formatUsdWhole(Math.round(shown), locale) : Math.round(shown).toString()}
    </span>
  );
}
