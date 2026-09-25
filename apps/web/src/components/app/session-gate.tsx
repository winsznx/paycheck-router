"use client";

import { Skeleton } from "@paycheck-router/ui/components";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { useSession } from "@/lib/session.ts";

/** Signed-out visitors go to sign-in; restoring shows the final layout as skeletons. */
export function SessionGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session.status === "signed-out") router.replace("/app/onboarding/welcome");
  }, [session.status, router]);

  if (session.status !== "signed-in") {
    return (
      <div className="stack" aria-hidden="true">
        <Skeleton height={120} />
        <Skeleton height={200} />
        <Skeleton height={160} />
      </div>
    );
  }
  return children;
}
