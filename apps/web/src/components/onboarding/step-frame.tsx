"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { STEPS, type Step } from "@/lib/onboarding-steps.ts";

type StepFrameProps = {
  step: Step;
  title: string;
  lead?: string | undefined;
  children: ReactNode;
  /** The primary action, pinned to the bottom on short viewports (PRD 16.1). */
  actions: ReactNode;
};

/** Full-screen step with a progress bar on phones, a centred 560 px card from tablet up. */
export function StepFrame({ step, title, lead, children, actions }: StepFrameProps) {
  const t = useTranslations("onboarding");
  const index = STEPS.indexOf(step);
  return (
    <section className="onboarding-card" aria-labelledby="step-title">
      <div className="onboarding-progress">
        <progress
          className="pr-sr-only"
          value={index + 1}
          max={STEPS.length}
          aria-label={t("progress", { current: index + 1, total: STEPS.length })}
        />
        <div className="onboarding-progress__bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${(index + 1) / STEPS.length})` }} />
        </div>
        <p className="pr-label pr-muted" aria-hidden="true">
          {t("progress", { current: index + 1, total: STEPS.length })}
        </p>
      </div>
      <div className="stack">
        <h1 id="step-title" className="pr-h1">
          {title}
        </h1>
        {lead ? <p className="pr-body-l pr-muted">{lead}</p> : null}
      </div>
      <div className="stack-lg onboarding-body">{children}</div>
      <div className="onboarding-actions">{actions}</div>
    </section>
  );
}
