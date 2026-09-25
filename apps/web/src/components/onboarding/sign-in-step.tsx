"use client";

import { Banner, Button } from "@paycheck-router/ui/components";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useProblemMessage } from "@/lib/problem-copy.ts";
import { signInWithWallet } from "@/lib/session.ts";
import { type SigningWallet, useWallets } from "@/lib/wallet/wallets.ts";
import { StepFrame } from "./step-frame.tsx";

export function SignInStep() {
  const t = useTranslations("onboarding.signIn");
  const wallets = useWallets();
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const problemMessage = useProblemMessage();

  async function signIn(wallet: SigningWallet) {
    setPending(wallet.name);
    setError(null);
    try {
      await signInWithWallet(wallet);
      router.push("/app/onboarding/eligibility");
    } catch (cause) {
      setError(problemMessage(cause, t("failed")));
    } finally {
      setPending(null);
    }
  }

  return (
    <StepFrame step="sign-in" title={t("title")} lead={t("lead")} actions={null}>
      {wallets.length === 0 ? (
        <Banner tone="info">{t("noWallets")}</Banner>
      ) : (
        <ul className="wallet-list">
          {wallets.map((wallet) => (
            <li key={wallet.name}>
              <Button
                variant="secondary"
                size="l"
                block
                onClick={() => signIn(wallet)}
                loadingLabel={pending === wallet.name ? t("signing") : undefined}
                disabled={pending !== null && pending !== wallet.name}
              >
                {/* biome-ignore lint/performance/noImgElement: wallet icons are data URIs from the wallet itself */}
                <img src={wallet.icon} alt="" width={24} height={24} />
                {t("connect", { wallet: wallet.name })}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="pr-small pr-muted">{t("siwsNote")}</p>
      {error ? (
        <Banner tone="danger" live="alert">
          {error}
        </Banner>
      ) : null}
    </StepFrame>
  );
}
