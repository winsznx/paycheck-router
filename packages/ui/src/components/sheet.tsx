"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
};

/**
 * Bottom sheet on phones, centred dialog from tablet up (PRD 14.6). Built on the native
 * modal <dialog>: it traps focus, closes on Escape and returns focus to the opener.
 */
export function Sheet({ open, onClose, title, closeLabel, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="pr-sheet" aria-labelledby={titleId} onClose={onClose}>
      <div className="pr-sheet__header">
        <h2 id={titleId} className="pr-h3">
          {title}
        </h2>
        <button type="button" className="pr-icon-btn" onClick={onClose} aria-label={closeLabel}>
          <X size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div className="pr-sheet__body">{children}</div>
    </dialog>
  );
}
