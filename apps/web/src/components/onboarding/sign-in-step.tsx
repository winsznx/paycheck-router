"use client";

import { Banner, Button } from "@paycheck-router/ui/components";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { nextStepHref } from "@/lib/onboarding-steps.ts";
import { useProblemMessage } from "@/lib/problem-copy.ts";
import { signInWithWallet } from "@/lib/session.ts";
import { type SigningWallet, useWallets } from "@/lib/wallet/wallets.ts";
import { StepFrame } from "./step-frame.tsx";

/** Kept in sync with lib/wallet/fork-wallet.ts, which only hosted-demo builds load. */
const FORK_WALLET_NAME = "Fork demo wallet";

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
      router.push(nextStepHref("sign-in"));
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
              {wallet.name === FORK_WALLET_NAME ? (
                <p className="pr-small pr-muted">{t("forkWallet")}</p>
              ) : null}
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
