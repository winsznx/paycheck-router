"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { ApiProblem } from "./api/problem.ts";
import { asWalletProblem } from "./wallet/wallets.ts";

/** Plain-language groups for API problems; each has one sentence and one action in `problems`. */
export type ProblemKind =
  | "notConfigured"
  | "rateLimited"
  | "signedOut"
  | "notAllowed"
  | "ineligible"
  | "invalid"
  | "upstream"
  | "offline"
  | "internal";

/** The copy group for an API problem, or null for anything that isn't one (e.g. a wallet error). */
export function problemKind(error: unknown): ProblemKind | null {
  if (!(error instanceof ApiProblem)) return null;
  switch (error.code) {
    case "not_configured":
      return "notConfigured";
    case "rate_limited":
      return "rateLimited";
    case "unauthorized":
      return "signedOut";
    case "forbidden":
      return "notAllowed";
    case "ineligible":
      return "ineligible";
    case "bad_request":
    case "validation_failed":
    case "conflict":
    case "idempotency_conflict":
    case "not_found":
      return "invalid";
    case "upstream_unavailable":
    case "chain_error":
      return "upstream";
    case "offline":
      return "offline";
    default:
      return error.status === 0 ? "offline" : error.status >= 500 ? "upstream" : "internal";
  }
}

/**
 * Turns a caught error into copy a person can act on. The technical detail goes to the console
 * only: problem `detail`, stack traces and upstream names never reach the page.
 */
export function useProblemMessage(): (error: unknown, fallback: string) => string {
  const t = useTranslations("problems");
  return useCallback(
    (error: unknown, fallback: string) => {
      console.error(error);
      const wallet = asWalletProblem(error, null);
      if (wallet) {
        return t(`wallet.${wallet.kind}`, {
          wallet: wallet.walletName ?? t("wallet.yourWallet"),
          address: wallet.expectedAddress
            ? `${wallet.expectedAddress.slice(0, 4)}…${wallet.expectedAddress.slice(-4)}`
            : "",
        });
      }
      const kind = problemKind(error);
      return kind ? t(kind) : fallback;
    },
    [t],
  );
}
