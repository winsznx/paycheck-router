"use client";

import { AddressField, Banner, Button, QrCode, Skeleton } from "@paycheck-router/ui/components";
import { formatUsd } from "@paycheck-router/ui/format";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { fetchers, keys } from "@/lib/data.ts";
import { explorerUrl } from "@/lib/env.ts";
import { usdc } from "@/lib/money.ts";
import { updateDraft } from "@/lib/onboarding.ts";
import { useQuery } from "@/lib/query.ts";
import { useSession } from "@/lib/session.ts";
import { StepFrame } from "./step-frame.tsx";

export function WalletStep() {
  const t = useTranslations("onboarding.wallet");
  const locale = useLocale();
  const router = useRouter();
  const session = useSession();
  const wallets = useQuery(keys.wallets, fetchers.wallets);
  const address = session.status === "signed-in" ? session.session.wallet : null;
  const wallet = wallets.data?.wallets.find((w) => w.address === address);
  const flagged = wallet?.sanctionsStatus === "flagged";

  return (
    <StepFrame
      step="wallet"
      title={t("title")}
      lead={t("lead")}
      actions={
        <Button
          size="l"
          block
          disabled={!address || flagged}
          onClick={() => {
            updateDraft({ wallet: address });
            router.push("/app/onboarding/pay-history");
          }}
        >
          {t("confirm")}
        </Button>
      }
    >
      <fieldset className="stack option-group">
        <legend className="pr-h3">{t("question")}</legend>
        <div className="pr-card stack" data-selected="true">
          <p className="pr-body">{t("thisWallet")}</p>
          {address ? (
            <>
              <AddressField
                address={address}
                label={t("address")}
                copyLabel={t("copy")}
                copiedLabel={t("copied")}
                explorerHref={explorerUrl("address", address)}
                explorerLabel={t("explorer")}
              />
              <QrCode value={address} label={t("qr")} />
            </>
          ) : (
            <Skeleton height={44} />
          )}
          {wallet ? (
            <p className="pr-small pr-muted">
              {t("balance", { amount: formatUsd(usdc(wallet.usdcBalance), locale) })}
            </p>
          ) : null}
        </div>
      </fieldset>
      <p className="pr-small pr-muted">{t("payoutGuide")}</p>
      {flagged ? (
        <Banner tone="danger" live="alert">
          {t("sanctioned")}
        </Banner>
      ) : null}
    </StepFrame>
  );
}
