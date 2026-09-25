"use client";

import { Button, buttonClassName } from "@paycheck-router/ui/components";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useSession } from "@/lib/session.ts";
import { StepFrame } from "./step-frame.tsx";

const WelcomeMotif = dynamic(() => import("./welcome-motif.tsx").then((mod) => mod.WelcomeMotif), {
  loading: () => <div className="welcome-motif" aria-hidden="true" />,
});

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
