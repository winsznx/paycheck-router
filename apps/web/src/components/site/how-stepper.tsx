"use client";

import { type ReactNode, useId, useState } from "react";

export type HowStep = { key: string; title: string; body: string; panel: ReactNode };

/**
 * The three steps as a numbered list; choosing one shows what that step looked like in the
 * recorded run. Panels are rendered on the server, so every figure is the run's own.
 */
export function HowStepper({ steps, label }: { steps: readonly HowStep[]; label: string }) {
  const [active, setActive] = useState(0);
  const panelId = useId();
  const current = steps[active] ?? steps[0];
  return (
    <div className="how-stepper">
      <ol className="how-stepper__list" aria-label={label}>
        {steps.map((step, index) => (
          <li key={step.key}>
            <button
              type="button"
              className="how-step"
              aria-pressed={index === active}
              aria-controls={panelId}
              onClick={() => setActive(index)}
            >
              <span className="how-step__number" aria-hidden="true">
                {index + 1}
              </span>
              <span className="how-step__text">
                <span className="how-step__title">{step.title}</span>
                <span className="how-step__body">{step.body}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div id={panelId} className="how-stepper__panel" aria-live="polite">
        {current?.panel}
      </div>
    </div>
  );
}
