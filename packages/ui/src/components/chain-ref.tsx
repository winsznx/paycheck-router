"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { type ChainEnv, type ChainKind, chainLinks } from "../chain/links.ts";
import { truncateMiddle } from "../format/index.ts";

export type ChainRefLabels = {
  /** What the value is, e.g. "Transaction" or "Token mint". */
  name: string;
  copy: string;
  copied: string;
  /** Text of the secondary link to the recorded fork JSON. */
  recorded: string;
};

export type ChainRefProps = {
  kind: ChainKind;
  value: string;
  env: ChainEnv;
  labels: ChainRefLabels;
  /** `truncate` (default) shows 5qYWd…KZTC; `full` wraps the whole value. */
  display?: "truncate" | "full";
  feedSymbol?: string | null;
};

const COPIED_MS = 1500;

/**
 * One way to show an address, signature, mint, program or feed id: a link (where one exists),
 * a copy button, the full value in `title` and an accessible name. Never widens its container.
 */
export function ChainRef({
  kind,
  value,
  env,
  labels,
  display = "truncate",
  feedSymbol,
}: ChainRefProps) {
  const [copied, setCopied] = useState(false);
  const [primary, ...more] = chainLinks(kind, value, env, feedSymbol);
  const text = display === "full" ? value : truncateMiddle(value, 5, 4);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      window.prompt(labels.copy, value);
    }
  }

  const body = (
    <>
      <span aria-hidden="true">{text}</span>
      <span className="pr-sr-only">{`${labels.name} ${value}`}</span>
    </>
  );

  return (
    <span className="pr-chainref" data-kind={kind} data-display={display}>
      {primary ? (
        <a
          className="pr-chainref__value"
          href={primary.href}
          title={value}
          translate="no"
          {...(primary.external ? { target: "_blank", rel: "noreferrer" } : {})}
        >
          {body}
        </a>
      ) : (
        <span className="pr-chainref__value" title={value} translate="no">
          {body}
        </span>
      )}
      {more.map((link) => (
        <a
          key={link.href}
          className="pr-chainref__alt"
          href={link.href}
          target="_blank"
          rel="noreferrer"
        >
          {labels.recorded}
        </a>
      ))}
      <button
        type="button"
        className="pr-chainref__copy"
        onClick={copy}
        aria-label={`${copied ? labels.copied : labels.copy}: ${labels.name}`}
        title={labels.copy}
      >
        {copied ? (
          <Check size={16} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <Copy size={16} strokeWidth={1.75} aria-hidden="true" />
        )}
      </button>
      <span className="pr-sr-only" aria-live="polite">
        {copied ? labels.copied : ""}
      </span>
    </span>
  );
}
