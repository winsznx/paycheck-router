"use client";

import { CircleAlert, CircleCheck, Info, type LucideIcon, TriangleAlert } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type ToastTone = "info" | "success" | "warn" | "error";

export type ToastInput = {
  tone: ToastTone;
  text: string;
  action?: { label: string; onSelect: () => void } | undefined;
};

type ToastEntry = ToastInput & { id: number };

const ICONS: Record<ToastTone, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warn: TriangleAlert,
  error: CircleAlert,
};

const TOAST_MS = 5000;

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

export function useToast(): (toast: ToastInput) => void {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast must be used inside <ToastProvider>");
  return push;
}

function ToastItem({ toast, onDone }: { toast: ToastEntry; onDone: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(TOAST_MS);
  const Icon = ICONS[toast.tone];

  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => onDone(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, onDone, toast.id]);

  return (
    <li
      className={`pr-toast pr-toast--${toast.tone}`}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
      <p className="pr-toast__text pr-small">{toast.text}</p>
      {toast.action ? (
        <button
          type="button"
          className="pr-btn pr-btn--ghost pr-btn--s"
          onClick={() => {
            toast.action?.onSelect();
            onDone(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
    </li>
  );
}

/** Bottom on phones, top-right on desktop; 5 s, paused on hover or focus (PRD 14.6). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);

  const push = useCallback((toast: ToastInput) => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((current) => [...current.slice(-2), { ...toast, id }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const polite = toasts.filter((t) => t.tone !== "error");
  const urgent = toasts.filter((t) => t.tone === "error");
  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pr-toasts">
        <div role="status" aria-live="polite">
          <ul className="pr-toasts__list">
            {polite.map((toast) => (
              <ToastItem key={toast.id} toast={toast} onDone={dismiss} />
            ))}
          </ul>
        </div>
        <div role="alert" aria-live="assertive">
          <ul className="pr-toasts__list">
            {urgent.map((toast) => (
              <ToastItem key={toast.id} toast={toast} onDone={dismiss} />
            ))}
          </ul>
        </div>
      </div>
    </ToastContext.Provider>
  );
}
