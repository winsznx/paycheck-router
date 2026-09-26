"use client";

import { Skeleton } from "@paycheck-router/ui/components";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Step } from "@/lib/onboarding-steps.ts";
import { useSession } from "@/lib/session.ts";
import { AllowanceStep } from "./allowance-step.tsx";
import { DoneStep } from "./done-step.tsx";
import { EligibilityStep } from "./eligibility-step.tsx";
import { FundStep } from "./fund-step.tsx";
import { PayHistoryStep } from "./pay-history-step.tsx";
import { ReviewStep } from "./review-step.tsx";
import { SignInStep } from "./sign-in-step.tsx";
import { SplitStep } from "./split-step.tsx";
import { WalletStep } from "./wallet-step.tsx";
import { WelcomeStep } from "./welcome-step.tsx";

const PUBLIC_STEPS: readonly Step[] = ["welcome", "sign-in"];

const STEP_VIEWS: Record<Step, () => React.JSX.Element> = {
  welcome: WelcomeStep,
  "sign-in": SignInStep,
  fund: FundStep,
  eligibility: EligibilityStep,
  wallet: WalletStep,
  "pay-history": PayHistoryStep,
  split: SplitStep,
  allowance: AllowanceStep,
  review: ReviewStep,
  done: DoneStep,
};

export function OnboardingFlow({ step }: { step: Step }) {
  const session = useSession();
  const router = useRouter();
  const needsSession = !PUBLIC_STEPS.includes(step);

  useEffect(() => {
    if (needsSession && session.status === "signed-out") router.replace("/app/onboarding/sign-in");
  }, [needsSession, session.status, router]);

  if (needsSession && session.status !== "signed-in") {
    return (
      <div className="onboarding-card stack" aria-busy="true">
        <Skeleton height={40} />
        <Skeleton height={220} />
      </div>
    );
  }
  const View = STEP_VIEWS[step];
  return <View />;
}
