"use client";

import { Banner, Button, Sheet } from "@paycheck-router/ui/components";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ChainValue } from "@/components/chain-value.tsx";
import { clearDraft } from "@/lib/onboarding.ts";
import { clearQueries } from "@/lib/query.ts";
import { signOut, useSession } from "@/lib/session.ts";

/**
 * The hosted demo's browser wallet: what it is, its address, and export and reset. The fork
 * wallet module is loaded only when asked, and only in hosted-demo builds.
 */
export function ForkWalletPanel() {
  const t = useTranslations("hosted.wallet");
  const session = useSession();
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const address = session.status === "signed-in" ? session.session.wallet : null;

  async function reveal() {
    setError(null);
    try {
      const { exportForkWalletSecret } = await import("@/lib/wallet/fork-wallet.ts");
      setSecret(await exportForkWalletSecret());
    } catch (cause) {
      console.error("Fork wallet export failed", cause);
      setError(t("exportFailed"));
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const { resetForkWallet } = await import("@/lib/wallet/fork-wallet.ts");
      await resetForkWallet();
      clearDraft();
      clearQueries();
      await signOut();
      window.location.assign("/app/onboarding/welcome");
    } catch (cause) {
      console.error("Fork wallet reset failed", cause);
      setError(t("resetFailed"));
      setBusy(false);
    }
  }

  return (
    <section className="pr-card stack" aria-labelledby="fork-wallet-title">
      <h2 id="fork-wallet-title" className="pr-h3">
        {t("title")}
      </h2>
      <p className="pr-body">{t("body")}</p>
      {address ? <ChainValue kind="account" value={address} name={t("address")} /> : null}
      <div className="row">
        <Button variant="secondary" size="s" onClick={reveal}>
          {t("export")}
        </Button>
        <Button variant="ghost" size="s" onClick={() => setConfirmReset(true)}>
          {t("reset")}
        </Button>
      </div>
      {error ? (
        <Banner tone="danger" live="alert">
          {error}
        </Banner>
      ) : null}
      <Sheet
        open={secret !== null}
        onClose={() => setSecret(null)}
        title={t("exportTitle")}
        closeLabel={t("close")}
      >
        <div className="stack">
          <p className="pr-body">{t("exportBody")}</p>
          {secret ? <pre className="pr-code logs fork-secret">{secret}</pre> : null}
        </div>
      </Sheet>
      <Sheet
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title={t("resetTitle")}
        closeLabel={t("close")}
      >
        <div className="stack">
          <p className="pr-body">{t("resetBody")}</p>
          <Button
            variant="danger"
            block
            onClick={reset}
            loadingLabel={busy ? t("resetting") : undefined}
          >
            {t("resetConfirm")}
          </Button>
        </div>
      </Sheet>
    </section>
  );
}
