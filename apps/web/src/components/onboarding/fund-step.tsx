"use client";

import type { api } from "@paycheck-router/shared";
import { Banner, Button } from "@paycheck-router/ui/components";
import { formatUsdWhole } from "@paycheck-router/ui/format";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { ForkWalletPanel } from "@/components/hosted/fork-wallet-panel.tsx";
import { ApiProblem } from "@/lib/api/problem.ts";
import { fundForkWallet } from "@/lib/hosted-demo.ts";
import { usdc } from "@/lib/money.ts";
import { nextStepHref } from "@/lib/onboarding-steps.ts";
import { useProblemMessage } from "@/lib/problem-copy.ts";
import { StepFrame } from "./step-frame.tsx";

const LAMPORTS_PER_SOL = 1_000_000_000;

/** Hosted demo only: the new browser wallet gets fork USDC and SOL before setting up a router. */
export function FundStep() {
  const t = useTranslations("onboarding.fund");
  const locale = useLocale();
  const router = useRouter();
  const problemMessage = useProblemMessage();
  const [pending, setPending] = useState(false);
  const [funded, setFunded] = useState<api.DemoFundResponse | "earlier" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fund() {
    setPending(true);
    setError(null);
    try {
      setFunded(await fundForkWallet());
    } catch (cause) {
      // Core answers conflict when this wallet was already funded on the current fork.
      if (cause instanceof ApiProblem && cause.code === "conflict") setFunded("earlier");
      else setError(problemMessage(cause, t("failed")));
    } finally {
      setPending(false);
    }
  }

  return (
    <StepFrame
      step="fund"
      title={t("title")}
      lead={t("lead")}
      actions={
        funded ? (
          <Button size="l" block onClick={() => router.push(nextStepHref("fund"))}>
            {t("continue")}
          </Button>
        ) : (
          <Button size="l" block onClick={fund} loadingLabel={pending ? t("funding") : undefined}>
            {t("fund")}
          </Button>
        )
      }
    >
      {funded === "earlier" ? (
        <Banner tone="info" live="status">
          {t("already")}
        </Banner>
      ) : funded ? (
        <Banner tone="info" live="status">
          {t("done", {
            usdc: formatUsdWhole(usdc(funded.usdc), locale),
            sol: new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(
              Number(funded.lamports) / LAMPORTS_PER_SOL,
            ),
          })}
        </Banner>
      ) : null}
      {error ? (
        <Banner tone="danger" live="alert">
          {error}
        </Banner>
      ) : null}
      <ForkWalletPanel />
    </StepFrame>
  );
}
