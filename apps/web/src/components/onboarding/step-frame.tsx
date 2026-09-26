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

/** Full-screen step with a segmented progress stepper, a centred 560 px card from tablet up. */
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
        <ol className="onboarding-steps" aria-hidden="true">
          {STEPS.map((name, position) => (
            <li
              key={name}
              data-state={position < index ? "done" : position === index ? "current" : "todo"}
            />
          ))}
        </ol>
        <p className="onboarding-progress__label" aria-hidden="true">
          <span className="pr-label pr-muted">
            {t("progress", { current: index + 1, total: STEPS.length })}
          </span>
          <span>{t(`stepName.${step}`)}</span>
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
