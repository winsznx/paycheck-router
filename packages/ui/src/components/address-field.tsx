"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { truncateMiddle } from "../format/index.ts";

export type AddressFieldProps = {
  address: string;
  copyLabel: string;
  copiedLabel: string;
  explorerHref?: string | undefined;
  explorerLabel?: string | undefined;
  /** Accessible description of the full value, e.g. "Pay-in address 7Yq3…". */
  label: string;
};

const COPIED_MS = 1500;

export function AddressField({
  address,
  copyLabel,
  copiedLabel,
  explorerHref,
  explorerLabel,
  label,
}: AddressFieldProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      window.prompt(copyLabel, address);
    }
  }

  return (
    <div className="pr-address">
      <span className="pr-address__value" title={address} translate="no">
        <span aria-hidden="true">{truncateMiddle(address)}</span>
        <span className="pr-sr-only">{`${label} ${address}`}</span>
      </span>
      <button type="button" className="pr-icon-btn" onClick={copy}>
        {copied ? (
          <Check size={20} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <Copy size={20} strokeWidth={1.75} aria-hidden="true" />
        )}
        <span>{copied ? copiedLabel : copyLabel}</span>
      </button>
      <span className="pr-sr-only" aria-live="polite">
        {copied ? copiedLabel : ""}
      </span>
      {explorerHref && explorerLabel ? (
        <a className="pr-icon-btn" href={explorerHref} target="_blank" rel="noreferrer">
          <ExternalLink size={20} strokeWidth={1.75} aria-hidden="true" />
          <span>{explorerLabel}</span>
        </a>
      ) : null}
    </div>
  );
}
