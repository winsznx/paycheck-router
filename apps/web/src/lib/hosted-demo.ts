"use client";

import { api } from "@paycheck-router/shared";
import { useEffect, useState } from "react";
import { apiRequest } from "./api/client.ts";
import { apiUrl } from "./env.ts";
import { clearDraft } from "./onboarding.ts";
import { clearQueries } from "./query.ts";
import { signOut } from "./session.ts";

/** Fork calls the hosted demo core adds (fork-only; they don't exist on mainnet). */

/** The paycheck amount the demo sends unless the visitor picks another, in whole USDC. */
export const DEFAULT_PAYCHECK_USDC = 1850;
export const MIN_PAYCHECK_USDC = 20;
export const MAX_PAYCHECK_USDC = 5000;

export type DemoStatusState =
  | { status: "loading" }
  | { status: "ready"; data: api.DemoStatus }
  | { status: "unreachable" };

const STATUS_POLL_MS = 60_000;
/** The fork reset this browser's wallet, draft and session belong to. */
const EPOCH_KEY = "pr_fork_epoch";

export async function fetchDemoStatus(): Promise<api.DemoStatus> {
  const response = await fetch(`${apiUrl}/demo/status`, { cache: "no-store" });
  if (!response.ok) throw new Error(`demo status ${response.status}`);
  return api.DemoStatus.parse(await response.json());
}

/** Polls /demo/status; `unreachable` covers network errors and anything but a valid answer. */
export function useDemoStatus(): DemoStatusState {
  const [state, setState] = useState<DemoStatusState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchDemoStatus()
        .then((data) => {
          if (!cancelled) setState({ status: "ready", data });
        })
        .catch((error: unknown) => {
          console.error("Demo status unavailable", error);
          if (!cancelled) setState({ status: "unreachable" });
        });
    void load();
    const timer = window.setInterval(load, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return state;
}

function readEpoch(): string | null {
  try {
    return window.localStorage.getItem(EPOCH_KEY);
  } catch {
    return null;
  }
}

function writeEpoch(value: string) {
  try {
    window.localStorage.setItem(EPOCH_KEY, value);
  } catch {
    // Private windows can refuse storage; the reset check then runs on every visit, harmlessly.
  }
}

/**
 * After a fork reset every router, balance and paycheck this browser knew about is gone. When
 * the fork's last reset is newer than the one this browser started under, end the session,
 * drop the onboarding draft and cached reads, and start onboarding again. The wallet key stays:
 * it's funded afresh on the new fork.
 */
export async function forgetStateFromEarlierFork(
  status: api.DemoStatus,
): Promise<"current" | "reset"> {
  if (!status.lastResetAt) return "current";
  const known = readEpoch();
  writeEpoch(status.lastResetAt);
  if (known === null || known === status.lastResetAt) return "current";
  clearDraft();
  clearQueries();
  await signOut();
  return "reset";
}

export function fundForkWallet(): Promise<api.DemoFundResponse> {
  return apiRequest("/demo/fund", api.DemoFundResponse, { method: "POST" });
}

export function sendForkPaycheck(amountUsdc: number): Promise<api.DemoPaycheckResponse> {
  const body: api.DemoPaycheckRequest = { amountUsdc: String(Math.round(amountUsdc * 1_000_000)) };
  return apiRequest("/demo/paycheck", api.DemoPaycheckResponse, { method: "POST", body });
}

/** Simulates on the hosted fork through core, which holds the only copy of the fork RPC. */
export async function simulateOnFork(tx: string): Promise<{ ok: boolean; logs: string[] }> {
  const body: api.DemoSimulateRequest = { transaction: tx };
  const result = await apiRequest("/demo/simulate", api.DemoSimulateResponse, {
    method: "POST",
    body,
  });
  return { ok: result.ok, logs: result.error ? [...result.logs, result.error] : result.logs };
}
