"use client";

import { Button, buttonClassName } from "@paycheck-router/ui/components";
import { useMotionPreference } from "@paycheck-router/ui/motion";
import {
  duration,
  easing,
  onboardingWelcomeMs,
  splitSpring,
  staggerDelay,
} from "@paycheck-router/ui/tokens";
import { domAnimation, LazyMotion, m } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type CSSProperties, useState } from "react";
import { useSession } from "@/lib/session.ts";
import { StepFrame } from "./step-frame.tsx";

const s = (ms: number) => ms / 1000;
const FRAME = onboardingWelcomeMs / 3;
const SLOTS = [1, 2, 3] as const;
const GROWS = [6, 3, 1] as const;

/** PRD 15.3 onboarding welcome: paycheck lands, splits, fills; 2.4 s once, with replay. */
function WelcomeMotif({ run }: { run: number }) {
  const reduced = useMotionPreference() === "reduced";
  return (
    <LazyMotion features={domAnimation} strict>
      <div className="welcome-motif" aria-hidden="true" key={run}>
        <m.div
          className="welcome-motif__paycheck"
          initial={reduced ? false : { y: -16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: s(duration.base), ease: easing.out }}
        />
        <div className="welcome-motif__split">
          {SLOTS.map((slot, index) => (
            <m.div
              key={slot}
              className="welcome-motif__seg"
              style={{ flexGrow: GROWS[index], "--seg": `var(--series-${slot})` } as CSSProperties}
              initial={reduced ? false : { scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ ...splitSpring, delay: s(FRAME + staggerDelay(index)) }}
            >
              <m.span
                className="welcome-motif__fill"
                initial={reduced ? false : { scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{
                  duration: s(duration.slow),
                  ease: easing.out,
                  delay: s(FRAME * 2 + staggerDelay(index)),
                }}
              />
            </m.div>
          ))}
        </div>
      </div>
    </LazyMotion>
  );
}

export function WelcomeStep() {
  const t = useTranslations("onboarding.welcome");
  const session = useSession();
  const [run, setRun] = useState(0);
  const next =
    session.status === "signed-in" ? "/app/onboarding/eligibility" : "/app/onboarding/sign-in";
  return (
    <StepFrame
      step="welcome"
      title={t("title")}
      lead={t("lead")}
      actions={
        <Link href={next} className={buttonClassName({ size: "l", block: true })}>
          {t("start")}
        </Link>
      }
    >
      <WelcomeMotif run={run} />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="pr-small pr-muted">{t("time")}</p>
        <Button variant="ghost" size="s" onClick={() => setRun((n) => n + 1)}>
          {t("replay")}
        </Button>
      </div>
    </StepFrame>
  );
}
