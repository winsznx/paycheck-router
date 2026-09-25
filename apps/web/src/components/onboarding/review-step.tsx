"use client";

import { api } from "@paycheck-router/shared";
import { Banner, Button, Skeleton, StatusChip } from "@paycheck-router/ui/components";
import { formatUsdWhole } from "@paycheck-router/ui/format";
import { type Base64EncodedWireTransaction, createSolanaRpc } from "@solana/kit";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api/client.ts";
import { fetchers, keys } from "@/lib/data.ts";
import { rpcUrl } from "@/lib/env.ts";
import { usdc } from "@/lib/money.ts";
import {
  allowanceBaseUnits,
  DEFAULT_MAX_WAIT_SECS,
  type Draft,
  toBaseUnits,
  useDraft,
} from "@/lib/onboarding.ts";
import { fetchQuery } from "@/lib/query.ts";
import { useSession } from "@/lib/session.ts";
import { signAndSubmit } from "@/lib/wallet/sign-and-submit.ts";
import { StepFrame } from "./step-frame.tsx";

type Simulation = { state: "running" } | { state: "passed" } | { state: "failed"; logs: string[] };

function buildRequest(draft: Draft, wallet: string): api.CreateRouterTxRequest | null {
  const allowance = allowanceBaseUnits(draft);
  const minInflow = toBaseUnits(draft.minInflowUsdc);
  const paycheck = toBaseUnits(draft.typicalPaycheckUsdc);
  if (!allowance || !minInflow || draft.legs.length === 0) return null;
  return {
    wallet,
    investBps: draft.investBps,
    legs: draft.legs.map(({ mint, weightBps, bandBps }) => ({ mint, weightBps, bandBps })),
    minInflow,
    // Daily cap: the larger of the allowance and ten typical paychecks, inside the program's caps.
    dailyCap:
      paycheck && BigInt(paycheck) * 10n > BigInt(allowance)
        ? (BigInt(paycheck) * 10n).toString()
        : allowance,
    maxWaitSecs: DEFAULT_MAX_WAIT_SECS,
    autoConvert: true,
    allowance,
  };
}

async function simulate(tx: string): Promise<Simulation> {
  const rpc = createSolanaRpc(rpcUrl);
  const { value } = await rpc
    .simulateTransaction(tx as Base64EncodedWireTransaction, {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: "confirmed",
    })
    .send();
  return value.err === null
    ? { state: "passed" }
    : { state: "failed", logs: [...(value.logs ?? [])].slice(-12) };
}

/** Counts down to the quote's expiry so nothing submits on a stale build (WCAG 2.2.1). */
function useSecondsLeft(expiresAt: string | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000)) : null;
}

export function ReviewStep() {
  const t = useTranslations("onboarding.review");
  const locale = useLocale();
  const router = useRouter();
  const draft = useDraft();
  const session = useSession();
  const wallet = session.status === "signed-in" ? session.session.wallet : null;
  const walletName = session.status === "signed-in" ? session.walletName : null;
  const [built, setBuilt] = useState<api.TxBuildResponse | null>(null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const secondsLeft = useSecondsLeft(built?.expiresAt);
  const request = wallet ? buildRequest(draft, wallet) : null;
  const requestKey = request ? JSON.stringify(request) : null;

  const prepare = useCallback(
    async (body: api.CreateRouterTxRequest) => {
      setError(null);
      setBuilt(null);
      setSimulation(null);
      try {
        const result = await apiRequest("/routers/tx/create", api.TxBuildResponse, {
          method: "POST",
          body,
        });
        setBuilt(result);
        setSimulation({ state: "running" });
        setSimulation(await simulate(result.tx));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t("buildFailed"));
      }
    },
    [t],
  );

  // Builds the setup transaction for this exact draft; no funds move until the user signs.
  useEffect(() => {
    if (!requestKey) return;
    void prepare(JSON.parse(requestKey) as api.CreateRouterTxRequest);
  }, [requestKey, prepare]);

  async function signAndGoLive() {
    if (!built) return;
    setSigning(true);
    setError(null);
    try {
      const result = await signAndSubmit(walletName, built, "router.create");
      if (result.status === "failed" || result.status === "expired") {
        setError(result.error ?? t("submitFailed"));
        return;
      }
      await fetchQuery(keys.routers, fetchers.routers);
      router.push("/app/onboarding/done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("submitFailed"));
    } finally {
      setSigning(false);
    }
  }

  const expired = secondsLeft === 0;
  const ready = built !== null && simulation?.state === "passed" && !expired;
  const allowance = allowanceBaseUnits(draft);

  return (
    <StepFrame
      step="review"
      title={t("title")}
      lead={t("lead")}
      actions={
        <div className="stack">
          <Button
            size="l"
            block
            disabled={!ready}
            onClick={signAndGoLive}
            loadingLabel={signing ? t("signing") : undefined}
          >
            {t("sign")}
          </Button>
          {expired && request ? (
            <Button variant="ghost" block onClick={() => prepare(request)}>
              {t("refresh")}
            </Button>
          ) : null}
        </div>
      }
    >
      {!request ? <Banner tone="warn">{t("incomplete")}</Banner> : null}
      {request && !built && !error ? <Skeleton height={160} /> : null}
      {built ? (
        <section className="pr-card stack" aria-labelledby="summary-title">
          <h2 id="summary-title" className="pr-h3">
            {t("summary")}
          </h2>
          <ul className="summary-list">
            {built.summary.map((line) => (
              <li key={line} className="pr-body">
                {line}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {allowance ? (
        <p className="pr-body">
          {t("signatureDoes", { amount: formatUsdWhole(usdc(allowance), locale) })}
        </p>
      ) : null}
      <p className="pr-small pr-muted">{t("fees")}</p>
      <div className="row" aria-live="polite">
        {simulation?.state === "running" ? (
          <StatusChip status="executing" label={t("simulating")} />
        ) : null}
        {simulation?.state === "passed" ? (
          <StatusChip status="verified" label={t("simulated")} />
        ) : null}
        {simulation?.state === "failed" ? (
          <StatusChip status="unverified" label={t("simulationFailed")} />
        ) : null}
        {secondsLeft !== null && !expired ? (
          <span className="pr-small pr-muted">{t("expiresIn", { seconds: secondsLeft })}</span>
        ) : null}
        {expired ? <span className="pr-small">{t("expired")}</span> : null}
      </div>
      {simulation?.state === "failed" ? (
        <figure className="stack">
          <figcaption className="pr-small pr-muted">{t("logs")}</figcaption>
          <pre className="logs pr-code">{simulation.logs.join("\n")}</pre>
        </figure>
      ) : null}
      {error ? (
        <Banner tone="danger" live="alert">
          {error}
        </Banner>
      ) : null}
    </StepFrame>
  );
}
