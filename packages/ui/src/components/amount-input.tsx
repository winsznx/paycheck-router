"use client";

import { type InputHTMLAttributes, useId } from "react";

export type AmountInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "inputMode"> & {
  label: string;
  suffix?: string | undefined;
  helper?: string | undefined;
  error?: string | undefined;
  maxLabel?: string | undefined;
  onMax?: (() => void) | undefined;
};

/** JetBrains Mono value, currency suffix, max button, helper line (PRD 14.6). */
export function AmountInput({
  label,
  suffix,
  helper,
  error,
  maxLabel,
  onMax,
  id,
  required,
  ...input
}: AmountInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const helperId = `${inputId}-helper`;
  const errorId = `${inputId}-error`;
  const describedBy = [helper ? helperId : "", error ? errorId : ""].filter(Boolean).join(" ");
  return (
    <div className="pr-field" data-invalid={error ? true : undefined}>
      <label className="pr-field__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="pr-field__control">
        <input
          {...input}
          id={inputId}
          className="pr-field__input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
        />
        {suffix ? <span className="pr-field__suffix">{suffix}</span> : null}
        {onMax && maxLabel ? (
          <button type="button" onClick={onMax}>
            {maxLabel}
          </button>
        ) : null}
      </div>
      {helper ? (
        <p id={helperId} className="pr-field__helper">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="pr-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
