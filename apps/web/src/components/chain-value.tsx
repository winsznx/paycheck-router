"use client";

import type { ChainKind } from "@paycheck-router/ui/chain";
import { ChainRef } from "@paycheck-router/ui/components";
import { useTranslations } from "next-intl";
import { chainEnv } from "@/lib/env.ts";
import { feedSymbol } from "@/lib/feeds.ts";

export type ChainValueProps = {
  kind: ChainKind;
  value: string;
  /** Overrides the default name for the kind, e.g. "Pay-in wallet". */
  name?: string | undefined;
  display?: "truncate" | "full";
};

/** Every address, signature, mint, program and feed id in the app goes through here. */
export function ChainValue({ kind, value, name, display = "truncate" }: ChainValueProps) {
  const t = useTranslations("chain");
  return (
    <ChainRef
      kind={kind}
      value={value}
      env={chainEnv}
      display={display}
      feedSymbol={kind === "feed" ? feedSymbol(value) : null}
      labels={{
        name: name ?? t(`names.${kind === "slice" ? "tx" : kind}`),
        copy: t("copy"),
        copied: t("copied"),
        recorded: t("recorded"),
      }}
    />
  );
}
