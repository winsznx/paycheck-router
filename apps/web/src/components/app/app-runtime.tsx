"use client";

import { ToastProvider } from "@paycheck-router/ui/components";
import { type ReactNode, useEffect } from "react";
import { DemoStatus } from "@/components/hosted/demo-status.tsx";
import { applyRealtimeEvent } from "@/lib/data.ts";
import { isHostedDemo } from "@/lib/env.ts";
import { onRealtimeEvent, retainRealtime } from "@/lib/realtime.ts";
import { useSession } from "@/lib/session.ts";

/** Registers the demo signer in demo builds only; the import is dead code everywhere else. */
function useDemoSigner() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ENVIRONMENT !== "demo") return;
    import("@/lib/wallet/demo-signer.ts")
      .then(({ registerDemoSigner }) => registerDemoSigner())
      .catch((error: unknown) => {
        console.error("Demo signer failed to register", error);
      });
  }, []);
}

/**
 * Registers the visitor's browser-generated fork wallet in hosted-demo builds only; no key is
 * fetched from anywhere, and the import is dead code in every other build.
 */
function useForkWallet() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ENVIRONMENT !== "hosted-demo") return;
    import("@/lib/wallet/fork-wallet.ts")
      .then(({ registerForkWallet }) => registerForkWallet())
      .catch((error: unknown) => {
        console.error("Fork wallet failed to register", error);
      });
  }, []);
}

/** Opens the realtime socket after first paint, only while signed in (PRD 16.7). */
function useRealtimeWhileSignedIn(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return;
    const offEvents = onRealtimeEvent(applyRealtimeEvent);
    const release = retainRealtime();
    return () => {
      offEvents();
      release();
    };
  }, [signedIn]);
}

export function AppRuntime({ children }: { children: ReactNode }) {
  const session = useSession();
  useDemoSigner();
  useForkWallet();
  useRealtimeWhileSignedIn(session.status === "signed-in");
  return (
    <ToastProvider>
      {isHostedDemo ? <DemoStatus /> : null}
      {children}
    </ToastProvider>
  );
}
