"use client";

import { Button } from "@paycheck-router/ui/components";
import { truncateMiddle } from "@paycheck-router/ui/format";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { signOut, useSession } from "@/lib/session.ts";

/** PRD 13.4 Settings > security: the signed-in wallet and sign out. */
export function SecuritySection() {
  const t = useTranslations("app.settings.security");
  const session = useSession();
  const [pending, setPending] = useState(false);
  const wallet = session.status === "signed-in" ? session.session.wallet : null;
  return (
    <section className="stack-lg" aria-labelledby="security-title">
      <h2 id="security-title" className="pr-h2">
        {t("title")}
      </h2>
      <div className="pr-card stack">
        <p className="pr-body">
          {wallet ? t("signedInAs", { wallet: truncateMiddle(wallet) }) : t("signedOut")}
        </p>
        {session.status === "signed-in" && session.walletName ? (
          <p className="pr-small pr-muted">{t("via", { wallet: session.walletName })}</p>
        ) : null}
        <p>
          <Button
            variant="secondary"
            loadingLabel={pending ? t("signingOut") : undefined}
            onClick={async () => {
              setPending(true);
              await signOut();
              window.location.assign("/");
            }}
          >
            {t("signOut")}
          </Button>
        </p>
      </div>
    </section>
  );
}
