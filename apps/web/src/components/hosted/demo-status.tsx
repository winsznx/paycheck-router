"use client";

import { Banner } from "@paycheck-router/ui/components";
import { formatTime } from "@paycheck-router/ui/format";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { forgetStateFromEarlierFork, useDemoStatus } from "@/lib/hosted-demo.ts";

/**
 * Hosted demo: the fork's state in one calm line. When the fork has reset since this browser
 * last used it, the old session and draft are dropped and onboarding starts again.
 */
export function DemoStatus() {
  const t = useTranslations("hosted.status");
  const locale = useLocale();
  const router = useRouter();
  const status = useDemoStatus();
  const [wasReset, setWasReset] = useState(false);
  const data = status.status === "ready" ? status.data : null;

  useEffect(() => {
    if (!data) return;
    forgetStateFromEarlierFork(data)
      .then((outcome) => {
        if (outcome !== "reset") return;
        setWasReset(true);
        router.replace("/app/onboarding/welcome");
      })
      .catch((error: unknown) => console.error("Fork reset check failed", error));
  }, [data, router]);

  if (status.status === "unreachable" || data?.state === "down") {
    return (
      <Banner tone="warn" live="status" className="demo-status">
        {t("down")}
      </Banner>
    );
  }
  if (data?.state === "resetting") {
    return (
      <Banner tone="info" live="status" className="demo-status">
        {t("resetting")}
      </Banner>
    );
  }
  if (wasReset) {
    return (
      <Banner tone="info" live="status" className="demo-status">
        {t("wasReset")}
      </Banner>
    );
  }
  if (data?.resetsAt) {
    return (
      <p className="pr-small pr-muted demo-status demo-status--quiet">
        {t("nextReset", { time: formatTime(data.resetsAt, locale) })}
      </p>
    );
  }
  return null;
}
